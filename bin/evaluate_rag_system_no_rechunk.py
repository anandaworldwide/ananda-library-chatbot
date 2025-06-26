#!/usr/bin/env python3
"""
Evaluates and compares RAG systems using original Pinecone chunks with embedding-based semantic similarity.

Key Operations:
- Loads configurations via a `--site` argument, setting environment variables dynamically.
- Connects to two Pinecone indexes (current: via PINECONE_INDEX_NAME, new: via PINECONE_INGEST_INDEX_NAME).
- Processes a human-judged dataset (`evaluation_dataset_ananda.jsonl`) with queries and relevance scores.
- For each query and system:
    - Retrieves top-K documents directly from Pinecone without re-chunking.
    - Matches retrieved chunks to judged documents using embedding-based semantic similarity.
    - Calculates Precision@K and NDCG@K.
    - Logs top-K chunks for manual review.
- Reports average Precision@K, NDCG@K, retrieval times, and a comparison table.

Key Improvement: Uses embedding-based semantic similarity with caching for fast evaluation.
This approach captures semantic relevance and provides reliable performance metrics while avoiding
redundant API calls through intelligent caching.

Dependencies:
- Populated Pinecone indexes are required.
- Requires `en_core_web_sm` spaCy model (for compatibility, though not used for chunking).
- Correct index dimensions are critical.
- OpenAI API access for embedding generation.

Future Improvements:
- Add CLI arguments for selecting specific metrics.
- Support multiple datasets for evaluation.
- Add redundancy metrics for overlap analysis.
"""

import argparse
import hashlib
import json
import os
import sys
import time
from collections import defaultdict

import numpy as np
import openai
import spacy
from openai import OpenAI
from pinecone import NotFoundException, Pinecone
from sklearn.metrics import ndcg_score
from tqdm import tqdm

from pyutil.env_utils import load_env

# Load spaCy English model (for compatibility, though not used directly)
try:
    spacy.load("en_core_web_sm")
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
SIMILARITY_THRESHOLD = 0.85  # Strict threshold for embedding-based semantic similarity
LENIENT_SIMILARITY_THRESHOLD = (
    0.7  # Lenient threshold for embedding-based semantic similarity
)

# Global embedding cache to avoid redundant API calls
EMBEDDING_CACHE = {}

# --- Helper Functions ---


def build_system_description(index_name, embedding_model, dimension):
    """Build a dynamic system description from environment variables."""
    return f"{index_name} (model: {embedding_model}, dim: {dimension})"


def get_systems_config():
    """Get systems configuration with dynamic descriptions from environment variables."""
    return [
        {
            "name": "current",
            "index_env_var": "PINECONE_INDEX_NAME",
            "embedding_model_env_var": "OPENAI_EMBEDDINGS_MODEL",
            "dimension_env_var": "OPENAI_EMBEDDINGS_DIMENSION",
            "description": build_system_description(
                os.getenv("PINECONE_INDEX_NAME"),
                os.getenv("OPENAI_EMBEDDINGS_MODEL"),
                os.getenv("OPENAI_EMBEDDINGS_DIMENSION"),
            ),
        },
        {
            "name": "new",
            "index_env_var": "PINECONE_INGEST_INDEX_NAME",
            "embedding_model_env_var": "OPENAI_INGEST_EMBEDDINGS_MODEL",
            "dimension_env_var": "OPENAI_INGEST_EMBEDDINGS_DIMENSION",
            "description": build_system_description(
                os.getenv("PINECONE_INGEST_INDEX_NAME"),
                os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL"),
                os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION"),
            ),
        },
    ]


def get_text_hash(text, model_name):
    """Generate a hash key for caching embeddings based on text and model."""
    combined = f"{model_name}:{text}"
    return hashlib.md5(combined.encode("utf-8")).hexdigest()


