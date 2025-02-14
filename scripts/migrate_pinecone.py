#!/usr/bin/env python3
"""
Pinecone Vector Database Migration Tool

This script migrates vectors from one Pinecone index to another while updating library names
from 'Default Library' to 'Crystal Clarity'. It handles:

- Vector ID updates
- Metadata updates
- Batch processing with user confirmation
- Error handling and progress tracking

The script uses individual vector queries instead of batch fetches due to API limitations,
and provides interactive confirmation for each vector modification to ensure data integrity.

Usage:
    python3 migrate_pinecone.py --source-key <key> --target-key <key> 
                               --source-index <name> --target-index <name>

Requirements:
    - Pinecone API access (source and target)
    - Python 3.x
    - pinecone-client>=4.1.2
"""

import os
import sys
import argparse
from tqdm import tqdm
from pinecone import Pinecone
from typing import List, Dict, Any

def get_pinecone_client(api_key: str) -> Pinecone:
    """Initialize and return Pinecone client."""
    return Pinecone(api_key=api_key)

def process_batch(vectors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Process a batch of vectors to update library names."""
    processed = []
    for vector in vectors:
        if 'Default Library' in vector['id']:
            # Show before state
            print("\nBEFORE:")
            print(f"ID: {vector['id']}")
            print(f"Metadata ID: {vector['metadata'].get('id')}")
            print(f"Library: {vector['metadata'].get('library')}")
            
            # Make all changes
            new_id = vector['id'].replace('Default Library', 'Crystal Clarity')
            vector['id'] = new_id
            if vector['metadata'].get('id'):
                vector['metadata']['id'] = vector['metadata']['id'].replace('Default Library', 'Crystal Clarity')
            if vector['metadata'].get('library') == 'Default Library':
                vector['metadata']['library'] = 'Crystal Clarity'
            
            # Show after state
            print("\nAFTER:")
            print(f"ID: {vector['id']}")
            print(f"Metadata ID: {vector['metadata'].get('id')}")
            print(f"Library: {vector['metadata'].get('library')}")
            
            confirm = input("\nLooks good? [Y/n]: ").lower()
            if confirm in ['', 'y', 'yes']:
                processed.append(vector)
            else:
                print("Exiting due to incorrect vector format")
                sys.exit(1)
        else:
            processed.append(vector)
    return processed

def migrate_data(source_index, target_index, batch_size: int = 100):
    """
    Migrate data from source to target index, updating library names.
    
    Args:
        source_index: Source Pinecone index
        target_index: Target Pinecone index
        batch_size: Number of vectors to process at once
    """
    # Get total vector count for progress tracking
    stats = source_index.describe_index_stats()
    total_vectors = stats.total_vector_count
    print(f"Total vectors to migrate: {total_vectors}")
    print(f"Index stats: {stats}")  # Add this to see all namespaces

    # Process vectors in batches
    with tqdm(total=total_vectors, desc="Migrating vectors") as pbar:
        vector_ids = []
        print("\nGetting vector IDs...")
        
        # First try default namespace
        id_iterator = source_index.list(namespace="")  
        id_batches = []
        try:
            first_batch = next(id_iterator)  # Get first batch
            id_batches = [first_batch]
            # Continue getting batches
            for batch in id_iterator:
                id_batches.append(batch)
        except StopIteration:
            print("No more vectors found")
            
        if not id_batches:
            print("No vectors found in default namespace")
            # If empty, try without namespace
            print("Trying without namespace...")
            id_batches = list(source_index.list())
        
        for id_batch in id_batches:
            print(f"Got batch of IDs: {id_batch[:10]}")
            vector_ids.extend(id_batch[:10])  # Keep the limit for testing
            if len(vector_ids) >= batch_size:
                break

        if not vector_ids:
            print("No vector IDs found in source index!")
            return

        print(f"\nFound {len(vector_ids)} vectors to process")
        print(f"Vector IDs to process: {vector_ids}")
        
        # Try fetching with different namespace configurations
        for i in range(0, len(vector_ids), batch_size):
            batch_ids = vector_ids[i:i + batch_size]
            print(f"\nFetching batch of {len(batch_ids)} vectors...")
            
            try:
                # Try using query instead of fetch
                first_id = batch_ids[0]
                print(f"Trying to query vector: {first_id}")
                query_response = source_index.query(
                    id=first_id,
                    top_k=1,
                    include_values=True,
                    include_metadata=True,
                    namespace=""
                )
                
                if query_response.matches:
                    vectors = []
                    for batch_id in batch_ids:
                        # Query each vector individually since fetch isn't working
                        vector_response = source_index.query(
                            id=batch_id,
                            top_k=1,
                            include_values=True,
                            include_metadata=True,
                            namespace=""
                        )
                        if vector_response.matches:
                            match = vector_response.matches[0]
                            vector_dict = {
                                'id': match.id,
                                'metadata': match.metadata,
                                'values': match.values
                            }
                            vectors.append(vector_dict)
                    
                    print(f"Retrieved {len(vectors)} vectors")
                    
                    # Process the batch
                    processed_batch = process_batch(vectors)
                    print(f"Processed {len(processed_batch)} vectors")
                    
                    # Prepare vectors for upsert
                    if processed_batch:
                        print(f"Upserting {len(processed_batch)} vectors...")
                        target_index.upsert(vectors=processed_batch)
                        pbar.update(len(processed_batch))
                
            except Exception as e:
                print(f"Error processing batch: {e}")
                raise

def main():
    parser = argparse.ArgumentParser(description='Migrate data between Pinecone indices')
    parser.add_argument('--source-key', required=True, help='Source Pinecone API key')
    parser.add_argument('--target-key', required=True, help='Target Pinecone API key')
    parser.add_argument('--source-index', required=True, help='Source index name')
    parser.add_argument('--target-index', required=True, help='Target index name')
    args = parser.parse_args()

    # Initialize clients
    print("\nInitializing source Pinecone client...")
    source_client = get_pinecone_client(args.source_key)
    print("Available indices in source:", source_client.list_indexes().names())
    
    print("\nInitializing target Pinecone client...")
    target_client = get_pinecone_client(args.target_key)
    print("Available indices in target:", target_client.list_indexes().names())

    # Get indices
    print(f"\nConnecting to source index: {args.source_index}")
    source_index = source_client.Index(args.source_index)
    source_stats = source_index.describe_index_stats()
    print(f"Source index stats: {source_stats}")
    
    print(f"\nConnecting to target index: {args.target_index}")
    target_index = target_client.Index(args.target_index)
    target_stats = target_index.describe_index_stats()
    print(f"Target index stats: {target_stats}")

    print(f"\nSource index: {args.source_index}")
    print(f"Target index: {args.target_index}")
    

    try:
        migrate_data(source_index, target_index)
        print("Migration completed successfully")
    except Exception as e:
        print(f"Error during migration: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 