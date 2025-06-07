#!/usr/bin/env python3
"""
Audits Pinecone index 'ananda-2025-06-01--ada-002' for duplicate chunks using text and embedding similarity.
Checks document hashes to identify source documents. Generates a report of duplicates.
"""

import logging
import os
import sys
from collections import defaultdict

import pandas as pd
from pinecone import Pinecone

from pyutil.env_utils import load_env

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Configuration
INDEX_NAME = "ananda-2025-06-01--ada-002"
BATCH_SIZE = 50  # Reduced to avoid "Request-URI Too Large" error
MAX_VECTORS_TO_PROCESS = None  # Limit for testing, set to None for all vectors
OUTPUT_REPORT = "duplicate_report.csv"


def initialize_pinecone():
    """Initialize Pinecone client and connect to index."""
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        logger.error("PINECONE_API_KEY not found in environment variables.")
        sys.exit(1)
    pc = Pinecone(api_key=api_key)
    index = pc.Index(INDEX_NAME)
    stats = index.describe_index_stats()
    logger.info(
        f"Connected to index '{INDEX_NAME}'. Total vectors: {stats['total_vector_count']}"
    )
    return index


def fetch_vectors(index, namespace=""):
    """Fetch all vectors and metadata in batches."""
    vectors = []
    all_ids = []
    try:
        # Use list operation to get all IDs - it returns a generator of ID batches
        logger.info("Collecting vector IDs...")
        for batch_ids in index.list(namespace=namespace):
            # Each iteration gives us a batch of IDs
            for vector_id in batch_ids:
                all_ids.append(vector_id)
                if MAX_VECTORS_TO_PROCESS and len(all_ids) >= MAX_VECTORS_TO_PROCESS:
                    break

            if len(all_ids) % 1000 == 0:
                logger.info(f"Collected {len(all_ids)} IDs so far...")

            if MAX_VECTORS_TO_PROCESS and len(all_ids) >= MAX_VECTORS_TO_PROCESS:
                break

        logger.info(
            f"Found {len(all_ids)} total vectors (limited to {MAX_VECTORS_TO_PROCESS})"
            if MAX_VECTORS_TO_PROCESS
            else f"Found {len(all_ids)} total vectors"
        )

        # Fetch vectors and metadata in batches
        for i in range(0, len(all_ids), BATCH_SIZE):
            batch_ids = all_ids[i : i + BATCH_SIZE]
            fetch_response = index.fetch(ids=batch_ids, namespace=namespace)

            for id in batch_ids:
                if id in fetch_response["vectors"]:
                    vector_data = fetch_response["vectors"][id]
                    vectors.append(
                        {
                            "id": id,
                            "values": vector_data["values"],
                            "text": vector_data["metadata"].get("text", ""),
                            "document_hash": extract_document_hash(id),
                        }
                    )

            logger.info(f"Fetched {len(vectors)} vectors so far...")

    except Exception as e:
        logger.error(f"Error fetching vectors: {e}")
        sys.exit(1)
    return vectors


def extract_document_hash(vector_id):
    """Extract document hash from vector ID (e.g., text||Crystal Clarity||Art_Science_of_Raja_Yoga||345345345||chunk1)."""
    try:
        parts = vector_id.split("||")
        if len(parts) >= 4:
            return parts[3]  # Document hash is 4th component
        return "unknown"
    except Exception:
        return "unknown"


def find_exact_duplicates(vectors):
    """Identify exact duplicate text chunks."""
    duplicates = []
    text_seen = defaultdict(list)

    # Group vectors by their text content
    for i, vec in enumerate(vectors):
        text = vec["text"]
        text_seen[text].append(i)

    # Check for exact duplicates
    for _, indices in text_seen.items():
        if len(indices) > 1:
            # Add all pairs of duplicates for this text
            for i in indices[1:]:
                duplicates.append(
                    {
                        "id1": vectors[indices[0]]["id"],
                        "id2": vectors[i]["id"],
                        "text1": vectors[indices[0]]["text"][:100] + "..."
                        if len(vectors[indices[0]]["text"]) > 100
                        else vectors[indices[0]]["text"],
                        "text2": vectors[i]["text"][:100] + "..."
                        if len(vectors[i]["text"]) > 100
                        else vectors[i]["text"],
                        "similarity": 1.0,
                        "hash1": vectors[indices[0]]["document_hash"],
                        "hash2": vectors[i]["document_hash"],
                        "type": "exact_text",
                    }
                )

    return duplicates


def generate_report(duplicates):
    """Generate a CSV report of duplicates."""
    if not duplicates:
        logger.info("No duplicates found.")
        return

    df = pd.DataFrame(duplicates)
    df.to_csv(OUTPUT_REPORT, index=False)
    logger.info(f"Duplicate report saved to {OUTPUT_REPORT}")

    # Summarize results
    exact_count = len(duplicates)
    same_hash_count = len([d for d in duplicates if d["hash1"] == d["hash2"]])
    different_hash_count = exact_count - same_hash_count

    logger.info(f"Summary: Found {exact_count} exact text duplicates")
    logger.info(f"  - {same_hash_count} duplicates from same document hash")
    logger.info(f"  - {different_hash_count} duplicates from different document hashes")

    # Show some examples
    if duplicates:
        logger.info("First few examples:")
        for i, dup in enumerate(duplicates[:3]):
            logger.info(f"  {i + 1}. {dup['id1']} <-> {dup['id2']}")
            logger.info(f"     Text: {dup['text1']}")
            logger.info(f"     Hashes: {dup['hash1']} vs {dup['hash2']}")


def main():
    """Main function to audit Pinecone index for duplicates."""
    logger.info("Starting Pinecone index audit...")
    # Load environment
    try:
        load_env("ananda")
        logger.info("Loaded environment for site: ananda")
    except Exception as e:
        logger.error(f"Error loading environment: {e}")
        sys.exit(1)
    # Initialize Pinecone
    index = initialize_pinecone()
    # Fetch vectors
    vectors = fetch_vectors(index)
    if not vectors:
        logger.error("No vectors retrieved from index.")
        sys.exit(1)
    # Find duplicates
    duplicates = find_exact_duplicates(vectors)
    # Generate report
    generate_report(duplicates)


if __name__ == "__main__":
    main()
