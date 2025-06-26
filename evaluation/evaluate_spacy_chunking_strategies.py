#!/usr/bin/env python3
"""
Focused evaluation of spaCy chunking strategies for the current RAG system.

Compares specific spaCy chunking strategies:
- spaCy sentence-based chunking at 300 tokens (25% overlap)
- spaCy sentence-based chunking at 600 tokens (20% overlap)
- spaCy paragraph-based chunking at 300 tokens (25% overlap)
- spaCy paragraph-based chunking at 600 tokens (20% overlap)

Evaluates retrieval performance using human-judged dataset and reports:
- Precision@K and NDCG@K metrics
- Average retrieval times
- Retrieved chunks for manual review
- Comparison table across all strategies

Usage:
    python evaluate_spacy_chunking_strategies.py --site ananda
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from difflib import SequenceMatcher

import nltk
import numpy as np
import openai
import spacy
from nltk.tokenize import word_tokenize
from openai import OpenAI
from pinecone import NotFoundException, Pinecone
from sklearn.metrics import ndcg_score

from pyutil.env_utils import load_env

# Download NLTK data (for tokenization)
nltk.download("punkt", quiet=True)

# Load spaCy English model
try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print(
        "ERROR: spaCy model 'en_core_web_sm' not found. Install with: python -m spacy download en_core_web_sm"
    )
    sys.exit(1)

# --- Configuration ---
EVAL_DATASET_PATH = os.path.join(
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
    "reranking",
    "evaluation_dataset_ananda.jsonl",
)
SITE_CONFIG_PATH = os.path.join(
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
    "web",
    "site-config",
    "config.json",
)
K = 5  # Evaluate top-K results
SIMILARITY_THRESHOLD = 0.85  # Threshold for matching chunks
LENIENT_SIMILARITY_THRESHOLD = 0.35  # More lenient threshold for testing

# Define focused spaCy chunking strategies
SPACY_CHUNKING_STRATEGIES = [
    {
        "name": "spacy_sentence_300",
        "chunk_size": 300,
        "chunk_overlap": 75,  # 25% overlap
        "method": "spacy_sentence",
        "description": "spaCy sentence-based chunking (300 tokens, 25% overlap)",
    },
    {
        "name": "spacy_sentence_600",
        "chunk_size": 600,
        "chunk_overlap": 120,  # 20% overlap
        "method": "spacy_sentence",
        "description": "spaCy sentence-based chunking (600 tokens, 20% overlap)",
    },
    {
        "name": "spacy_paragraph_300",
        "chunk_size": 300,
        "chunk_overlap": 75,  # 25% overlap
        "method": "spacy_paragraph",
        "description": "spaCy paragraph-based chunking (300 tokens, 25% overlap)",
    },
    {
        "name": "spacy_paragraph_600",
        "chunk_size": 600,
        "chunk_overlap": 120,  # 20% overlap
        "method": "spacy_paragraph",
        "description": "spaCy paragraph-based chunking (600 tokens, 20% overlap)",
    },
]

# --- Helper Functions ---


def load_site_config(site: str):
    """Load site configuration and return included libraries."""
    try:
        with open(SITE_CONFIG_PATH) as f:
            config = json.load(f)

        site_config = config.get(site)
        if not site_config:
            print(f"ERROR: Site '{site}' not found in config.json")
            sys.exit(1)

        included_libraries = site_config.get("includedLibraries", [])

        # Handle both string and object formats for includedLibraries
        library_names = []
        for lib in included_libraries:
            if isinstance(lib, str):
                library_names.append(lib)
            elif isinstance(lib, dict) and "name" in lib:
                library_names.append(lib["name"])

        print(f"Site '{site}' includes libraries: {library_names}")
        return library_names
    except FileNotFoundError:
        print(f"ERROR: Site config file not found at {SITE_CONFIG_PATH}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in config file: {e}")
        sys.exit(1)


def create_library_filter(included_libraries):
    """Create Pinecone metadata filter for included libraries."""
    if not included_libraries:
        return None

    # Create filter for library field
    filter_dict = {"library": {"$in": included_libraries}}
    print(f"Created Pinecone filter: {filter_dict}")
    return filter_dict


def load_environment(site: str):
    """Load environment variables based on the site."""
    try:
        load_env(site)
        print(f"Loaded environment for site: {site}")
    except Exception as e:
        print(f"ERROR loading environment: {e}")
        sys.exit(1)

    # Check required environment variables
    required_vars = [
        "PINECONE_API_KEY",
        "PINECONE_INDEX_NAME",
        "OPENAI_API_KEY",
        "OPENAI_EMBEDDINGS_MODEL",
        "OPENAI_EMBEDDINGS_DIMENSION",
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(
            f"ERROR: Missing required environment variables: {', '.join(missing_vars)}"
        )
        sys.exit(1)


def get_pinecone_client():
    """Initialize and return a Pinecone client."""
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        raise ValueError("PINECONE_API_KEY not found in environment variables.")
    return Pinecone(api_key=api_key)


def get_pinecone_index(
    pinecone_client, index_name, embedding_model, expected_dimension
):
    """Get the Pinecone index object for the specified index name and validate dimensions."""
    try:
        index = pinecone_client.Index(index_name)
        stats = index.describe_index_stats()
        print(
            f"Successfully connected to index '{index_name}'. Stats: {stats['total_vector_count']} vectors."
        )
        dimension = stats.get("dimension", "Unknown")
        print(f"Index '{index_name}' dimension: {dimension}")
        print(f"Expected dimension for model '{embedding_model}': {expected_dimension}")

        if dimension != expected_dimension:
            raise ValueError(
                f"Dimension mismatch for index '{index_name}': expected dimension {expected_dimension} for model '{embedding_model}', but got {dimension}. "
                f"Ensure that PINECONE_INDEX_NAME matches OPENAI_EMBEDDINGS_DIMENSION in your environment configuration."
            )
        if stats["total_vector_count"] == 0:
            print(
                f"WARNING: Index '{index_name}' is empty. Evaluation will produce zero metrics."
            )
        return index
    except NotFoundException:
        print(f"ERROR: Pinecone index '{index_name}' not found.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR connecting to Pinecone index '{index_name}': {e}")
        sys.exit(1)


def load_evaluation_data(filepath=None):
    """Loads evaluation data grouped by query."""
    if filepath is None:
        filepath = os.path.join(
            os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")),
            "reranking",
            "evaluation_dataset_ananda.jsonl",
        )
    data_by_query = defaultdict(list)
    try:
        with open(filepath) as f:
            for line in f:
                item = json.loads(line)
                item["relevance"] = float(item.get("relevance", 0.0))
                data_by_query[item["query"]].append(item)
        print(
            f"Loaded evaluation data for {len(data_by_query)} queries from {filepath}"
        )
        if data_by_query:
            first_query = list(data_by_query.keys())[0]
            print(
                f"Sample documents for query '{first_query}': {len(data_by_query[first_query])}"
            )
        return data_by_query
    except FileNotFoundError:
        print(f"ERROR: Evaluation dataset not found at {filepath}.")
        return None
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to decode JSON in {filepath}. Error: {e}")
        return None


def get_embedding(text, model_name, openai_client):
    """Generate embedding for text using OpenAI API."""
    try:
        response = openai_client.embeddings.create(input=text, model=model_name)
        return response.data[0].embedding
    except Exception as e:
        print(f"ERROR generating embedding with {model_name}: {e}")
        return None


def apply_overlap_to_chunks(chunks, chunk_overlap):
    """Apply overlap to a list of chunks by prepending tokens from previous chunk."""
    if chunk_overlap <= 0:
        return chunks

    overlapped_chunks = []
    for i, chunk in enumerate(chunks):
        overlapped_chunk = chunk
        if i > 0:
            prev_chunk_tokens = word_tokenize(chunks[i - 1])
            overlap_tokens = prev_chunk_tokens[
                -min(chunk_overlap, len(prev_chunk_tokens)) :
            ]
            overlapped_chunk = " ".join(overlap_tokens) + " " + chunk
        overlapped_chunks.append(overlapped_chunk)
    return overlapped_chunks


def chunk_by_sentences(text, chunk_size, chunk_overlap):
    """Handle sentence-based chunking with spaCy."""
    doc = nlp(text)
    sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
    chunks = []
    current_chunk = []
    current_length = 0

    for sent in sentences:
        sent_tokens = len(word_tokenize(sent))
        if current_length + sent_tokens <= chunk_size:
            current_chunk.append(sent)
            current_length += sent_tokens
        else:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [sent]
            current_length = sent_tokens

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return apply_overlap_to_chunks(chunks, chunk_overlap)


def chunk_by_paragraphs(text, chunk_size, chunk_overlap):
    """Handle paragraph-based chunking with spaCy fallback."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:  # Fallback to spaCy sentences if no clear paragraphs
        doc = nlp(text)
        paragraphs = [" ".join([sent.text.strip() for sent in doc.sents])]

    chunks = []
    current_chunk = []
    current_length = 0

    for para in paragraphs:
        para_tokens = len(word_tokenize(para))
        if current_length + para_tokens <= chunk_size:
            current_chunk.append(para)
            current_length += para_tokens
        else:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [para]
            current_length = para_tokens

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return apply_overlap_to_chunks(chunks, chunk_overlap)


