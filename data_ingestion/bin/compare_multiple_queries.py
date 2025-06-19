#!/usr/bin/env python3
"""
Compare multiple representative queries between current and new Pinecone systems.
Tests diverse queries to understand system performance differences across various query types.
"""

import argparse
import json
import os
import sys
from collections import defaultdict

import numpy as np
from openai import OpenAI

# Add the project root to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.embeddings_utils import OpenAIEmbeddings
from utils.pinecone_utils import get_pinecone_client

from pyutil.env_utils import load_env


def load_environment(site: str):
    """Load environment variables based on the site."""
    try:
        load_env(site)
        print(f"Loaded environment for site: {site}")
    except Exception as e:
        print(f"ERROR loading environment: {e}")
        sys.exit(1)
    required_vars = [
        "PINECONE_INDEX_NAME",
        "PINECONE_INGEST_INDEX_NAME",
        "OPENAI_API_KEY",
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(
            f"ERROR: Missing required environment variables: {', '.join(missing_vars)}"
        )
        sys.exit(1)


def query_pinecone(query_text: str, index_name: str, top_k: int = 5):
    """Query Pinecone index and return results."""
    # Get Pinecone client and index
    client = get_pinecone_client()
    index = client.Index(index_name)

    # Get embedding using OpenAI embeddings utility
    embeddings_client = OpenAIEmbeddings()
    query_embedding = embeddings_client.embed_query(query_text)

    # Query Pinecone
    results = index.query(
        vector=query_embedding, top_k=top_k, include_values=False, include_metadata=True
    )

    return results.get("matches", [])


def get_embeddings(
    client: OpenAI, texts: list[str], model: str = "text-embedding-ada-002"
) -> list[list[float]]:
    """Get embeddings for a list of texts using OpenAI."""
    try:
        response = client.embeddings.create(input=texts, model=model)
        return [embedding.embedding for embedding in response.data]
    except Exception as e:
        print(f"Error getting embeddings: {e}")
        return []


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)

    dot_product = np.dot(a_np, b_np)
    norm_a = np.linalg.norm(a_np)
    norm_b = np.linalg.norm(b_np)

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return dot_product / (norm_a * norm_b)


def calculate_semantic_similarity(
    client: OpenAI,
    chunk_text: str,
    judged_texts: list[str],
    strict_threshold: float = 0.85,
    lenient_threshold: float = 0.70,
) -> tuple[float, str]:
    """
    Calculate semantic similarity between chunk and judged documents using embeddings.
    Returns the highest similarity score and match type.
    """
    if not judged_texts:
        return 0.0, "no_match"

    # Get embeddings
    all_texts = [chunk_text] + judged_texts
    embeddings = get_embeddings(client, all_texts)

    if not embeddings or len(embeddings) < len(all_texts):
        print("Warning: Failed to get embeddings, falling back to textual similarity")
        # Fallback to textual similarity if embeddings fail
        import difflib

        best_score = 0.0
        for judged_text in judged_texts:
            score = difflib.SequenceMatcher(
                None, chunk_text.lower(), judged_text.lower()
            ).ratio()
            best_score = max(best_score, score)

        if best_score >= 0.85:
            return best_score, "strict_match"
        elif best_score >= 0.35:
            return best_score, "lenient_match"
        else:
            return best_score, "no_match"

    chunk_embedding = embeddings[0]
    judged_embeddings = embeddings[1:]

    # Calculate similarities
    similarities = []
    for judged_embedding in judged_embeddings:
        similarity = cosine_similarity(chunk_embedding, judged_embedding)
        similarities.append(similarity)

    best_similarity = max(similarities) if similarities else 0.0

    # Determine match type based on thresholds
    if best_similarity >= strict_threshold:
        return best_similarity, "strict_match"
    elif best_similarity >= lenient_threshold:
        return best_similarity, "lenient_match"
    else:
        return best_similarity, "no_match"


