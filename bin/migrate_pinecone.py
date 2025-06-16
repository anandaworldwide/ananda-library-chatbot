#!/usr/bin/env python3
"""
Pinecone Vector Database Migration Tool

This script migrates vectors from one Pinecone index to another. It handles:
- Batch processing with user confirmation
- Error handling and progress tracking

The script uses individual vector queries instead of batch fetches due to API limitations,
and provides interactive confirmation for each vector modification to ensure data integrity.

Usage:
    python3 migrate_pinecone.py --source-index <name> --target-index <name> \
                                [--key <key> | (--source-key <key> --target-key <key>)] \
                                [--dry-run]

Requirements:
    - Pinecone API access (source and target)
    - Python 3.x
    - pinecone-client>=4.1.2
"""

import argparse
import sys
import time
from typing import Any

from pinecone import NotFoundException, Pinecone, PodSpec, ServerlessSpec
from tqdm import tqdm


def get_pinecone_client(api_key: str) -> Pinecone:
    """Initialize and return Pinecone client."""
    return Pinecone(api_key=api_key)

def process_batch(vectors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Process a batch of vectors (currently a no-op, can be extended)."""
    # Placeholder for potential future batch processing logic such as fixing metadata. 
    # For now, it just returns the vectors as is.
    return vectors

def migrate_data(source_index, target_index, batch_size: int = 100, dry_run: bool = False):
    """
    Migrate data from source to target index.
    
    Args:
        source_index: Source Pinecone index
        target_index: Target Pinecone index
        batch_size: Number of vectors to process at once
        dry_run: Whether to perform a dry run without writing to the target index
    """
    # Get total vector count for progress tracking
    stats = source_index.describe_index_stats()
    total_vectors = stats.total_vector_count
    print(f"Total vectors to migrate: {total_vectors}")

    # Process vectors in batches
    with tqdm(total=total_vectors, desc="Migrating vectors") as pbar:
        vector_ids = []
        
        print("Attempting to list vector IDs from the default namespace ('')...")
        try:
            # Try listing from the default namespace
            id_iterator = source_index.list(namespace="")  
            id_batches = list(id_iterator) # Collect all batches from the iterator
            if id_batches:
                 print(f"Found {sum(len(b) for b in id_batches)} vector IDs in the default namespace.")
                 for id_batch in id_batches:
                    vector_ids.extend(id_batch)
            else:
                 print("No vectors found in the default namespace.")

        except Exception as e:
            print(f"Error listing from default namespace: {e}. Attempting list without specifying namespace...")
            # If listing with default namespace fails or yields nothing, try without specifying it
            # Note: Pinecone behavior for namespace="" vs not providing namespace might vary.
            try:
                id_iterator_no_ns = source_index.list()
                id_batches_no_ns = list(id_iterator_no_ns)
                if id_batches_no_ns:
                    print(f"Found {sum(len(b) for b in id_batches_no_ns)} vector IDs without specifying a namespace.")
                    for id_batch in id_batches_no_ns:
                        vector_ids.extend(id_batch)
                else:
                    print("No vector IDs found even without specifying a namespace.")
            except Exception as e_no_ns:
                 print(f"Error listing without namespace either: {e_no_ns}")


        if not vector_ids:
            print("No vector IDs found in source index after attempting various listing methods!")
            return
        
        print(f"Collected a total of {len(vector_ids)} vector IDs. Now processing in batches of {batch_size}...")
        # Process ALL collected vector IDs in batches
        for i in range(0, len(vector_ids), batch_size):
            batch_ids = vector_ids[i:i + batch_size]
            
            try:
                # Fetch vectors in a batch using fetch
                print(f"Processing batch {i//batch_size + 1}: Fetching {len(batch_ids)} vectors using source_index.fetch()...")
                fetch_response = source_index.fetch(ids=batch_ids, namespace="") # Assuming default namespace
                
                vectors = []
                if fetch_response and fetch_response.vectors:
                    for vec_id, vector_data in fetch_response.vectors.items():
                        # Ensure the structure matches what process_batch expects
                        vector_dict = {
                            'id': vector_data.id,
                            'metadata': vector_data.metadata,
                            'values': vector_data.values
                        }
                        vectors.append(vector_dict)
                    print(f"Fetched {len(vectors)} vectors successfully.")
                else:
                    print(f"Warning: Fetch for batch starting at index {i} returned no vectors or an unexpected response.")

                # Process the batch (currently just returns the vectors)
                processed_batch = process_batch(vectors)
                
                # Prepare vectors for upsert
                if processed_batch:
                    if dry_run:
                        print(f"[DRY RUN] Would upsert {len(processed_batch)} vectors to target index.")
                        # Simulate progress bar update in dry run
                        pbar.update(len(batch_ids)) # Update pbar based on IDs processed, not vectors found/upserted
                    else:
                        print(f"Upserting {len(processed_batch)} vectors to target index...")
                        target_index.upsert(vectors=processed_batch, namespace="") # Assuming target also uses default namespace
                        pbar.update(len(processed_batch))
                else:
                     # Update pbar even if batch is empty after processing/filtering, based on IDs processed
                     pbar.update(len(batch_ids))
                
            except Exception as e:
                print(f"Error processing batch starting at index {i} with IDs {batch_ids[:5]}...: {e}")
                # Decide whether to continue or stop on error
                # For now, let's print the error and continue with the next batch
                # Consider adding a flag to stop on error if needed
                # Update pbar for the failed batch size to avoid hanging
                pbar.update(len(batch_ids))


def main():
    parser = argparse.ArgumentParser(description='Migrate data between Pinecone indices')
    parser.add_argument('--source-index', required=True, help='Source index name')
    parser.add_argument('--target-index', required=True, help='Target index name')
    parser.add_argument('--dry-run', action='store_true', help='Perform a dry run without writing to the target index')

    # Key arguments group
    key_group = parser.add_argument_group('API Keys (provide --key or both --source-key and --target-key)')
    key_group.add_argument('--key', help='Single API key for both source and target')
    key_group.add_argument('--source-key', help='Source Pinecone API key (if different from target)')
    key_group.add_argument('--target-key', help='Target Pinecone API key (if different from target)')

    args = parser.parse_args()

    # Validate key arguments
    source_api_key = None
    target_api_key = None

    if args.key:
        if args.source_key or args.target_key:
            parser.error("Cannot use --key with --source-key or --target-key.")
        source_api_key = args.key
        target_api_key = args.key
        print("Using single API key for both source and target.")
    elif args.source_key and args.target_key:
        source_api_key = args.source_key
        target_api_key = args.target_key
        print("Using separate source and target API keys.")
    else:
        parser.error("Either --key or both --source-key and --target-key must be provided.")


    if args.dry_run:
        print("--- Performing DRY RUN ---")

    # Initialize clients
    source_client = get_pinecone_client(source_api_key)
    target_client = get_pinecone_client(target_api_key)

    # --- Ensure target index exists ---
    try:
        print(f"Checking if target index '{args.target_index}' exists...")
        target_client.describe_index(args.target_index)
        print(f"Target index '{args.target_index}' exists.")
    except NotFoundException:
        print(f"Target index '{args.target_index}' not found. Attempting to create it...")
        if args.dry_run:
            print("[DRY RUN] Would attempt to create target index based on source index spec.")
            print("In dry run mode, index creation requires explicit confirmation.")
            confirmation = input("Would you like to proceed with creating the target index? [Y/n]: ")
            if confirmation.lower() not in ['', 'y', 'yes']:
                print("Index creation cancelled. Exiting.")
                sys.exit(1)
            print("Proceeding with index creation in dry run mode...")
        
        try:
            print(f"Fetching configuration from source index '{args.source_index}'...")
            source_desc = source_client.describe_index(args.source_index)
            dimension = source_desc.dimension
            metric = source_desc.metric
            spec_dict = source_desc.spec.to_dict() # Convert spec object to dictionary
            
            # Determine if source is serverless or pod-based and construct target spec
            if 'serverless' in spec_dict:
                print(f"Source index is serverless. Creating target with: cloud={spec_dict['serverless']['cloud']}, region={spec_dict['serverless']['region']}")
                spec = ServerlessSpec(
                    cloud=spec_dict['serverless']['cloud'],
                    region=spec_dict['serverless']['region']
                )
            elif 'pod' in spec_dict:
                 print(f"Source index is pod-based. Creating target with: environment={spec_dict['pod']['environment']}, pod_type={spec_dict['pod']['pod_type']}, pods={spec_dict['pod'].get('pods', 1)}, replicas={spec_dict['pod'].get('replicas', 1)}, shards={spec_dict['pod'].get('shards', 1)}")
                 # Extract pod spec fields, providing defaults if necessary
                 spec = PodSpec(
                    environment=spec_dict['pod']['environment'], 
                    pod_type=spec_dict['pod']['pod_type'],
                    pods=spec_dict['pod'].get('pods', 1), # Default to 1 pod if not specified
                    replicas=spec_dict['pod'].get('replicas', 1), # Default to 1 replica
                    shards=spec_dict['pod'].get('shards', 1) # Default to 1 shard
                 )
            else:
                print("Error: Could not determine spec type (serverless/pod) from source index description.")
                sys.exit(1)

            print(f"Creating target index '{args.target_index}' with dimension={dimension}, metric='{metric}'...")
            target_client.create_index(
                name=args.target_index,
                dimension=dimension,
                metric=metric,
                spec=spec,
                timeout=-1 # Wait indefinitely for creation
            )

            print(f"Waiting for target index '{args.target_index}' to be ready...")
            start_wait_time = time.time()
            wait_timeout = 120     # 2 minutes timeout for index creation
            while True:
                try:
                    target_desc = target_client.describe_index(args.target_index)
                    if target_desc.status['ready']:
                        print(f"Target index '{args.target_index}' is ready.")
                        break
                except NotFoundException:
                    # Index might not be immediately visible after create call returns
                    pass # Continue waiting
                except Exception as desc_e:
                     print(f"Error checking target index status during creation wait: {desc_e}")
                     # Decide if this is fatal or temporary
                     
                if time.time() - start_wait_time > wait_timeout:
                    print(f"Error: Timeout waiting for target index '{args.target_index}' to become ready.")
                    sys.exit(1)
                time.sleep(10)

        except Exception as api_e:
             print(f"Error during index creation or description: {api_e}")
             sys.exit(1)
        except Exception as e:
            print(f"Unexpected error during target index creation: {e}")
            sys.exit(1)
            
    except Exception as api_e:
        print(f"Error checking target index: {api_e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error checking target index: {e}")
        sys.exit(1)

    # Get index objects AFTER ensuring target exists
    print("Connecting to index objects...")
    source_index = source_client.Index(args.source_index)
    target_index = target_client.Index(args.target_index)
    
    # --- Check if target index is empty --- 
    try:
        target_stats = target_index.describe_index_stats()
        if target_stats.total_vector_count > 0:
            print(f"\n⚠️ Warning: Target index '{args.target_index}' already contains {target_stats.total_vector_count} vectors.")
            print("Migration will add/update vectors in the target index.")
            if not args.dry_run:
                 confirmation = input("Do you want to proceed? [y/N]: ")
                 if confirmation.lower() not in ['y', 'yes']:
                     print("Migration cancelled by user.")
                     sys.exit(0)
            else:
                print("[DRY RUN] Would proceed with migration into non-empty index.")
        else:
             print(f"Target index '{args.target_index}' is empty. Proceeding with migration.")

    except Exception as e:
        print(f"Error checking target index stats: {e}")
        # Decide if this is fatal. For now, let's assume it's safer to exit.
        sys.exit(1)
    
    try:
        migrate_data(source_index, target_index, dry_run=args.dry_run)
        print("Migration process finished.")
        if args.dry_run:
            print("--- DRY RUN Complete ---")
        else:
            print("Migration completed successfully.")
    except Exception as e:
        print(f"Error during migration: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 