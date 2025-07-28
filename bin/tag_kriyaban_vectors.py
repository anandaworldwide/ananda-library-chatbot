#!/usr/bin/env python
"""
Tag Kriyaban-Only Vectors in Pinecone

This script identifies and tags existing vectors in Pinecone that correspond to
"Kriyaban Only" content from the Treasures library. It adds the access_level="kriyaban"
metadata field to restrict access to these vectors.

The script:
1. Scans the local filesystem for MP3 files under "Kriyaban Only" directories
2. Maps these files to existing Pinecone vectors using the filename metadata
3. Updates the vectors with access_level="kriyaban" metadata
4. Provides dry-run mode and progress tracking

Usage:
    python bin/tag_kriyaban_vectors.py --site ananda --dry-run
    python bin/tag_kriyaban_vectors.py --site ananda --chunk-size 50 --debug
"""

import argparse
import logging
import os
import sys
from pathlib import Path

from tqdm import tqdm

from data_ingestion.audio_video.pinecone_utils import load_pinecone
from pyutil.env_utils import load_env
from pyutil.logging_utils import configure_logging

logger = logging.getLogger(__name__)


def scan_kriyaban_files(base_path: str) -> list[str]:
    """
    Scan the filesystem for MP3 files under Kriyaban Only directories.

    Args:
        base_path: Base path to scan (e.g. '/Volumes/ExtData/Ananda Library Chatbot/treasures-processed-metadata-cleaned')

    Returns:
        List of relative file paths (relative to treasures/) that should be tagged as kriyaban
    """
    kriyaban_files = []
    base_path = Path(base_path)

    if not base_path.exists():
        logger.warning(f"Base path does not exist: {base_path}")
        return kriyaban_files

    # Find all directories containing "Kriyaban Only" (case-insensitive)
    for root, _dirs, files in os.walk(base_path):
        root_path = Path(root)

        # Check if any part of the path contains "Kriyaban Only"
        if any("kriyaban only" in part.lower() for part in root_path.parts):
            # Find all MP3 files in this directory
            for file in files:
                if file.lower().endswith(".mp3"):
                    full_path = root_path / file

                    # Convert to relative path starting from "treasures/"
                    try:
                        # Get the path relative to the base_path
                        relative_to_base = full_path.relative_to(base_path)

                        # The existing metadata format starts with "treasures/"
                        # So we need to construct: treasures/[rest of path after base]
                        relative_path = f"treasures/{relative_to_base}"

                        kriyaban_files.append(relative_path)
                        logger.debug(f"Found Kriyaban file: {relative_path}")

                    except Exception as e:
                        logger.error(f"Error processing path {full_path}: {e}")

    logger.info(f"Found {len(kriyaban_files)} Kriyaban MP3 files")
    return kriyaban_files