def chunk_text(text, chunk_size, chunk_overlap, method):
    """Chunk text into segments with specified size, overlap, and method."""
    if method == "spacy_sentence":
        return chunk_by_sentences(text, chunk_size, chunk_overlap)
    elif method == "spacy_paragraph":
        return chunk_by_paragraphs(text, chunk_size, chunk_overlap)
    else:
        raise ValueError(f"Unsupported chunking method: {method}")


def match_chunks(retrieved_chunk, judged_chunks):
    """Match a retrieved chunk to judged chunks by content similarity."""
    best_match = None
    best_score = 0.0
    all_scores = []

    for judged in judged_chunks:
        similarity = SequenceMatcher(None, retrieved_chunk, judged["document"]).ratio()
        all_scores.append(similarity)
        if similarity > best_score:
            best_score = similarity
            best_match = judged

    # Log similarity analysis
    max_score = max(all_scores) if all_scores else 0.0
    print(
        f"    Chunk similarity analysis: max={max_score:.3f}, scores={[f'{s:.3f}' for s in sorted(all_scores, reverse=True)[:3]]}"
    )

    # Try lenient threshold if strict threshold fails
    if best_score >= SIMILARITY_THRESHOLD:
        print(f"    ✓ Strict match found (similarity={best_score:.3f})")
        return best_match
    elif best_score >= LENIENT_SIMILARITY_THRESHOLD:
        print(f"    ⚠ Lenient match found (similarity={best_score:.3f})")
        return best_match
    else:
        print(f"    ✗ No match found (best similarity={best_score:.3f})")
        return None


