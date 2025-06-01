#!/usr/bin/env python

"""
Vector Database Statistics Generator

This script analyzes a Pinecone vector database to generate statistics about stored vectors,
specifically counting occurrences of metadata fields (author, library, type). It uses
the query API with dummy vectors for much faster metadata retrieval.

Usage:
    python bin/vector_db_stats.py --site <site_id> [--prefix <id_prefix>] [--use-non-ingest|-n]

Example:
    python bin/vector_db_stats.py --site ananda
    python bin/vector_db_stats.py --site ananda --prefix "text||Crystal Clarity||"
    python bin/vector_db_stats.py --site ananda --use-non-ingest
"""

import argparse
import os
import time
from collections import Counter

from pinecone import Pinecone
from tqdm import tqdm

from pyutil.env_utils import load_env


def get_pinecone_stats(index_name, id_prefix=None):
    """
    Retrieves and aggregates statistics from Pinecone vectors using query API.
    Much faster than fetching full vector data since we only need metadata.

    Args:
        index_name (str): Name of the Pinecone index to query
        id_prefix (str, optional): Filter vectors by ID prefix
    """
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index = pc.Index(index_name)

    stats = {"author": Counter(), "library": Counter(), "type": Counter()}

    # Track unique documents per library
    library_documents = {}  # library_name -> set of document identifiers

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

                    # Track unique documents for libraries
                    library = metadata.get("library")
                    if library:
                        if library not in library_documents:
                            library_documents[library] = set()

                        # Extract unique document identifier
                        doc_id = extract_document_identifier(match.id, metadata)
                        if doc_id:
                            library_documents[library].add(doc_id)

            total_processed += len(query_result.matches)
            pbar.update(len(query_result.matches))

            # If we got fewer results than requested, we've reached the end
            if len(query_result.matches) < batch_size:
                break

        except (ConnectionError, TimeoutError, ValueError) as e:
            print(f"\nError in batch starting at {total_processed}: {e}")
            break

    pbar.close()
    print(f"\nProcessed metadata for {total_processed:,} vectors.")

    # Convert library documents to counts
    library_doc_counts = {lib: len(docs) for lib, docs in library_documents.items()}

    return stats, library_doc_counts


def extract_document_identifier(vector_id, metadata):
    """
    Extract a unique document identifier from vector ID or metadata.

    Vector ID format appears to be: {type}||{library}||{source}||{title}||{author}||{doc_hash}||{chunk_index}

    Args:
        vector_id: The vector ID string
        metadata: Vector metadata dict

    Returns:
        str: Unique document identifier
    """
    try:
        # Try to extract from vector ID first (most reliable)
        if "||" in vector_id:
            parts = vector_id.split("||")
            if len(parts) >= 6:
                # Use everything except the last part (chunk index)
                # Format: {type}||{library}||{source}||{title}||{author}||{doc_hash}
                doc_id = "||".join(parts[:-1])
                return doc_id

        # Fallback: try to construct from metadata
        if metadata:
            # Try to use file_hash if available (document-level hash)
            if "file_hash" in metadata:
                library = metadata.get("library", "unknown")
                return f"{library}||{metadata['file_hash']}"

            # Another fallback: use source + title combination
            source = metadata.get("source", "")
            title = metadata.get("title", "")
            if source or title:
                library = metadata.get("library", "unknown")
                return f"{library}||{source}||{title}"

        # Last resort: return the vector ID without chunk index if we can parse it
        if "_chunk_" in vector_id:
            return vector_id.split("_chunk_")[0]

        return None

    except (AttributeError, IndexError, KeyError):
        # Silently ignore parsing errors for document identification
        return None


def print_stats(stats, library_doc_counts):
    """
    Prints formatted statistics for each metadata category.

    Args:
        stats: Dictionary containing Counters for each metadata field
        library_doc_counts: Dictionary of library -> unique document count
    """
    for category, counter in stats.items():
        print(f"\n{category.upper()} STATS:")

        if category == "library":
            # Special handling for libraries - show both chunks and documents
            print(f"{'Library':<20} {'Chunks':<10} {'Documents':<10}")
            print("-" * 42)
            for library, chunk_count in counter.most_common():
                doc_count = library_doc_counts.get(library, 0)
                print(f"{library:<20} {chunk_count:<10,} {doc_count:<10,}")
        else:
            # For author and type, just show chunk counts
            for item, count in counter.most_common():
                print(f"  {item}: {count:,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Get Pinecone vector statistics")
    parser.add_argument(
        "--site", required=True, help="Site ID for environment variables"
    )
    parser.add_argument("--prefix", help="Filter vectors by ID prefix")
    parser.add_argument(
        "--use-non-ingest",
        "-n",
        action="store_true",
        help="Use non-ingest Pinecone environment variables",
    )
    args = parser.parse_args()

    # Load environment variables for the specified site
    load_env(args.site)

    # Override index name if using non-ingest
    if args.use_non_ingest:
        index_name = os.getenv("PINECONE_INDEX_NAME")
        if not index_name:
            raise ValueError("PINECONE_INDEX_NAME environment variable not set.")
    else:
        index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")
        if not index_name:
            raise ValueError("PINECONE_INGEST_INDEX_NAME environment variable not set.")

    start_time = time.time()
    stats, library_doc_counts = get_pinecone_stats(index_name, args.prefix)
    end_time = time.time()

    print(f"\nCompleted in {end_time - start_time:.1f} seconds")
    print_stats(stats, library_doc_counts)
