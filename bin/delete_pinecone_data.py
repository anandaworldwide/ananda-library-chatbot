#!/usr/bin/env python3

"""
Delete Pinecone Data Script

This script deletes Pinecone records based on either:
1. Media type (audio, text, youtube_video) with optional library and title filters
2. Source name with optional subsource filter
3. Custom prefix

Usage:
1. Delete by media type:
   python delete_pinecone_data.py --site <site> --file-type <audio|text|youtube_video> [--library <library>] [--title <title>]

2. Delete by source:
   python delete_pinecone_data.py --site <site> --source <source_name> [--subsource <subsource>]

3. Delete by custom prefix:
   python delete_pinecone_data.py --site <site> --prefix "text||Ananda.org||Some Title"
Examples:
- Delete all audio records:
  python delete_pinecone_data.py --site ananda --file-type audio

- Delete all records from a specific source:
  python delete_pinecone_data.py --site ananda --source "Ananda.org"

- Delete specific subsource records:
  python delete_pinecone_data.py --site ananda --source "Ananda.org" --subsource "Bhaktivedanta Archives"

Known bugs:
- Pinecone IDs containing spaces will never match for unknown reasons
"""

import os
import argparse
import sys
from pathlib import Path
from pinecone import Pinecone
from typing import Optional
from tqdm import tqdm

# Add project root to sys.path
project_root = Path(__file__).resolve().parents[2]
sys.path.append(str(project_root))

from pyutil.env_utils import load_env

def construct_media_prefix(file_type: str, library: Optional[str] = None, title: Optional[str] = None) -> str:
    prefix = f"{file_type}||"
    if library:
        prefix += f"{library}||"
        if title:
            prefix += f"{title}||"
    return prefix

def construct_source_prefix(source: str, type: str = "text", subsource: Optional[str] = None) -> str:
    # Format: type||source||title
    prefix = f"{type}||{source}"
    if subsource:
        prefix += f"||{subsource}"
    return prefix + "||"

def delete_records_by_prefix(index, prefix: str) -> None:
    # List all record IDs with the given prefix
    record_ids = []
    for ids in index.list(prefix=prefix):
        record_ids.extend(ids)

    if not record_ids:
        print(f"No records found with prefix '{prefix}'")
        return

    # Confirm before deleting records by prefix
    confirmation = input(
        f"\nAre you sure you want to delete {len(record_ids)} records with prefix:\n'{prefix}'\n(yes/No): "
    ).lower()
    if confirmation in ["yes", "y"]:
        # Delete records in batches of 100 to avoid timeout
        batch_size = 100
        num_batches = (len(record_ids) + batch_size - 1) // batch_size
        print(f"Deleting {len(record_ids)} records in {num_batches} batches...")
        for i in tqdm(range(0, len(record_ids), batch_size), total=num_batches, desc="Deleting batches"):
            batch = record_ids[i:i + batch_size]
            index.delete(ids=batch)
        print(f"Successfully deleted {len(record_ids)} records with prefix '{prefix}'")
    else:
        print("Deletion aborted.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Delete Pinecone records by media type or source."
    )
    parser.add_argument(
        "--site",
        type=str,
        required=True,
        help="Site ID for environment variables"
    )

    # Create mutually exclusive group for file-type and source
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--file-type",
        type=str,
        choices=["audio", "text", "youtube_video"],
        help="Type of the media (audio, text, or youtube_video)",
    )
    group.add_argument(
        "--source",
        type=str,
        help="Source name to delete records from (will search in text media type)"
    )
    group.add_argument(
        "--prefix",
        type=str,
        help="Custom ID prefix to delete records (e.g., 'text||ananda.org||Some Title')"
    )

    # Optional arguments
    parser.add_argument(
        "--library",
        type=str,
        help="Name of the library (only valid with --file-type)"
    )
    parser.add_argument(
        "--title",
        type=str,
        help="Title of the media (requires --library, only valid with --file-type)"
    )
    parser.add_argument(
        "--subsource",
        type=str,
        help="Subsource name (only valid with --source)"
    )
    parser.add_argument(
        "--type",
        type=str,
        default="text",
        choices=["audio", "text", "youtube_video"],
        help="Type of media to delete when using --source (default: text)"
    )

    args = parser.parse_args()

    # Validate argument combinations
    if args.file_type:
        if args.subsource:
            parser.error("--subsource can only be used with --source")
        if args.title and not args.library:
            parser.error("--title requires --library to be specified")
    elif args.source:  # args.source
        if args.library or args.title:
            parser.error("--library and --title can only be used with --file-type")
    else:  # args.prefix
        # Check which arguments were explicitly provided
        provided_args = {action.dest for action in parser._actions if action.dest != 'help' 
                        and vars(args)[action.dest] is not None 
                        and action.default != vars(args)[action.dest]}
        invalid_with_prefix = {'library', 'title', 'subsource', 'type', 'source', 'file_type'}
        used_invalid_args = provided_args.intersection(invalid_with_prefix)
        if used_invalid_args:
            parser.error(f"When using --prefix, you cannot specify: {', '.join('--' + arg for arg in used_invalid_args)}")

    load_env(args.site)

    PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
    PINECONE_INDEX_NAME = os.getenv("PINECONE_INGEST_INDEX_NAME")

    if not PINECONE_API_KEY or not PINECONE_INDEX_NAME:
        raise ValueError("PINECONE_API_KEY and PINECONE_INGEST_INDEX_NAME must be set in the environment or .env file.")

    print(f"PINECONE_INDEX_NAME: {PINECONE_INDEX_NAME}")
    pc = Pinecone(api_key=PINECONE_API_KEY)

    if PINECONE_INDEX_NAME not in pc.list_indexes().names():
        raise ValueError(f"Index '{PINECONE_INDEX_NAME}' does not exist.")

    index = pc.Index(PINECONE_INDEX_NAME)

    # Construct prefix based on deletion type
    if args.file_type:
        print(f"Deleting by file type: {args.file_type}")
        if args.library:
            print(f"Library: {args.library}")
        if args.title:
            print(f"Title: {args.title}")
        prefix = construct_media_prefix(args.file_type, args.library, args.title)
    elif args.source:
        print(f"Deleting by source: {args.source}")
        if args.subsource:
            print(f"Subsource: {args.subsource}")
        print(f"Type: {args.type}")
        prefix = construct_source_prefix(args.source, args.type, args.subsource)
    else:
        print(f"Deleting by custom prefix")
        prefix = args.prefix

    print(f"Constructed prefix: {prefix}")
    delete_records_by_prefix(index, prefix) 