def retrieve_documents(
    index,
    query,
    embedding_model,
    chunking_strategy,
    top_k,
    openai_client,
    library_filter=None,
):
    """Retrieve top-K documents for a query using the specified chunking strategy."""
    start_time = time.time()

    # Generate query embedding
    query_embedding = get_embedding(query, embedding_model, openai_client)
    if query_embedding is None:
        return [], 0.0

    try:
        query_params = {
            "vector": query_embedding,
            "top_k": top_k * 2,
            "include_metadata": True,
        }

        # Add library filter if provided
        if library_filter:
            query_params["filter"] = library_filter

        results = index.query(**query_params)
        print(
            f"Querying with model: {embedding_model}, Top-K matches: {len(results['matches'])}"
        )
        for i, match in enumerate(results["matches"][:3]):  # Log top 3 for debugging
            print(
                f"Match {i + 1}: Score={match['score']:.4f}, Metadata={match['metadata']}"
            )
    except Exception as e:
        print(f"ERROR querying Pinecone: {e}")
        return [], 0.0

    # Process results
    documents = []
    for match in results["matches"]:
        text = match["metadata"].get("text", "")
        # Re-chunk using specified strategy
        chunks = chunk_text(
            text,
            chunking_strategy["chunk_size"],
            chunking_strategy["chunk_overlap"],
            chunking_strategy["method"],
        )
        print(
            f"Strategy: {chunking_strategy['name']}, Chunk size: {chunking_strategy['chunk_size']}, Overlap: {chunking_strategy['chunk_overlap']}, Content length: {len(text.split())} words, Chunks created: {len(chunks)}"
        )

        for chunk in chunks[:2]:  # Limit to avoid overfetching
            doc = {
                "document": chunk,
                "metadata": match["metadata"],
                "score": float(match["score"]),
            }
            documents.append(doc)
            if len(documents) >= top_k:
                break
        if len(documents) >= top_k:
            break

    inference_time = time.time() - start_time
    return documents[:top_k], inference_time