def select_diverse_queries(dataset_path: str, num_queries: int = 5) -> list[str]:
    """
    Select diverse representative queries from the evaluation dataset.
    Chooses queries with different characteristics (length, topic, complexity).
    """
    # Pre-selected diverse queries based on dataset analysis
    diverse_queries = [
        "How to change habits from being night owl to early riser?",  # Practical advice
        "what is hong sau technique",  # Technical/spiritual practice
        "how does hong sau progress into kriya yoga",  # Advanced spiritual progression
        "how do you improve willingness",  # Personal development
        "end of life decision",  # Philosophical/ethical (original representative query)
    ]

    # Verify these queries exist in the dataset
    existing_queries = set()
    with open(dataset_path) as f:
        for line in f:
            data = json.loads(line.strip())
            existing_queries.add(data["query"].lower())

    # Filter to only include queries that exist in the dataset
    valid_queries = []
    for query in diverse_queries:
        if query.lower() in existing_queries:
            valid_queries.append(query)

    # If we need more queries, add some from the dataset
    if len(valid_queries) < num_queries:
        print(
            f"Warning: Only found {len(valid_queries)} of {len(diverse_queries)} pre-selected queries"
        )
        print("Available queries will be used")

    return valid_queries[:num_queries]


def analyze_query(
    client: OpenAI,
    query_text: str,
    judged_docs: list[dict],
    current_index_name: str,
    new_index_name: str,
) -> dict:
    """Analyze a single query and return results."""
    print(f"\n{'=' * 60}")
    print(f"ANALYZING QUERY: {query_text}")
    print(f"{'=' * 60}")
    print(f"Judged documents: {len(judged_docs)}")

    # Extract judged document texts for comparison
    judged_texts = [doc.get("text", "").strip() for doc in judged_docs]

    # Query both systems
    print("\nQuerying current system...")
    current_results = query_pinecone(query_text, current_index_name, top_k=5)

    print("Querying new system...")
    new_results = query_pinecone(query_text, new_index_name, top_k=5)

    # Analyze both systems
    current_analysis = analyze_system_results(
        client, "CURRENT", current_results, judged_texts
    )
    new_analysis = analyze_system_results(client, "NEW", new_results, judged_texts)

    return {
        "query": query_text,
        "judged_docs_count": len(judged_docs),
        "current": current_analysis,
        "new": new_analysis,
    }


def analyze_system_results(
    client: OpenAI, system_name: str, results: list, judged_texts: list[str]
) -> dict:
    """Analyze results from one system."""
    print(f"\n{system_name} SYSTEM ANALYSIS:")
    print("-" * 40)

    if not results:
        print("No results returned!")
        return {
            "chunks_returned": 0,
            "strict_matches": 0,
            "lenient_matches": 0,
            "no_matches": 0,
            "strict_precision": 0.0,
            "lenient_precision": 0.0,
            "avg_similarity": 0.0,
            "avg_pinecone_score": 0.0,
        }

    match_counts = {"strict_match": 0, "lenient_match": 0, "no_match": 0}
    similarities = []
    pinecone_scores = []

    for i, result in enumerate(results, 1):
        chunk_text = result.get("metadata", {}).get("text", "")
        pinecone_score = result.get("score", 0.0)
        pinecone_scores.append(pinecone_score)

        # Calculate semantic similarity
        similarity, match_type = calculate_semantic_similarity(
            client, chunk_text, judged_texts
        )
        similarities.append(similarity)
        match_counts[match_type] += 1

        print(f"Chunk {i}:")
        print(f"  Pinecone score: {pinecone_score:.4f}")
        print(f"  Semantic similarity: {similarity:.4f} ({match_type})")
        print(f"  Text preview: {chunk_text[:100]}...")
        print()

    # Calculate metrics
    total_chunks = len(results)
    strict_precision = match_counts["strict_match"] / total_chunks
    lenient_precision = (
        match_counts["strict_match"] + match_counts["lenient_match"]
    ) / total_chunks
    avg_similarity = np.mean(similarities) if similarities else 0.0
    avg_pinecone_score = np.mean(pinecone_scores) if pinecone_scores else 0.0

    print("SUMMARY:")
    print(f"  Chunks returned: {total_chunks}")
    print(f"  Strict matches: {match_counts['strict_match']}")
    print(f"  Lenient matches: {match_counts['lenient_match']}")
    print(f"  No matches: {match_counts['no_match']}")
    print(f"  Strict precision: {strict_precision:.2%}")
    print(f"  Lenient precision: {lenient_precision:.2%}")
    print(f"  Average similarity: {avg_similarity:.4f}")
    print(f"  Average Pinecone score: {avg_pinecone_score:.4f}")

    return {
        "chunks_returned": total_chunks,
        "strict_matches": match_counts["strict_match"],
        "lenient_matches": match_counts["lenient_match"],
        "no_matches": match_counts["no_match"],
        "strict_precision": strict_precision,
        "lenient_precision": lenient_precision,
        "avg_similarity": avg_similarity,
        "avg_pinecone_score": avg_pinecone_score,
    }


