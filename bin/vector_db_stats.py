#!/usr/bin/env python

"""
Vector Database Statistics Generator

This script analyzes a Pinecone vector database to generate statistics about stored vectors,
specifically counting occurrences of metadata fields (author, library, type). It uses
the query API with dummy vectors for much faster metadata retrieval.

Usage:
    python bin/vector_db_stats.py --site <site_id> [--prefix <id_prefix>]

Example:
    python bin/vector_db_stats.py --site ananda
    python bin/vector_db_stats.py --site ananda --prefix "text||Crystal Clarity||"
"""

import argparse
import os
import sys
import time
from collections import Counter

from pinecone import Pinecone
from tqdm import tqdm

# Add parent directory to Python path for importing utility modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from pyutil.env_utils import load_env


def get_pinecone_stats(id_prefix=None):
    """
    Retrieves and aggregates statistics from Pinecone vectors using query API.
    Much faster than fetching full vector data since we only need metadata.

    Args:
        id_prefix (str, optional): Filter vectors by ID prefix
    """
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")
    if not index_name:
        raise ValueError("PINECONE_INGEST_INDEX_NAME environment variable not set.")
    index = pc.Index(index_name)

    stats = {"author": Counter(), "library": Counter(), "type": Counter()}

    # Get index info
    index_stats = index.describe_index_stats()
    dimension = index_stats.dimension
    total_vectors = index_stats.total_vector_count

    print(f"Index has {total_vectors:,} total vectors with {dimension} dimensions")

    # Create a dummy query vector (all zeros works fine for metadata retrieval)
    dummy_vector = [0.0] * dimension

    # Query in large batches to get metadata
    batch_size = 10000  # Much larger batches since we're not fetching full data
    total_processed = 0

    print(f"Querying vectors in batches of {batch_size:,}...")
    pbar = tqdm(total=total_vectors, desc="Processing vectors")

    # Use query with include_metadata to get metadata without vector values
    while total_processed < total_vectors:
        try:
            # Prepare query filter
            if id_prefix:
                # For prefix filtering, we need to use a different approach
                # since Pinecone filters work on metadata, not IDs
                print(
                    f"Note: Prefix filtering '{id_prefix}' not directly supported in query API"
                )
                print("Processing all vectors and filtering results...")

            # Query for vectors
            query_result = index.query(
                vector=dummy_vector,
                top_k=min(batch_size, total_vectors - total_processed),
                include_metadata=True,
                include_values=False,  # Don't include vector values - just metadata
            )

            if not query_result.matches:
                print("No more results found")
                break

            # Process the metadata from this batch
            for match in query_result.matches:
                # Apply prefix filter if specified (since query API doesn't support ID prefix)
                if id_prefix and not match.id.startswith(id_prefix):
                    continue

                metadata = match.metadata or {}
                if metadata:
                    # Update counters for each metadata field if present
                    for field in ["author", "library", "type"]:
                        if field in metadata:
                            stats[field][metadata[field]] += 1

            total_processed += len(query_result.matches)
            pbar.update(len(query_result.matches))

            # If we got fewer results than requested, we've reached the end
            if len(query_result.matches) < batch_size:
                break

        except Exception as e:
            print(f"\nError in batch starting at {total_processed}: {e}")
            break

    pbar.close()
    print(f"\nProcessed metadata for {total_processed:,} vectors.")
    return stats


def print_stats(stats):
    """
    Prints formatted statistics for each metadata category.

    Args:
        stats: Dictionary containing Counters for each metadata field
    """
    for category, counter in stats.items():
        print(f"\n{category.upper()} STATS:")
        for item, count in counter.most_common():
            print(f"  {item}: {count:,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get Pinecone vector statistics")
    parser.add_argument(
        "--site", required=True, help="Site ID for environment variables"
    )
    parser.add_argument("--prefix", help="Filter vectors by ID prefix")
    args = parser.parse_args()

    # Load environment variables for the specified site
    load_env(args.site)

    start_time = time.time()
    stats = get_pinecone_stats(args.prefix)
    end_time = time.time()

    print(f"\nCompleted in {end_time - start_time:.1f} seconds")
    print_stats(stats)
