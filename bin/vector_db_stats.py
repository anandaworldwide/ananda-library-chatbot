#!/usr/bin/env python

"""
Vector Database Statistics Generator

This script analyzes a Pinecone vector database to generate statistics about stored vectors,
specifically counting occurrences of metadata fields (author, library, type). It processes
vectors in batches for efficiency using `index.list()` and `index.fetch()`.

Usage:
    python bin/vector_db_stats.py --site <site_id> [--prefix <id_prefix>]

Example:
    python bin/vector_db_stats.py --site mysite --prefix book_
"""

import os
import sys
import argparse
from collections import Counter
from pinecone import Pinecone
from tqdm import tqdm
from urllib3.exceptions import ProtocolError
import time
import random

# Add parent directory to Python path for importing utility modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from pyutil.env_utils import load_env

def get_pinecone_stats(id_prefix=None):
    """
    Retrieves and aggregates statistics from Pinecone vectors using batch fetching.
    
    Args:
        id_prefix (str, optional): Filter vectors by ID prefix
    """
    pc = Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
    index_name = os.getenv('PINECONE_INGEST_INDEX_NAME')
    if not index_name:
        raise ValueError("PINECONE_INGEST_INDEX_NAME environment variable not set.")
    index = pc.Index(index_name)
    
    stats = {
        'author': Counter(),
        'library': Counter(),
        'type': Counter()
    }
    
    # Get total vector count (might be slightly off if using prefix, but good estimate for progress)
    index_stats = index.describe_index_stats()
    total_vectors = index_stats.total_vector_count
    pbar = tqdm(total=total_vectors, desc=f"Listing vectors with prefix '{id_prefix or ''}'")
    
    # 1. List all vector IDs matching the prefix
    all_vector_ids = []
    try:
        for ids_list in index.list(prefix=id_prefix):
            all_vector_ids.extend(ids_list)
        pbar.set_description("Processing fetched vectors")
        pbar.reset(total=len(all_vector_ids)) # Reset pbar for processing phase
    except Exception as e:
        print(f"\nError listing vector IDs: {e}")
        pbar.close()
        return stats # Return potentially empty stats
    
    # 2. Fetch and process vectors in batches
    batch_size = 50 # Reduced batch size to prevent 414 Request-URI Too Large errors
    total_processed = 0

    for i in range(0, len(all_vector_ids), batch_size):
        batch_ids = all_vector_ids[i:i + batch_size]
        try:
            fetch_response = index.fetch(ids=batch_ids)
            fetched_vectors = fetch_response.vectors

            for vec_id, vector_data in fetched_vectors.items():
                metadata = vector_data.get('metadata', {})
                if metadata:
                    # Update counters for each metadata field if present
                    for field in ['author', 'library', 'type']:
                        if field in metadata:
                            stats[field][metadata[field]] += 1
            total_processed += len(fetched_vectors)
            pbar.update(len(batch_ids)) # Update based on batch size processed/attempted

        except Exception as e:
            print(f"\nError fetching/processing batch starting at index {i}: {e}")
            # Option: could add retry logic here or skip the batch
            pbar.update(len(batch_ids)) # Still update progress bar for attempted batch

    pbar.close()
    print(f"\nProcessed metadata for {total_processed} vectors.")
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
            print(f"{item}: {count}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Get Pinecone vector statistics')
    parser.add_argument('--site', required=True, help='Site ID for environment variables')
    parser.add_argument('--prefix', help='Filter vectors by ID prefix')
    args = parser.parse_args()
    
    # Load environment variables for the specified site
    load_env(args.site)
    stats = get_pinecone_stats(args.prefix)
    print_stats(stats)