def print_overall_summary(results: list[dict]):
    """Print overall summary across all queries."""
    print(f"\n{'=' * 80}")
    print("OVERALL SUMMARY ACROSS ALL QUERIES")
    print(f"{'=' * 80}")

    # Aggregate metrics
    current_metrics = []
    new_metrics = []

    for result in results:
        current_metrics.append(result["current"])
        new_metrics.append(result["new"])

    # Calculate averages
    def avg_metric(metrics_list, key):
        values = [m[key] for m in metrics_list if m[key] is not None]
        return np.mean(values) if values else 0.0

    print(f"{'Metric':<25} {'Current':<12} {'New':<12} {'Difference':<12}")
    print("-" * 61)

    metrics_to_compare = [
        ("Strict Precision", "strict_precision"),
        ("Lenient Precision", "lenient_precision"),
        ("Avg Similarity", "avg_similarity"),
        ("Avg Pinecone Score", "avg_pinecone_score"),
    ]

    for metric_name, metric_key in metrics_to_compare:
        current_avg = avg_metric(current_metrics, metric_key)
        new_avg = avg_metric(new_metrics, metric_key)
        difference = new_avg - current_avg

        if metric_key.endswith("_precision"):
            print(
                f"{metric_name:<25} {current_avg:<12.2%} {new_avg:<12.2%} {difference:<+12.2%}"
            )
        else:
            print(
                f"{metric_name:<25} {current_avg:<12.4f} {new_avg:<12.4f} {difference:<+12.4f}"
            )

    print()
    print("QUERY-BY-QUERY COMPARISON:")
    print("-" * 80)
    for result in results:
        query = result["query"]
        current_strict = result["current"]["strict_precision"]
        new_strict = result["new"]["strict_precision"]
        difference = new_strict - current_strict

        print(f"Query: {query[:50]}...")
        print(
            f"  Current: {current_strict:.2%}, New: {new_strict:.2%}, Diff: {difference:+.2%}"
        )
        print()


def analyze_multiple_queries(site: str, num_queries: int = 5) -> None:
    """Analyze multiple representative queries with embedding-based semantic similarity."""

    # Initialize OpenAI client
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    if not client.api_key:
        print("Error: OPENAI_API_KEY environment variable not set")
        return

    # Load evaluation dataset
    dataset_path = f"../reranking/evaluation_dataset_{site}.jsonl"
    if not os.path.exists(dataset_path):
        print(f"Error: Dataset file not found: {dataset_path}")
        return

    # Select diverse queries
    selected_queries = select_diverse_queries(dataset_path, num_queries)
    print(f"Selected {len(selected_queries)} queries for analysis:")
    for i, query in enumerate(selected_queries, 1):
        print(f"  {i}. {query}")
    print()

    # Group documents by query
    query_docs = defaultdict(list)
    with open(dataset_path) as f:
        for line in f:
            data = json.loads(line.strip())
            query = data["query"]
            if query in selected_queries:
                query_docs[query].append(
                    {"text": data["document"], "relevance": data["relevance"]}
                )

    # Get index names from environment variables
    current_index_name = os.getenv("PINECONE_INDEX_NAME")
    new_index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")

    if not current_index_name or not new_index_name:
        print("Error: Pinecone index names not found in environment variables")
        return

    print(f"Current system index: {current_index_name}")
    print(f"New system index: {new_index_name}")

    # Analyze each query
    all_results = []
    for query in selected_queries:
        judged_docs = query_docs.get(query, [])
        if not judged_docs:
            print(f"Warning: No judged documents found for query '{query}'")
            continue

        result = analyze_query(
            client, query, judged_docs, current_index_name, new_index_name
        )
        all_results.append(result)

    # Print overall summary
    if all_results:
        print_overall_summary(all_results)
    else:
        print("No results to analyze!")


def main():
    """Main function."""
    parser = argparse.ArgumentParser(
        description="Compare multiple representative queries between current and new Pinecone systems"
    )
    parser.add_argument(
        "--site",
        default="ananda",
        help="Site configuration to use (default: ananda)",
    )
    parser.add_argument(
        "--num-queries",
        type=int,
        default=5,
        help="Number of queries to analyze (default: 5)",
    )

    args = parser.parse_args()

    # Load environment
    load_environment(args.site)

    # Run analysis
    analyze_multiple_queries(args.site, args.num_queries)


if __name__ == "__main__":
    main()
