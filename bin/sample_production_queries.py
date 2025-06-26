#!/usr/bin/env python3
"""
Sample diverse production queries for unbiased RAG system evaluation.

This script extracts 25-30 representative queries from production Firestore chatLogs,
ensuring diversity across:
- Time periods (recent vs historical)
- Query lengths (short vs long)
- Topic diversity (using semantic clustering)
- Question types (factual vs interpretive)

The sampled queries avoid synthetic bias and represent real user patterns.
"""

import argparse
import json
import os
import random
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

import numpy as np
from openai import OpenAI
from sklearn.cluster import KMeans

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from bin.firestore_utils import initialize_firestore
from pyutil.env_utils import load_env


def get_embedding(
    text: str, client: OpenAI, model: str = "text-embedding-ada-002"
) -> list[float]:
    """Get OpenAI embedding for text."""
    try:
        response = client.embeddings.create(input=text.strip(), model=model)
        return response.data[0].embedding
    except Exception as e:
        print(f"Error getting embedding: {e}")
        return []


def load_production_queries(
    db, env_prefix: str, days_back: int = 90, min_length: int = 10
) -> list[dict]:
    """Load production queries from Firestore chatLogs."""
    collection_name = f"{env_prefix}_chatLogs"

    # Calculate date range
    now = datetime.now()
    cutoff_date = now - timedelta(days=days_back)

    print(
        f"Loading queries from {collection_name} since {cutoff_date.strftime('%Y-%m-%d')}..."
    )

    # Query Firestore
    query = db.collection(collection_name).where("timestamp", ">=", cutoff_date)
    docs = query.stream()

    queries = []
    for doc in docs:
        data = doc.to_dict()
        question = data.get("question", "").strip()

        # Filter criteria
        if (
            len(question) >= min_length
            and question.lower() != "private"
            and not question.startswith("test")
            and question.count(" ") >= 2  # At least 3 words
        ):
            queries.append(
                {
                    "id": doc.id,
                    "question": question,
                    "timestamp": data.get("timestamp"),
                    "collection": data.get("collection", "unknown"),
                    "word_count": len(question.split()),
                    "char_count": len(question),
                }
            )

    print(f"Loaded {len(queries)} qualifying queries")
    return queries


def calculate_diversity_metrics(queries: list[dict], client: OpenAI) -> list[dict]:
    """Calculate embeddings and diversity metrics for queries."""
    print("Calculating embeddings for semantic clustering...")

    # Get embeddings for all queries
    embeddings = []
    for i, query in enumerate(queries):
        if i % 50 == 0:
            print(f"Processing query {i + 1}/{len(queries)}")

        embedding = get_embedding(query["question"], client)
        if embedding:
            embeddings.append(embedding)
            query["embedding"] = embedding
        else:
            query["embedding"] = None

    print(
        f"Got embeddings for {len([q for q in queries if q.get('embedding')])} queries"
    )
    return queries


def perform_semantic_clustering(
    queries: list[dict], n_clusters: int = 8
) -> tuple[list[dict], list[int]]:
    """Perform K-means clustering on query embeddings."""
    # Filter queries with valid embeddings
    valid_queries = [q for q in queries if q.get("embedding")]
    embeddings_matrix = np.array([q["embedding"] for q in valid_queries])

    if len(valid_queries) < n_clusters:
        print(
            f"Warning: Only {len(valid_queries)} valid queries, reducing clusters to {len(valid_queries)}"
        )
        n_clusters = len(valid_queries)

    # Perform clustering
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    cluster_labels = kmeans.fit_predict(embeddings_matrix)

    # Add cluster info to queries
    for i, query in enumerate(valid_queries):
        query["cluster"] = cluster_labels[i]

    print(f"Clustered queries into {n_clusters} semantic groups")

    # Print cluster summary
    cluster_counts = Counter(cluster_labels)
    for cluster_id, count in sorted(cluster_counts.items()):
        print(f"  Cluster {cluster_id}: {count} queries")

    return valid_queries, cluster_labels