def calculate_precision_at_k(documents, k):
    """Calculate Precision@K (fraction of top-K docs with relevance >= 1)."""
    top_k_docs = documents[:k]
    relevant_count = sum(1 for doc in top_k_docs if doc["relevance"] >= 1.0)
    return relevant_count / k if k > 0 else 0.0


def calculate_ndcg_at_k(documents, k):
    """Calculate NDCG@K."""
    if not documents:
        return 0.0
    true_relevance = np.asarray([[doc["relevance"] for doc in documents]])
    predicted_scores = np.asarray([[doc["score"] for doc in documents]])
    k_val = min(k, len(documents))
    if true_relevance.shape[1] == 0 or predicted_scores.shape[1] == 0:
        return 0.0
    if np.sum(true_relevance) == 0:
        return 0.0
    return ndcg_score(true_relevance, predicted_scores, k=k_val)


def evaluate_query_for_strategies(
    index,
    query,
    embedding_model,
    chunking_strategies,
    openai_client,
    judged_docs,
    library_filter=None,
):
    """Evaluate a single query across all chunking strategies."""
    query_metrics = {}
    query_times = {}
    query_chunks = {}

    for strategy in chunking_strategies:
        try:
            docs, time_taken = retrieve_documents(
                index,
                query,
                embedding_model,
                strategy,
                K,
                openai_client,
                library_filter,
            )
            for doc in docs:
                matched = match_chunks(doc["document"], judged_docs)
                doc["relevance"] = matched["relevance"] if matched else 0.0
                # Log chunk for manual review
                if (query, strategy["name"]) not in query_chunks:
                    query_chunks[(query, strategy["name"])] = []
                query_chunks[(query, strategy["name"])].append(
                    {
                        "chunk": doc["document"][:200] + "...",
                        "relevance": doc["relevance"],
                        "score": doc["score"],
                    }
                )
            precision = calculate_precision_at_k(docs, K)
            ndcg = calculate_ndcg_at_k(docs, K)

            query_metrics[strategy["name"]] = {"precision": precision, "ndcg": ndcg}
            query_times[strategy["name"]] = time_taken

            print(
                f"    {strategy['name']} - Precision@{K}: {precision:.4f}, NDCG@{K}: {ndcg:.4f}"
            )
        except Exception as e:
            print(f"    ERROR processing query with {strategy['name']}: {e}")
            query_metrics[strategy["name"]] = {"precision": 0.0, "ndcg": 0.0}
            query_times[strategy["name"]] = 0.0

    return query_metrics, query_times, query_chunks


def initialize_metrics_storage(chunking_strategies):
    """Initialize metrics storage for all strategies."""
    metrics = {strategy["name"]: defaultdict(list) for strategy in chunking_strategies}
    times = {strategy["name"]: [] for strategy in chunking_strategies}
    return metrics, times


def update_overall_metrics(metrics, times, query_metrics, query_times):
    """Update overall metrics with results from a single query."""
    for strategy_name, metric_data in query_metrics.items():
        metrics[strategy_name]["precision"].append(metric_data["precision"])
        metrics[strategy_name]["ndcg"].append(metric_data["ndcg"])
        times[strategy_name].append(query_times[strategy_name])


