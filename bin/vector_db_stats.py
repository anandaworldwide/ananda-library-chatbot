#!/usr/bin/env python

"""
Vector Database Statistics Generator

This script analyzes a Pinecone vector database to generate statistics about stored vectors,
specifically counting occurrences of metadata fields (author, library, type). It uses
systematic enumeration via index.list() with batching and fetch() to avoid vector space clustering bias.

Optimized for speed with batched ID collection (100 IDs per API call) and
efficient metadata fetching (100 vectors per API call).

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


def collect_vector_ids(index, id_prefix, vectors_to_process):
    """
    Collect vector IDs using systematic enumeration.
    """
    all_ids = []
    ids_collected = 0
    batch_size = 100
    api_calls_made = 0

    id_pbar = tqdm(total=vectors_to_process, desc="Collecting IDs")

    try:
        # Use Pinecone's automatic pagination - the generator handles pagination tokens internally
        if id_prefix:
            list_result = index.list(prefix=id_prefix, limit=batch_size)
        else:
            list_result = index.list(limit=batch_size)

        # Iterate over the generator - each iteration gives us a batch of IDs
        for batch_ids in list_result:
            api_calls_made += 1
            page_ids_count = len(batch_ids)

            # TODO: Why do we add these one by one? Can't we just add the whole batch?
            for vector_id in batch_ids:
                all_ids.append(vector_id)
                ids_collected += 1

                if ids_collected >= vectors_to_process:
                    break

            id_pbar.update(page_ids_count)

            if ids_collected >= vectors_to_process:
                break

        id_pbar.close()

    except Exception as e:
        id_pbar.close()
        print(f"Error during ID collection: {e}", flush=True)
        raise

    return all_ids, api_calls_made


def process_vector_metadata(vector_id, vector_data, stats, library_documents):
    metadata = vector_data.metadata or {}

    if metadata:
        for field in ["author", "library", "type"]:
            if field in metadata:
                stats[field][metadata[field]] += 1

        library = metadata.get("library")
        if library:
            if library not in library_documents:
                library_documents[library] = set()

            doc_id = extract_document_identifier(vector_id, metadata)
            if doc_id:
                library_documents[library].add(doc_id)


def fetch_and_process_metadata(index, all_ids, stats, library_documents):
    """
    Fetch metadata in batches and process statistics.
    """
    fetch_batch_size = (
        20  # Reduced from 100 to avoid Request-URI Too Large errors with long IDs
    )
    total_processed = 0
    fetch_api_calls = 0

    fetch_pbar = tqdm(total=len(all_ids), desc="Fetching metadata")

    for i in range(0, len(all_ids), fetch_batch_size):
        batch_ids = all_ids[i : i + fetch_batch_size]
        batch_ids = [str(id_val) for id_val in batch_ids]

        try:
            fetch_result = index.fetch(ids=batch_ids)
            fetch_api_calls += 1

            for vector_id, vector_data in fetch_result.vectors.items():
                process_vector_metadata(
                    vector_id, vector_data, stats, library_documents
                )

            total_processed += len(batch_ids)
            fetch_pbar.update(len(batch_ids))

        except Exception as e:
            print(f"\nError fetching batch at position {i}: {e}")
            continue

    fetch_pbar.close()
    return total_processed, fetch_api_calls


def get_pinecone_stats(index_name, id_prefix=None, max_vectors=None):
    """
    Retrieves and aggregates statistics from Pinecone vectors using systematic enumeration.
    Uses index.list() + fetch() to avoid vector space clustering bias from query() approach.

    Args:
        index_name (str): Name of the Pinecone index to query
        id_prefix (str, optional): Filter vectors by ID prefix
        max_vectors (int, optional): Maximum number of vectors to process
    """
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index = pc.Index(index_name)

    stats = {"author": Counter(), "library": Counter(), "type": Counter()}

    library_documents = {}

    index_stats = index.describe_index_stats()
    total_vectors = index_stats.total_vector_count

    print(f"Index has {total_vectors:,} total vectors")

    vectors_to_process = min(max_vectors or total_vectors, total_vectors)
    print(f"Processing {vectors_to_process:,} vectors using systematic enumeration...")

    print("Phase 1: Collecting vector IDs...")
    id_collection_start = time.time()
    all_ids, api_calls_made = collect_vector_ids(index, id_prefix, vectors_to_process)
    id_collection_end = time.time()
    id_collection_time = id_collection_end - id_collection_start

    if not all_ids:
        print("No vectors found matching criteria")
        return stats, {}

    print(
        f"Collected {len(all_ids):,} vector IDs in {id_collection_time:.1f}s using {api_calls_made} API calls"
    )
    print(
        f"Average: {len(all_ids) / api_calls_made:.0f} IDs per API call, {len(all_ids) / id_collection_time:.0f} IDs per second"
    )

    print("Phase 2: Fetching metadata...")
    metadata_fetch_start = time.time()
    total_processed, fetch_api_calls = fetch_and_process_metadata(
        index, all_ids, stats, library_documents
    )
    metadata_fetch_end = time.time()
    metadata_fetch_time = metadata_fetch_end - metadata_fetch_start
    print(
        f"Successfully processed metadata for {total_processed:,} vectors in {metadata_fetch_time:.1f}s using {fetch_api_calls} API calls"
    )

    if fetch_api_calls > 0 and metadata_fetch_time > 0:
        print(
            f"Average: {total_processed / fetch_api_calls:.0f} vectors per API call, {total_processed / metadata_fetch_time:.0f} vectors per second"
        )
    else:
        print("No successful metadata fetches - check for API errors above")

    library_doc_counts = {lib: len(docs) for lib, docs in library_documents.items()}

    return stats, library_doc_counts


def extract_document_identifier(vector_id, metadata):
    """
    Extract a unique document identifier from vector ID or metadata.

    Current vector ID format: {content_type}||{library}||{source_location}||{sanitized_title}||{sanitized_author}||{document_hash}||{chunk_index}

    Since document_hash is chunk-specific (includes chunk_text), we need to exclude both
    document_hash and chunk_index to get a proper document identifier.

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
            if len(parts) >= 7:
                # Use first 5 parts: {content_type}||{library}||{source_location}||{sanitized_title}||{sanitized_author}
                # Exclude both document_hash and chunk_index since document_hash is chunk-specific
                doc_id = "||".join(parts[:5])
                return doc_id
            elif len(parts) >= 6:
                # Fallback for older 6-part format: {type}||{library}||{source}||{title}||{author}||{chunk_index}
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
    parser.add_argument(
        "--max-vectors",
        type=int,
        help="Maximum number of vectors to process (default: all)",
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

    print(f"Using Pinecone database: {index_name}")

    start_time = time.time()
    stats, library_doc_counts = get_pinecone_stats(
        index_name, args.prefix, args.max_vectors
    )
    end_time = time.time()

    print(f"\nCompleted in {end_time - start_time:.1f} seconds")
    print_stats(stats, library_doc_counts)
