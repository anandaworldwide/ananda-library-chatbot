#!/usr/bin/env python3
"""
Evaluates and compares RAG systems with different chunking strategies for retrieval performance.

Key Operations:
- Loads configurations via a `--site` argument, setting environment variables dynamically.
- Connects to two Pinecone indexes (current: corpus-2025-02-15, new: test-2025-05-17--3-large-3072).
- Processes a human-judged dataset (`evaluation_dataset_ananda.jsonl`) with queries and relevance scores.
- For each query and system (current: text-embedding-ada-002, new: text-embedding-3-large):
    - Tests multiple chunking strategies (fixed-size and spaCy-based) defined in CHUNKING_STRATEGIES.
    - Retrieves top-K documents, applying strategy-specific chunking.
    - Matches retrieved chunks to judged documents using `difflib.SequenceMatcher`.
    - Calculates Precision@K and NDCG@K for each strategy.
    - Logs top-K chunks for manual review.
- Reports average Precision@K, NDCG@K, retrieval times, and a comparison table for all strategies.

Dependencies:
- Populated Pinecone indexes are required.
- Requires spaCy with `en_core_web_sm` for semantic chunking.
- Correct index dimensions (1536 for ada-002, 3072 for 3-large) are critical.

Future Improvements:
- Add CLI arguments for selecting chunking strategies.
- Support multiple indexes per strategy.
- Add redundancy metrics for overlap analysis.
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

# Add the parent directory to the path so we can find the data_ingestion module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
# Add the root directory to the path for pyutil
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from utils.text_splitter_utils import SpacyTextSplitter

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
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")),
    "reranking",
    "evaluation_dataset_ananda.jsonl",
)
K = 5  # Evaluate top-K results
SIMILARITY_THRESHOLD = 0.85  # Threshold for matching chunks

# Define chunking strategies for evaluation
CHUNKING_STRATEGIES = [
    {
        "name": "current_fixed",
        "chunk_size": 256,
        "chunk_overlap": 50,
        "method": "fixed",
        "description": "Current fixed-size chunking (256 tokens, 19.5% overlap)",
    },
    {
        "name": "optimized_fixed",
        "chunk_size": 400,
        "chunk_overlap": 100,
        "method": "fixed",
        "description": "Optimized fixed-size chunking (400 tokens, 25% overlap)",
    },
    {
        "name": "spacy_sentence",
        "chunk_size": 300,
        "chunk_overlap": 75,
        "method": "spacy_sentence",
        "description": "spaCy sentence-based chunking (~300 tokens, 25% overlap)",
    },
    {
        "name": "spacy_paragraph",
        "chunk_size": 600,
        "chunk_overlap": 120,
        "method": "spacy_paragraph",
        "description": "spaCy paragraph-based chunking (~600 tokens, 20% overlap)",
    },
    {
        "name": "spacy_dynamic",
        "method": "spacy_dynamic",
        "description": "spaCy dynamic chunking (variable size based on content length)",
    },
]

# --- Helper Functions ---


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
        "PINECONE_INGEST_INDEX_NAME",
        "OPENAI_INGEST_EMBEDDINGS_MODEL",
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


def get_pinecone_index(pinecone_client, index_name):
    """Get the Pinecone index object for the specified index name."""
    try:
        index = pinecone_client.Index(index_name)
        stats = index.describe_index_stats()
        print(
            f"Successfully connected to index '{index_name}'. Stats: {stats['total_vector_count']} vectors."
        )
        dimension = stats.get("dimension", "Unknown")
        print(f"Index '{index_name}' dimension: {dimension}")
        expected_dimension = (
            1536 if index_name == os.getenv("PINECONE_INDEX_NAME") else 3072
        )
        if dimension != expected_dimension:
            print(
                f"WARNING: Expected dimension {expected_dimension} for {index_name}, got {dimension}"
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


def chunk_text(text, chunk_size, chunk_overlap, method):
    """Chunk text into segments with specified size, overlap, and method."""
    if method == "fixed":
        words = word_tokenize(text)
        chunks = []
        start = 0
        while start < len(words):
            end = min(start + chunk_size, len(words))
            chunk = " ".join(words[start:end])
            chunks.append(chunk)
            start += chunk_size - chunk_overlap
        return chunks
    elif method == "spacy_sentence":
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
        # Apply overlap by adding trailing tokens from previous chunk
        overlapped_chunks = []
        for i, chunk in enumerate(chunks):
            overlapped_chunk = chunk
            if i > 0 and chunk_overlap > 0:
                prev_chunk_tokens = word_tokenize(chunks[i - 1])
                overlap_tokens = prev_chunk_tokens[
                    -min(chunk_overlap, len(prev_chunk_tokens)) :
                ]
                overlapped_chunk = " ".join(overlap_tokens) + " " + chunk
            overlapped_chunks.append(overlapped_chunk)
        return overlapped_chunks
    elif method == "spacy_paragraph":
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
        # Apply overlap
        overlapped_chunks = []
        for i, chunk in enumerate(chunks):
            overlapped_chunk = chunk
            if i > 0 and chunk_overlap > 0:
                prev_chunk_tokens = word_tokenize(chunks[i - 1])
                overlap_tokens = prev_chunk_tokens[
                    -min(chunk_overlap, len(prev_chunk_tokens)) :
                ]
                overlapped_chunk = " ".join(overlap_tokens) + " " + chunk
            overlapped_chunks.append(overlapped_chunk)
        return overlapped_chunks
    elif method == "spacy_dynamic":
        splitter = SpacyTextSplitter()
        chunks = splitter.split_text(text)
        print(f"Dynamic chunking applied: {len(chunks)} chunks")
        return chunks
    else:
        raise ValueError(f"Unsupported chunking method: {method}")


def match_chunks(retrieved_chunk, judged_chunks):
    """Match a retrieved chunk to judged chunks by content similarity."""
    best_match = None
    best_score = 0.0
    for judged in judged_chunks:
        similarity = SequenceMatcher(None, retrieved_chunk, judged["document"]).ratio()
        if similarity > best_score and similarity >= SIMILARITY_THRESHOLD:
            best_score = similarity
            best_match = judged
    return best_match


def retrieve_documents(
    index, query, embedding_model, chunking_strategy, top_k, openai_client
):
    """Retrieve top-K documents for a query using the specified system and chunking strategy."""
    start_time = time.time()

    # Generate query embedding
    query_embedding = get_embedding(query, embedding_model, openai_client)
    if query_embedding is None:
        return [], 0.0

    # Query Pinecone
    try:
        results = index.query(
            vector=query_embedding, top_k=top_k * 2, include_metadata=True
        )
    except Exception as e:
        print(f"ERROR querying Pinecone: {e}")
        return [], 0.0

    # Process results
    documents = []
    for match in results["matches"]:
        text = match["metadata"].get("text", "")
        # Re-chunk using specified strategy
        if chunking_strategy["method"] == "spacy_dynamic":
            chunks = chunk_text(text, 0, 0, chunking_strategy["method"])
            print(
                f"Strategy: {chunking_strategy['name']}, Content length: {len(text.split())} words, Chunks created: {len(chunks)}"
            )
        else:
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


# --- Main Evaluation Logic ---
def main():
    print("Starting RAG system evaluation with chunking strategies...")

    # --- Argument Parsing ---
    parser = argparse.ArgumentParser(
        description="Evaluate RAG system performance with chunking strategies."
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID to load environment variables (e.g., ananda)",
    )
    args = parser.parse_args()

    # Load environment
    load_environment(args.site)

    # Define environment variables after loading
    CURRENT_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "corpus-2025-02-15")
    NEW_INDEX_NAME = os.getenv(
        "PINECONE_INGEST_INDEX_NAME", "test-2025-05-17--3-large-3072"
    )
    CURRENT_EMBEDDING_MODEL = os.getenv(
        "OPENAI_EMBEDDINGS_MODEL", "text-embedding-ada-002"
    )
    NEW_EMBEDDING_MODEL = os.getenv(
        "OPENAI_INGEST_EMBEDDINGS_MODEL", "text-embedding-3-large"
    )

    # Initialize OpenAI client
    openai.api_key = os.getenv("OPENAI_API_KEY")
    openai_client = OpenAI()

    try:
        # Initialize Pinecone
        pinecone_client = get_pinecone_client()
        current_index = get_pinecone_index(pinecone_client, CURRENT_INDEX_NAME)
        new_index = get_pinecone_index(pinecone_client, NEW_INDEX_NAME)
    except Exception as e:
        print(f"ERROR initializing Pinecone: {e}")
        return

    # Load evaluation data
    eval_data = load_evaluation_data(EVAL_DATASET_PATH)
    if not eval_data:
        return

    # Initialize metrics storage for each system and strategy
    metrics = {
        "current": {
            strategy["name"]: defaultdict(list) for strategy in CHUNKING_STRATEGIES
        },
        "new": {
            strategy["name"]: defaultdict(list) for strategy in CHUNKING_STRATEGIES
        },
    }
    times = {
        "current": {strategy["name"]: [] for strategy in CHUNKING_STRATEGIES},
        "new": {strategy["name"]: [] for strategy in CHUNKING_STRATEGIES},
    }
    retrieved_chunks = defaultdict(list)  # For manual review

    query_count = len(eval_data)
    processed_queries = 0

    print(f"\nProcessing {query_count} queries...")
    for processed_queries, (query, judged_docs) in enumerate(eval_data.items(), 1):
        print(f"  Query {processed_queries}/{query_count}: '{query[:50]}...'")

        # Evaluate Current System (text-embedding-ada-002)
        for strategy in CHUNKING_STRATEGIES:
            try:
                docs, time_taken = retrieve_documents(
                    current_index,
                    query,
                    CURRENT_EMBEDDING_MODEL,
                    strategy,
                    K,
                    openai_client,
                )
                for doc in docs:
                    matched = match_chunks(doc["document"], judged_docs)
                    doc["relevance"] = matched["relevance"] if matched else 0.0
                    # Log chunk for manual review
                    retrieved_chunks[(query, "current", strategy["name"])].append(
                        {
                            "chunk": doc["document"][:200] + "...",
                            "relevance": doc["relevance"],
                            "score": doc["score"],
                        }
                    )
                precision = calculate_precision_at_k(docs, K)
                ndcg = calculate_ndcg_at_k(docs, K)
                metrics["current"][strategy["name"]]["precision"].append(precision)
                metrics["current"][strategy["name"]]["ndcg"].append(ndcg)
                times["current"][strategy["name"]].append(time_taken)
                print(
                    f"    Current System, {strategy['name']} - Precision@{K}: {precision:.4f}, NDCG@{K}: {ndcg:.4f}"
                )
            except Exception as e:
                print(
                    f"    ERROR processing query with current system, {strategy['name']}: {e}"
                )
                metrics["current"][strategy["name"]]["precision"].append(0.0)
                metrics["current"][strategy["name"]]["ndcg"].append(0.0)
                times["current"][strategy["name"]].append(0.0)

        # Evaluate New System (text-embedding-3-large)
        for strategy in CHUNKING_STRATEGIES:
            try:
                docs, time_taken = retrieve_documents(
                    new_index, query, NEW_EMBEDDING_MODEL, strategy, K, openai_client
                )
                for doc in docs:
                    matched = match_chunks(doc["document"], judged_docs)
                    doc["relevance"] = matched["relevance"] if matched else 0.0
                    # Log chunk for manual review
                    retrieved_chunks[(query, "new", strategy["name"])].append(
                        {
                            "chunk": doc["document"][:200] + "...",
                            "relevance": doc["relevance"],
                            "score": doc["score"],
                        }
                    )
                precision = calculate_precision_at_k(docs, K)
                ndcg = calculate_ndcg_at_k(docs, K)
                metrics["new"][strategy["name"]]["precision"].append(precision)
                metrics["new"][strategy["name"]]["ndcg"].append(ndcg)
                times["new"][strategy["name"]].append(time_taken)
                print(
                    f"    New System, {strategy['name']} - Precision@{K}: {precision:.4f}, NDCG@{K}: {ndcg:.4f}"
                )
            except Exception as e:
                print(
                    f"    ERROR processing query with new system, {strategy['name']}: {e}"
                )
                metrics["new"][strategy["name"]]["precision"].append(0.0)
                metrics["new"][strategy["name"]]["ndcg"].append(0.0)
                times["new"][strategy["name"]].append(0.0)

    # Calculate Average Metrics
    print("\n--- Evaluation Results ---")
    print(f"Evaluated on {query_count} queries with K={K}")

    for system in ["current", "new"]:
        system_name = (
            "Current System (text-embedding-ada-002)"
            if system == "current"
            else "New System (text-embedding-3-large)"
        )
        print(f"\n{system_name}:")
        for strategy in CHUNKING_STRATEGIES:
            name = strategy["name"]
            avg_precision = (
                np.mean(metrics[system][name]["precision"])
                if metrics[system][name]["precision"]
                else 0.0
            )
            avg_ndcg = (
                np.mean(metrics[system][name]["ndcg"])
                if metrics[system][name]["ndcg"]
                else 0.0
            )
            avg_time = np.mean(times[system][name]) if times[system][name] else 0.0
            print(f"  Strategy: {strategy['description']}")
            print(f"    Avg Precision@{K}: {avg_precision:.4f}")
            print(f"    Avg NDCG@{K}:      {avg_ndcg:.4f}")
            print(f"    Avg Retrieval Time: {avg_time:.4f} seconds")

    # Comparison Table
    print("\n--- Comparison Table ---")
    print(
        f"{'Strategy':<30} {'System':<15} {'Precision@K':<12} {'NDCG@K':<10} {'Time (s)':<10}"
    )
    print("-" * 80)
    for strategy in CHUNKING_STRATEGIES:
        name = strategy["name"]
        for system in ["current", "new"]:
            system_label = "Current" if system == "current" else "New"
            avg_precision = (
                np.mean(metrics[system][name]["precision"])
                if metrics[system][name]["precision"]
                else 0.0
            )
            avg_ndcg = (
                np.mean(metrics[system][name]["ndcg"])
                if metrics[system][name]["ndcg"]
                else 0.0
            )
            avg_time = np.mean(times[system][name]) if times[system][name] else 0.0
            print(
                f"{strategy['description']:<30} {system_label:<15} {avg_precision:.4f}      {avg_ndcg:.4f}    {avg_time:.4f}"
            )

    # Log Retrieved Chunks for Manual Review
    print("\n--- Retrieved Chunks for Manual Review ---")
    for (query, system, strategy_name), chunks in retrieved_chunks.items():
        print(
            f"\nQuery: {query[:50]}... | System: {system} | Strategy: {strategy_name}"
        )
        for i, chunk_info in enumerate(chunks[:K], 1):
            print(
                f"  Chunk {i}: Relevance={chunk_info['relevance']}, Score={chunk_info['score']:.4f}"
            )
            print(f"    Text: {chunk_info['chunk']}")


if __name__ == "__main__":
    main()