def print_manual_review_report(retrieved_chunks):
    """Print retrieved chunks for manual review."""
    print("\n--- Retrieved Chunks for Manual Review ---")
    for (query, strategy_name), chunks in retrieved_chunks.items():
        print(f"\nQuery: {query[:50]}... | Strategy: {strategy_name}")
        for i, chunk_info in enumerate(chunks[:K], 1):
            print(
                f"  Chunk {i}: Relevance={chunk_info['relevance']}, Score={chunk_info['score']:.4f}"
            )
            print(f"    Text: {chunk_info['chunk']}")


def print_average_metrics_report(metrics, times, chunking_strategies, query_count):
    """Print average metrics for all strategies."""
    print("\n--- spaCy Chunking Strategy Evaluation Results ---")
    print(f"Evaluated on {query_count} queries with K={K}")

    for strategy in chunking_strategies:
        name = strategy["name"]
        avg_precision = (
            np.mean(metrics[name]["precision"]) if metrics[name]["precision"] else 0.0
        )
        avg_ndcg = np.mean(metrics[name]["ndcg"]) if metrics[name]["ndcg"] else 0.0
        avg_time = np.mean(times[name]) if times[name] else 0.0
        print(f"\nStrategy: {strategy['description']}")
        print(f"  Avg Precision@{K}: {avg_precision:.4f}")
        print(f"  Avg NDCG@{K}:      {avg_ndcg:.4f}")
        print(f"  Avg Retrieval Time: {avg_time:.4f} seconds")


def print_comparison_table(metrics, times, chunking_strategies):
    """Print comparison table for all strategies."""
    print("\n--- spaCy Strategy Comparison Table ---")
    print(f"{'Strategy':<60} {'Precision@K':<12} {'NDCG@K':<10} {'Time (s)':<10}")
    print("-" * 95)

    # Sort strategies by precision for better readability
    strategy_results = []
    for strategy in chunking_strategies:
        name = strategy["name"]
        avg_precision = (
            np.mean(metrics[name]["precision"]) if metrics[name]["precision"] else 0.0
        )
        avg_ndcg = np.mean(metrics[name]["ndcg"]) if metrics[name]["ndcg"] else 0.0
        avg_time = np.mean(times[name]) if times[name] else 0.0
        strategy_results.append((strategy, avg_precision, avg_ndcg, avg_time))

    # Sort by precision descending
    strategy_results.sort(key=lambda x: x[1], reverse=True)

    for strategy, avg_precision, avg_ndcg, avg_time in strategy_results:
        print(
            f"{strategy['description']:<60} {avg_precision:<12.4f} {avg_ndcg:<10.4f} {avg_time:<10.4f}"
        )


def print_recommendation(metrics, chunking_strategies):
    """Print recommendation based on results."""
    print("\n--- Recommendation ---")

    # Calculate average scores for each strategy
    strategy_scores = []
    for strategy in chunking_strategies:
        name = strategy["name"]
        avg_precision = (
            np.mean(metrics[name]["precision"]) if metrics[name]["precision"] else 0.0
        )
        avg_ndcg = np.mean(metrics[name]["ndcg"]) if metrics[name]["ndcg"] else 0.0
        # Combined score (weight NDCG slightly higher as it's more comprehensive)
        combined_score = (avg_precision * 0.4) + (avg_ndcg * 0.6)
        strategy_scores.append((strategy, avg_precision, avg_ndcg, combined_score))

    # Sort by combined score
    strategy_scores.sort(key=lambda x: x[3], reverse=True)
    best_strategy = strategy_scores[0]

    print(f"Best performing strategy: {best_strategy[0]['description']}")
    print(f"  Precision@{K}: {best_strategy[1]:.4f}")
    print(f"  NDCG@{K}: {best_strategy[2]:.4f}")
    print(f"  Combined Score: {best_strategy[3]:.4f}")

    # Analysis
    sentence_strategies = [s for s in strategy_scores if "sentence" in s[0]["name"]]
    paragraph_strategies = [s for s in strategy_scores if "paragraph" in s[0]["name"]]
    size_300_strategies = [s for s in strategy_scores if "300" in s[0]["name"]]
    size_600_strategies = [s for s in strategy_scores if "600" in s[0]["name"]]

    print("\nAnalysis:")

    if sentence_strategies and paragraph_strategies:
        avg_sentence_score = np.mean([s[3] for s in sentence_strategies])
        avg_paragraph_score = np.mean([s[3] for s in paragraph_strategies])
        if avg_sentence_score > avg_paragraph_score:
            print(
                f"  Sentence-based chunking outperforms paragraph-based ({avg_sentence_score:.4f} vs {avg_paragraph_score:.4f})"
            )
        else:
            print(
                f"  Paragraph-based chunking outperforms sentence-based ({avg_paragraph_score:.4f} vs {avg_sentence_score:.4f})"
            )

    if size_300_strategies and size_600_strategies:
        avg_300_score = np.mean([s[3] for s in size_300_strategies])
        avg_600_score = np.mean([s[3] for s in size_600_strategies])
        if avg_300_score > avg_600_score:
            print(
                f"  300-token chunks outperform 600-token chunks ({avg_300_score:.4f} vs {avg_600_score:.4f})"
            )
        else:
            print(
                f"  600-token chunks outperform 300-token chunks ({avg_600_score:.4f} vs {avg_300_score:.4f})"
            )


