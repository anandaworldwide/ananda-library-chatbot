#!/usr/bin/env python3
"""
Compare representative query results between current and new Pinecone systems.
Focuses on understanding why the new system shows lower performance metrics.
"""

import argparse
import json
import os
import sys

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


def analyze_representative_query(site: str) -> None:
    """Analyze the representative query with embedding-based semantic similarity."""

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

    # Find all documents for the representative query (end of life decision)
    query_text = "end of life decision"
    judged_docs = []

    with open(dataset_path) as f:
        for line in f:
            data = json.loads(line.strip())
            if data["query"].lower() == query_text.lower():
                judged_docs.append(
                    {"text": data["document"], "relevance": data["relevance"]}
                )

    if not judged_docs:
        print(f"Error: No documents found for query '{query_text}' in dataset")
        return

    print("=" * 80)
    print("EMBEDDING-BASED SEMANTIC SIMILARITY ANALYSIS")
    print("=" * 80)
    print(f"Query: {query_text}")
    print(f"Judged documents: {len(judged_docs)}")
    print()

    # Extract judged document texts for comparison
    judged_texts = []
    print("JUDGED DOCUMENTS:")
    for i, doc in enumerate(judged_docs, 1):
        relevance = doc.get("relevance", 0)
        text = doc.get("text", "").strip()
        judged_texts.append(text)
        print(
            f"Doc {i} (relevance {relevance}): {text[:100]}..."
            if len(text) > 100
            else f"Doc {i} (relevance {relevance}): {text}"
        )
    print()

    # Get index names from environment variables
    current_index_name = os.getenv("PINECONE_INDEX_NAME")
    new_index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")

    if not current_index_name or not new_index_name:
        print("Error: Missing Pinecone index names in environment variables.")
        return

    print(f"Current system index: {current_index_name}")
    print(f"New system index: {new_index_name}")
    print()

    # Retrieve top-5 chunks from both systems
    print("RETRIEVING TOP-5 CHUNKS FROM BOTH SYSTEMS...")

    try:
        current_results = query_pinecone(query_text, current_index_name, top_k=5)
        new_results = query_pinecone(query_text, new_index_name, top_k=5)
    except Exception as e:
        print(f"Error querying Pinecone: {e}")
        return

    # Analyze current system results
    print("=" * 50)
    print(f"CURRENT SYSTEM RESULTS ({current_index_name})")
    print("=" * 50)

    current_relevance_scores = []
    for i, result in enumerate(current_results, 1):
        chunk_text = result.metadata.get("text", "")
        pinecone_score = result.score

        # Calculate semantic similarity using embeddings
        similarity_score, match_type = calculate_semantic_similarity(
            client, chunk_text, judged_texts
        )
        current_relevance_scores.append(similarity_score)

        print(f"RANK {i} - Pinecone Score: {pinecone_score:.4f}")
        print(f"Semantic Similarity: {similarity_score:.4f} ({match_type})")
        print(
            f"Text: {chunk_text[:200]}..."
            if len(chunk_text) > 200
            else f"Text: {chunk_text}"
        )
        print("-" * 50)

    # Analyze new system results
    print("=" * 50)
    print(f"NEW SYSTEM RESULTS ({new_index_name})")
    print("=" * 50)

    new_relevance_scores = []
    for i, result in enumerate(new_results, 1):
        chunk_text = result.metadata.get("text", "")
        pinecone_score = result.score

        # Calculate semantic similarity using embeddings
        similarity_score, match_type = calculate_semantic_similarity(
            client, chunk_text, judged_texts
        )
        new_relevance_scores.append(similarity_score)

        print(f"RANK {i} - Pinecone Score: {pinecone_score:.4f}")
        print(f"Semantic Similarity: {similarity_score:.4f} ({match_type})")
        print(
            f"Text: {chunk_text[:200]}..."
            if len(chunk_text) > 200
            else f"Text: {chunk_text}"
        )
        print("-" * 50)

    # Calculate precision metrics using embedding-based similarity
    strict_threshold = 0.85
    lenient_threshold = 0.70

    # Current system precision
    current_strict_matches = sum(
        1 for score in current_relevance_scores if score >= strict_threshold
    )
    current_lenient_matches = sum(
        1 for score in current_relevance_scores if score >= lenient_threshold
    )
    current_strict_precision = current_strict_matches / 5
    current_lenient_precision = current_lenient_matches / 5

    # New system precision
    new_strict_matches = sum(
        1 for score in new_relevance_scores if score >= strict_threshold
    )
    new_lenient_matches = sum(
        1 for score in new_relevance_scores if score >= lenient_threshold
    )
    new_strict_precision = new_strict_matches / 5
    new_lenient_precision = new_lenient_matches / 5

    # Summary comparison
    print("=" * 80)
    print("EMBEDDING-BASED PRECISION COMPARISON SUMMARY")
    print("=" * 80)
    print("Using semantic similarity thresholds:")
    print(f"  - Strict threshold: {strict_threshold} (cosine similarity)")
    print(f"  - Lenient threshold: {lenient_threshold} (cosine similarity)")
    print()

    print(f"CURRENT SYSTEM ({current_index_name}):")
    print(
        f"  Strict Precision@5:  {current_strict_precision:.1%} ({current_strict_matches}/5)"
    )
    print(
        f"  Lenient Precision@5: {current_lenient_precision:.1%} ({current_lenient_matches}/5)"
    )
    print(f"  Avg Semantic Score:  {np.mean(current_relevance_scores):.3f}")
    print()

    print(f"NEW SYSTEM ({new_index_name}):")
    print(f"  Strict Precision@5:  {new_strict_precision:.1%} ({new_strict_matches}/5)")
    print(
        f"  Lenient Precision@5: {new_lenient_precision:.1%} ({new_lenient_matches}/5)"
    )
    print(f"  Avg Semantic Score:  {np.mean(new_relevance_scores):.3f}")
    print()

    # Performance gap analysis
    strict_gap = current_strict_precision - new_strict_precision
    lenient_gap = current_lenient_precision - new_lenient_precision

    print("PERFORMANCE GAP:")
    print(f"  Strict Precision Gap:  {strict_gap:+.1%}")
    print(f"  Lenient Precision Gap: {lenient_gap:+.1%}")
    print()

    if strict_gap > 0.2 or lenient_gap > 0.2:
        print("❌ SIGNIFICANT PERFORMANCE GAP DETECTED")
        print("   The new system shows substantially lower semantic similarity")
        print("   to judged relevant documents.")
    elif abs(strict_gap) < 0.1 and abs(lenient_gap) < 0.1:
        print("✅ MINIMAL PERFORMANCE GAP")
        print("   Both systems show similar semantic relevance when properly measured.")
        print("   Previous textual-similarity evaluation may have been flawed.")
    else:
        print("⚠️  MODERATE PERFORMANCE DIFFERENCE")
        print("   Further investigation needed to determine significance.")

    print()
    print("=" * 80)
    print("CONCLUSION")
    print("=" * 80)
    print("This analysis uses embedding-based semantic similarity instead of")
    print("textual overlap, providing a more accurate assessment of relevance.")
    print("If both systems show similar semantic scores, the original 70%")
    print("performance drop may have been due to evaluation methodology issues")
    print("rather than actual retrieval quality problems.")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Compare representative query results using embedding-based semantic similarity"
    )
    parser.add_argument(
        "--site",
        required=True,
        choices=["ananda", "crystal", "jairam"],
        help="Site configuration to use",
    )

    args = parser.parse_args()

    # Load environment for the site at the beginning
    load_environment(args.site)

    analyze_representative_query(args.site)


if __name__ == "__main__":
    main()