def precompute_embeddings(eval_data, embedding_models, openai_client):
    """Pre-compute embeddings for all unique texts to avoid redundant API calls."""
    print("Pre-computing embeddings to speed up evaluation...")
    unique_texts = set()

    # Collect all unique texts from queries and judged documents
    for query, judged_docs in eval_data.items():
        unique_texts.add(query)
        for doc in judged_docs:
            unique_texts.add(doc["document"])

    unique_texts = list(unique_texts)  # Convert to list for tqdm
    print(f"Found {len(unique_texts)} unique texts to embed")

    # Pre-compute embeddings for each model
    total_api_calls = 0
    for model_name in embedding_models:
        print(f"\nPre-computing embeddings for model: {model_name}")
        cached_count = 0
        api_count = 0

        # Use tqdm for progress bar
        with tqdm(total=len(unique_texts), desc=f"Embedding {model_name}") as pbar:
            for text in unique_texts:
                cache_key = get_text_hash(text, model_name)
                if cache_key not in EMBEDDING_CACHE:
                    embedding = get_embedding(text, model_name, openai_client)
                    if embedding is not None:
                        api_count += 1
                else:
                    cached_count += 1
                pbar.update(1)

        print(f"  Model {model_name}: {api_count} API calls, {cached_count} from cache")
        total_api_calls += api_count

    print(f"\nEmbedding cache populated with {len(EMBEDDING_CACHE)} entries")
    print(f"Total API calls made: {total_api_calls}")
    print("Starting evaluation with cached embeddings...\n")


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
        library_names = [
            lib if isinstance(lib, str) else lib.get("name", "")
            for lib in included_libraries
            if isinstance(lib, str) or "name" in lib
        ]
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
    required_vars = [
        "PINECONE_API_KEY",
        "PINECONE_INDEX_NAME",
        "OPENAI_API_KEY",
        "OPENAI_EMBEDDINGS_MODEL",
        "OPENAI_EMBEDDINGS_DIMENSION",
        "PINECONE_INGEST_INDEX_NAME",
        "OPENAI_INGEST_EMBEDDINGS_MODEL",
        "OPENAI_INGEST_EMBEDDINGS_DIMENSION",
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
    """Get the Pinecone index object and validate dimensions."""
    try:
        index = pinecone_client.Index(index_name)
        stats = index.describe_index_stats()
        print(
            f"Connected to index '{index_name}'. Vectors: {stats['total_vector_count']}"
        )
        dimension = stats.get("dimension", "Unknown")
        print(
            f"Index '{index_name}' dimension: {dimension}, Expected: {expected_dimension}"
        )
        if dimension != expected_dimension:
            raise ValueError(
                f"Dimension mismatch for '{index_name}': expected {expected_dimension} for '{embedding_model}', got {dimension}."
            )
        if stats["total_vector_count"] == 0:
            print(f"WARNING: Index '{index_name}' is empty. Metrics will be zero.")
        return index
    except NotFoundException:
        print(f"ERROR: Pinecone index '{index_name}' not found.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR connecting to Pinecone index '{index_name}': {e}")
        sys.exit(1)


def load_evaluation_data(filepath=None):
    """Load evaluation data grouped by query."""
    if filepath is None:
        filepath = EVAL_DATASET_PATH
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
    """Generate embedding for text using OpenAI API with caching."""
    cache_key = get_text_hash(text, model_name)

    # Check if embedding is already cached
    if cache_key in EMBEDDING_CACHE:
        return EMBEDDING_CACHE[cache_key]

    try:
        response = openai_client.embeddings.create(input=text, model=model_name)
        embedding = response.data[0].embedding

        # Cache the result
        EMBEDDING_CACHE[cache_key] = embedding
        return embedding
    except Exception as e:
        print(f"ERROR generating embedding with {model_name}: {e}")
        return None


def get_embedding_similarity(text1, text2, embedding_model, openai_client):
    """Calculate semantic similarity between two texts using cached embeddings."""
    try:
        # Get embeddings for both texts (uses caching)
        embedding1 = get_embedding(text1, embedding_model, openai_client)
        embedding2 = get_embedding(text2, embedding_model, openai_client)

        if embedding1 is None or embedding2 is None:
            return 0.0

        embedding1 = np.array(embedding1)
        embedding2 = np.array(embedding2)

        # Calculate cosine similarity
        similarity = np.dot(embedding1, embedding2) / (
            np.linalg.norm(embedding1) * np.linalg.norm(embedding2)
        )
        return float(similarity)
    except Exception as e:
        print(f"    ERROR calculating embedding similarity: {e}")
        return 0.0


def match_chunks(retrieved_chunk, judged_chunks, embedding_model, openai_client):
    """Match a retrieved chunk to judged chunks by semantic similarity using embeddings."""
    best_match = None
    best_score = 0.0
    all_scores = []
    for judged in judged_chunks:
        similarity = get_embedding_similarity(
            retrieved_chunk, judged["document"], embedding_model, openai_client
        )
        all_scores.append(similarity)
        if similarity > best_score:
            best_score = similarity
            best_match = judged
    max_score = max(all_scores) if all_scores else 0.0
    print(
        f"    Chunk similarity: max={max_score:.3f}, top-3={[f'{s:.3f}' for s in sorted(all_scores, reverse=True)[:3]]}"
    )
    if best_score >= SIMILARITY_THRESHOLD:
        print(f"    ✓ Strict match (similarity={best_score:.3f})")
        return best_match
    elif best_score >= LENIENT_SIMILARITY_THRESHOLD:
        print(f"    ⚠ Lenient match (similarity={best_score:.3f})")
        return best_match
    else:
        print(f"    ✗ No match (best similarity={best_score:.3f})")
        return None


def retrieve_documents(
    index, query, embedding_model, top_k, openai_client, library_filter=None
):
    """Retrieve top-K documents from Pinecone without re-chunking."""
    start_time = time.time()
    query_embedding = get_embedding(query, embedding_model, openai_client)
    if query_embedding is None:
        return [], 0.0
    try:
        query_params = {
            "vector": query_embedding,
            "top_k": top_k,
            "include_metadata": True,
        }
        if library_filter:
            query_params["filter"] = library_filter
        results = index.query(**query_params)
        print(
            f"Query with model '{embedding_model}': {len(results['matches'])} matches"
        )
        for i, match in enumerate(results["matches"][:3]):
            print(
                f"Match {i + 1}: Score={match['score']:.4f}, Metadata={match['metadata']}"
            )
    except Exception as e:
        print(f"ERROR querying Pinecone: {e}")
        return [], 0.0
    documents = [
        {
            "document": match["metadata"].get("text", ""),
            "metadata": match["metadata"],
            "score": float(match["score"]),
        }
        for match in results["matches"]
    ]
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
    if (
        true_relevance.shape[1] == 0
        or predicted_scores.shape[1] == 0
        or np.sum(true_relevance) == 0
    ):
        return 0.0
    return ndcg_score(true_relevance, predicted_scores, k=k_val)


def evaluate_query_for_system(
    index,
    query,
    embedding_model,
    openai_client,
    judged_docs,
    system_name,
    library_filter=None,
):
    """Evaluate a single query for a specific system using original chunks."""
    docs, time_taken = retrieve_documents(
        index, query, embedding_model, K, openai_client, library_filter
    )
    for doc in docs:
        matched = match_chunks(
            doc["document"], judged_docs, embedding_model, openai_client
        )
        doc["relevance"] = matched["relevance"] if matched else 0.0
    precision = calculate_precision_at_k(docs, K)
    ndcg = calculate_ndcg_at_k(docs, K)
    chunks_for_review = [
        {
            "chunk": doc["document"][:200] + "...",
            "relevance": doc["relevance"],
            "score": doc["score"],
        }
        for doc in docs[:K]
    ]
    print(f"    {system_name} - Precision@{K}: {precision:.4f}, NDCG@{K}: {ndcg:.4f}")
    return {"precision": precision, "ndcg": ndcg}, time_taken, chunks_for_review


def initialize_metrics_storage(systems):
    """Initialize metrics storage for both systems."""
    metrics = {system["name"]: defaultdict(list) for system in systems}
    times = {system["name"]: [] for system in systems}
    return metrics, times


def update_overall_metrics(metrics, times, system, query_metrics, query_time):
    """Update overall metrics with results from a single query."""
    metrics[system]["precision"].append(query_metrics["precision"])
    metrics[system]["ndcg"].append(query_metrics["ndcg"])
    times[system].append(query_time)


def print_manual_review_report(retrieved_chunks):
    """Print retrieved chunks for manual review."""
    print("\n--- Retrieved Chunks for Manual Review ---")
    for (query, system), chunks in retrieved_chunks.items():
        print(f"\nQuery: {query[:50]}... | System: {system}")
        for i, chunk_info in enumerate(chunks[:K], 1):
            print(
                f"  Chunk {i}: Relevance={chunk_info['relevance']}, Score={chunk_info['score']:.4f}"
            )
            print(f"    Text: {chunk_info['chunk']}")


def print_average_metrics_report(metrics, times, query_count, systems):
    """Print average metrics for both systems."""
    print("\n--- Evaluation Results ---")
    print(f"Evaluated on {query_count} queries with K={K}")
    for system in systems:
        avg_precision = (
            np.mean(metrics[system["name"]]["precision"])
            if metrics[system["name"]]["precision"]
            else 0.0
        )
        avg_ndcg = (
            np.mean(metrics[system["name"]]["ndcg"])
            if metrics[system["name"]]["ndcg"]
            else 0.0
        )
        avg_time = np.mean(times[system["name"]]) if times[system["name"]] else 0.0
        print(f"\n{system['description']}:")
        print(f"    Avg Precision@{K}: {avg_precision:.4f}")
        print(f"    Avg NDCG@{K}:      {avg_ndcg:.4f}")
        print(f"    Avg Retrieval Time: {avg_time:.4f} seconds")


def print_comparison_table(metrics, times, systems):
    """Print comparison table for both systems."""
    print("\n--- Comparison Table ---")

    # Calculate the maximum description length to ensure proper alignment
    max_desc_length = max(len(system["description"]) for system in systems)
    # Add some padding and ensure minimum width
    desc_width = max(max_desc_length + 5, 40)

    # Calculate total table width
    total_width = desc_width + 12 + 10 + 10 + 3  # +3 for spaces between columns

    print(
        f"{'System':<{desc_width}} {'Precision@K':<12} {'NDCG@K':<10} {'Time (s)':<10}"
    )
    print("-" * total_width)
    for system in systems:
        avg_precision = (
            np.mean(metrics[system["name"]]["precision"])
            if metrics[system["name"]]["precision"]
            else 0.0
        )
        avg_ndcg = (
            np.mean(metrics[system["name"]]["ndcg"])
            if metrics[system["name"]]["ndcg"]
            else 0.0
        )
        avg_time = np.mean(times[system["name"]]) if times[system["name"]] else 0.0
        print(
            f"{system['description']:<{desc_width}} {avg_precision:<12.4f} {avg_ndcg:<10.4f} {avg_time:<10.4f}"
        )


# --- Main Evaluation Logic ---
def main():
    print("Starting RAG system evaluation using original Pinecone chunks...")
    parser = argparse.ArgumentParser(
        description="Evaluate RAG systems with original chunks."
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID to load environment variables (e.g., ananda)",
    )
    args = parser.parse_args()
    load_environment(args.site)
    included_libraries = load_site_config(args.site)
    library_filter = create_library_filter(included_libraries)
    openai.api_key = os.getenv("OPENAI_API_KEY")
    openai_client = OpenAI()
    pinecone_client = get_pinecone_client()

    # Get systems configuration with dynamic descriptions from environment variables
    systems = get_systems_config()

    indexes = {}
    for system in systems:
        index_name = os.getenv(system["index_env_var"])
        embedding_model = os.getenv(system["embedding_model_env_var"])
        dimension = int(os.getenv(system["dimension_env_var"]))
        indexes[system["name"]] = get_pinecone_index(
            pinecone_client, index_name, embedding_model, dimension
        )
    eval_data = load_evaluation_data()
    if not eval_data:
        return

    # Pre-compute embeddings for all unique texts to avoid redundant API calls
    # This dramatically speeds up evaluation from ~4 hours to ~15 minutes
    embedding_models = [
        os.getenv(system["embedding_model_env_var"]) for system in systems
    ]
    precompute_embeddings(eval_data, embedding_models, openai_client)

    metrics, times = initialize_metrics_storage(systems)
    retrieved_chunks = defaultdict(list)
    query_count = len(eval_data)
    print(f"Processing {query_count} queries...")
    for processed_queries, (query, judged_docs) in enumerate(eval_data.items(), 1):
        print(f"  Query {processed_queries}/{query_count}: '{query[:50]}...'")
        for system in systems:
            query_metrics, query_time, chunks = evaluate_query_for_system(
                indexes[system["name"]],
                query,
                os.getenv(system["embedding_model_env_var"]),
                openai_client,
                judged_docs,
                system["description"],
                library_filter,
            )
            update_overall_metrics(
                metrics, times, system["name"], query_metrics, query_time
            )
            retrieved_chunks[(query, system["description"])] = chunks
    print_manual_review_report(retrieved_chunks)
    print_average_metrics_report(metrics, times, query_count, systems)
    print_comparison_table(metrics, times, systems)


if __name__ == "__main__":
    main()