# --- Main Evaluation Logic ---
def main():
    print("Starting focused spaCy chunking strategy evaluation...")

    # --- Argument Parsing ---
    parser = argparse.ArgumentParser(
        description="Evaluate spaCy chunking strategies for RAG system performance."
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID to load environment variables (e.g., ananda)",
    )
    args = parser.parse_args()

    # Load environment
    load_environment(args.site)

    # Load site configuration and create library filter
    included_libraries = load_site_config(args.site)
    library_filter = create_library_filter(included_libraries)

    # Define environment variables after loading
    INDEX_NAME = os.getenv("PINECONE_INDEX_NAME")
    EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDINGS_MODEL")
    DIMENSION = int(os.getenv("OPENAI_EMBEDDINGS_DIMENSION"))

    # Initialize OpenAI client
    openai.api_key = os.getenv("OPENAI_API_KEY")
    openai_client = OpenAI()

    try:
        # Initialize Pinecone
        pinecone_client = get_pinecone_client()
        index = get_pinecone_index(
            pinecone_client,
            INDEX_NAME,
            EMBEDDING_MODEL,
            DIMENSION,
        )
    except Exception as e:
        print(f"ERROR initializing Pinecone: {e}")
        return

    # Load evaluation data
    eval_data = load_evaluation_data(EVAL_DATASET_PATH)
    if not eval_data:
        return

    # Initialize metrics storage
    metrics, times = initialize_metrics_storage(SPACY_CHUNKING_STRATEGIES)
    retrieved_chunks = defaultdict(list)  # For manual review

    query_count = len(eval_data)
    print(
        f"\nProcessing {query_count} queries with {len(SPACY_CHUNKING_STRATEGIES)} spaCy strategies..."
    )

    for processed_queries, (query, judged_docs) in enumerate(eval_data.items(), 1):
        print(f"  Query {processed_queries}/{query_count}: '{query[:50]}...'")

        # Evaluate all spaCy strategies
        query_metrics, query_times, chunks = evaluate_query_for_strategies(
            index,
            query,
            EMBEDDING_MODEL,
            SPACY_CHUNKING_STRATEGIES,
            openai_client,
            judged_docs,
            library_filter,
        )
        update_overall_metrics(metrics, times, query_metrics, query_times)
        retrieved_chunks.update(chunks)

    # Print reports
    print_manual_review_report(retrieved_chunks)
    print_average_metrics_report(metrics, times, SPACY_CHUNKING_STRATEGIES, query_count)
    print_comparison_table(metrics, times, SPACY_CHUNKING_STRATEGIES)
    print_recommendation(metrics, SPACY_CHUNKING_STRATEGIES)


if __name__ == "__main__":
    main()