def stratified_sampling(queries: list[dict], target_count: int = 27) -> list[dict]:
    """
    Perform stratified sampling to ensure diversity across multiple dimensions.
    """
    print(f"Performing stratified sampling to select {target_count} queries...")

    # Group queries by cluster
    clusters = defaultdict(list)
    for query in queries:
        cluster_id = query.get("cluster", 0)
        clusters[cluster_id].append(query)

    # Target: roughly equal representation from each cluster
    queries_per_cluster = max(1, target_count // len(clusters))
    remainder = target_count % len(clusters)

    sampled_queries = []

    for cluster_id, cluster_queries in clusters.items():
        # Add bonus query to some clusters to handle remainder
        cluster_target = queries_per_cluster + (1 if cluster_id < remainder else 0)

        # Sort by recency and length for diversity
        cluster_queries.sort(
            key=lambda q: (q.get("timestamp", datetime.min), q["word_count"]),
            reverse=True,
        )

        # Sample from this cluster with stratification
        if len(cluster_queries) <= cluster_target:
            selected = cluster_queries
        else:
            # Stratify by length (short/medium/long)
            short = [q for q in cluster_queries if q["word_count"] <= 8]
            medium = [q for q in cluster_queries if 8 < q["word_count"] <= 20]
            long = [q for q in cluster_queries if q["word_count"] > 20]

            selected = []

            # Distribute selections across length categories
            for _category, category_queries in [
                ("short", short),
                ("medium", medium),
                ("long", long),
            ]:
                if category_queries and len(selected) < cluster_target:
                    remaining_slots = cluster_target - len(selected)
                    take = min(
                        remaining_slots,
                        len(category_queries),
                        max(1, remaining_slots // 3),
                    )
                    selected.extend(random.sample(category_queries, take))

            # Fill remaining slots randomly if needed
            if len(selected) < cluster_target:
                remaining = [q for q in cluster_queries if q not in selected]
                if remaining:
                    additional_needed = cluster_target - len(selected)
                    selected.extend(
                        random.sample(remaining, min(additional_needed, len(remaining)))
                    )

        print(
            f"  Cluster {cluster_id}: selected {len(selected)}/{len(cluster_queries)} queries"
        )
        sampled_queries.extend(selected)

    # Final random shuffle and trim to exact count
    random.shuffle(sampled_queries)
    sampled_queries = sampled_queries[:target_count]

    print(f"Final sample: {len(sampled_queries)} queries")
    return sampled_queries


def analyze_sample_diversity(queries: list[dict]) -> None:
    """Analyze and report diversity metrics of the final sample."""
    print("\n" + "=" * 50)
    print("SAMPLE DIVERSITY ANALYSIS")
    print("=" * 50)

    # Length distribution
    word_counts = [q["word_count"] for q in queries]
    print(
        f"Word count - Min: {min(word_counts)}, Max: {max(word_counts)}, Avg: {np.mean(word_counts):.1f}"
    )

    short = len([q for q in queries if q["word_count"] <= 8])
    medium = len([q for q in queries if 8 < q["word_count"] <= 20])
    long = len([q for q in queries if q["word_count"] > 20])
    print(
        f"Length distribution - Short (≤8): {short}, Medium (9-20): {medium}, Long (>20): {long}"
    )

    # Cluster distribution
    clusters = Counter(q.get("cluster", 0) for q in queries)
    print(f"Semantic clusters: {dict(clusters)}")

    # Collection distribution
    collections = Counter(q.get("collection", "unknown") for q in queries)
    print(f"Collections: {dict(collections)}")

    # Time distribution (if timestamps available)
    recent_queries = [
        q
        for q in queries
        if q.get("timestamp")
        and (datetime.now() - q["timestamp"].replace(tzinfo=None)).days <= 30
    ]
    print(f"Recent queries (≤30 days): {len(recent_queries)}/{len(queries)}")


def save_sample(queries: list[dict], output_file: str) -> None:
    """Save sampled queries to JSON file."""
    # Clean queries for JSON serialization
    output_queries = []
    for q in queries:
        output_query = {
            "id": q["id"],
            "question": q["question"],
            "word_count": int(q["word_count"]),
            "char_count": int(q["char_count"]),
            "collection": q.get("collection", "unknown"),
            "cluster": int(q.get("cluster", 0)),
        }

        # Handle timestamp
        if q.get("timestamp"):
            try:
                if hasattr(q["timestamp"], "seconds"):  # Firestore timestamp
                    output_query["timestamp"] = datetime.fromtimestamp(
                        q["timestamp"].seconds
                    ).isoformat()
                else:
                    output_query["timestamp"] = q["timestamp"].isoformat()
            except:
                output_query["timestamp"] = str(q["timestamp"])

        output_queries.append(output_query)

    with open(output_file, "w") as f:
        json.dump(
            {
                "metadata": {
                    "sampling_date": datetime.now().isoformat(),
                    "total_queries": len(output_queries),
                    "description": "Production queries sampled for unbiased RAG evaluation",
                },
                "queries": output_queries,
            },
            f,
            indent=2,
        )

    print(f"\nSaved {len(output_queries)} queries to {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Sample diverse production queries for RAG evaluation"
    )
    parser.add_argument(
        "--site", required=True, help="Site ID for environment variables"
    )
    parser.add_argument(
        "--env",
        choices=["dev", "prod"],
        required=True,
        help="Environment (dev or prod)",
    )
    parser.add_argument(
        "--output", default="production_query_sample.json", help="Output JSON file"
    )
    parser.add_argument(
        "--count", type=int, default=27, help="Number of queries to sample"
    )
    parser.add_argument("--days", type=int, default=90, help="Days back to sample from")

    args = parser.parse_args()

    # Load environment
    load_env(args.site)

    # Initialize clients
    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    db = initialize_firestore(args.env)

    print(f"Sampling {args.count} queries from last {args.days} days...")

    # Load production queries
    queries = load_production_queries(db, args.env, args.days)

    if len(queries) < args.count:
        print(
            f"Warning: Only found {len(queries)} queries, less than target {args.count}"
        )
        args.count = len(queries)

    # Calculate embeddings and perform clustering
    queries = calculate_diversity_metrics(queries, openai_client)
    valid_queries, _ = perform_semantic_clustering(queries)

    # Perform stratified sampling
    random.seed(42)  # For reproducible sampling
    sampled_queries = stratified_sampling(valid_queries, args.count)

    # Analyze diversity
    analyze_sample_diversity(sampled_queries)

    # Save results
    save_sample(sampled_queries, args.output)

    print(
        f"\n✅ Successfully sampled {len(sampled_queries)} diverse production queries"
    )
    print("Next steps:")
    print(f"1. Review {args.output} for quality")
    print(f"2. Run: python bin/dual_system_retrieval.py --queries {args.output}")
    print("3. Manually evaluate results using the evaluation interface")


if __name__ == "__main__":
    main()