def find_matching_vectors(
    pinecone_index, kriyaban_files: list[str]
) -> dict[str, list[str]]:
    """
    Find Pinecone vectors that match the Kriyaban files.

    Args:
        pinecone_index: Pinecone index instance
        kriyaban_files: List of relative file paths to match

    Returns:
        Dictionary mapping filename to list of matching vector IDs
    """
    file_to_vectors = {}

    # Get embedding dimension from environment
    embedding_dimension = int(os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION"))

    for file_path in tqdm(kriyaban_files, desc="Finding matching vectors"):
        try:
            # Query vectors with this filename in the Treasures library
            filter_query = {
                "$and": [
                    {"library": {"$eq": "Treasures"}},
                    {"filename": {"$eq": file_path}},
                ]
            }

            # Create dummy vector with correct dimension for metadata-only query
            dummy_vector = [0.0] * embedding_dimension

            # Query with a high limit to get all chunks for this file
            query_response = pinecone_index.query(
                vector=dummy_vector,
                filter=filter_query,
                top_k=1000,  # High limit to get all chunks
                include_metadata=True,
            )

            matching_ids = [match.id for match in query_response.matches]

            if matching_ids:
                file_to_vectors[file_path] = matching_ids
                logger.debug(f"Found {len(matching_ids)} vectors for {file_path}")
            else:
                logger.warning(f"No vectors found for {file_path}")

        except Exception as e:
            logger.error(f"Error querying vectors for {file_path}: {e}")
            logger.exception("Full traceback:")

    total_vectors = sum(len(ids) for ids in file_to_vectors.values())
    logger.info(
        f"Found {total_vectors} total vectors across {len(file_to_vectors)} files"
    )

    return file_to_vectors


def tag_vectors_with_access_level(
    pinecone_index,
    file_to_vectors: dict[str, list[str]],
    chunk_size: int = 100,
    dry_run: bool = False,
) -> dict[str, int]:
    """
    Tag vectors with access_level="kriyaban" metadata.

    Args:
        pinecone_index: Pinecone index instance
        file_to_vectors: Dictionary mapping filenames to vector IDs
        chunk_size: Number of vectors to process in each batch
        dry_run: If True, don't actually update vectors

    Returns:
        Dictionary with processing statistics
    """
    stats = {"processed": 0, "errors": 0, "skipped": 0}

    # Flatten all vector IDs
    all_vector_ids = []
    for vector_ids in file_to_vectors.values():
        all_vector_ids.extend(vector_ids)

    logger.info(
        f"{'DRY RUN: Would tag' if dry_run else 'Tagging'} {len(all_vector_ids)} vectors"
    )

    # Process in chunks
    for i in tqdm(range(0, len(all_vector_ids), chunk_size), desc="Tagging vectors"):
        chunk_ids = all_vector_ids[i : i + chunk_size]

        try:
            if not dry_run:
                # Fetch existing vectors to preserve their data
                fetch_response = pinecone_index.fetch(ids=chunk_ids)

                # Prepare update vectors with added access_level metadata
                update_vectors = []
                for vector_id in chunk_ids:
                    if vector_id in fetch_response.vectors:
                        vector_data = fetch_response.vectors[vector_id]

                        # Add access_level to existing metadata
                        updated_metadata = (
                            dict(vector_data.metadata) if vector_data.metadata else {}
                        )
                        updated_metadata["access_level"] = "kriyaban"

                        update_vectors.append(
                            {
                                "id": vector_id,
                                "values": vector_data.values,
                                "metadata": updated_metadata,
                            }
                        )
                    else:
                        logger.warning(f"Vector {vector_id} not found during fetch")
                        stats["skipped"] += 1

                # Upsert the updated vectors
                if update_vectors:
                    pinecone_index.upsert(vectors=update_vectors)
                    stats["processed"] += len(update_vectors)
                    logger.debug(f"Updated {len(update_vectors)} vectors in batch")
            else:
                # Dry run - just count
                stats["processed"] += len(chunk_ids)

        except Exception as e:
            logger.error(f"Error processing batch starting at index {i}: {e}")
            stats["errors"] += len(chunk_ids)

    return stats


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description="Tag Kriyaban-only vectors in Pinecone with access_level metadata"
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID for environment variables (e.g., 'ananda')",
    )
    parser.add_argument(
        "--base-path",
        default="/Volumes/ExtData/Ananda Library Chatbot/treasures-processed-metadata-cleaned",
        help="Base path to scan for Kriyaban files",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=100,
        help="Number of vectors to process in each batch (default: 100)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform a dry run without actually updating vectors",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    # Load environment and configure logging
    load_env(args.site)
    configure_logging(args.debug)

    logger.info(f"Starting Kriyaban vector tagging for site: {args.site}")
    logger.info(f"Base path: {args.base_path}")
    logger.info(f"Chunk size: {args.chunk_size}")
    logger.info(f"Dry run: {args.dry_run}")

    try:
        # Initialize Pinecone
        pinecone_index = load_pinecone()
        logger.info("Connected to Pinecone successfully")

        # Step 1: Scan filesystem for Kriyaban files
        logger.info("Scanning filesystem for Kriyaban files...")
        kriyaban_files = scan_kriyaban_files(args.base_path)

        if not kriyaban_files:
            logger.warning("No Kriyaban files found. Exiting.")
            return

        # Step 2: Find matching vectors in Pinecone
        logger.info("Finding matching vectors in Pinecone...")
        file_to_vectors = find_matching_vectors(pinecone_index, kriyaban_files)

        if not file_to_vectors:
            logger.warning("No matching vectors found in Pinecone. Exiting.")
            return

        # Step 3: Tag vectors with access_level metadata
        logger.info("Tagging vectors with access_level metadata...")
        stats = tag_vectors_with_access_level(
            pinecone_index, file_to_vectors, args.chunk_size, args.dry_run
        )

        # Print final statistics
        logger.info("\n" + "=" * 50)
        logger.info("FINAL RESULTS")
        logger.info("=" * 50)
        logger.info(f"Files scanned: {len(kriyaban_files)}")
        logger.info(f"Files with matching vectors: {len(file_to_vectors)}")
        logger.info(f"Vectors processed: {stats['processed']}")
        logger.info(f"Vectors skipped: {stats['skipped']}")
        logger.info(f"Errors encountered: {stats['errors']}")

        if args.dry_run:
            logger.info("\nThis was a DRY RUN - no vectors were actually modified.")
            logger.info("Run without --dry-run to apply changes.")
        else:
            logger.info(
                f"\nSuccessfully tagged {stats['processed']} vectors with access_level='kriyaban'"
            )

    except Exception as e:
        logger.error(f"Script failed with error: {e}")
        logger.exception("Full traceback:")
        sys.exit(1)


if __name__ == "__main__":
    main()
