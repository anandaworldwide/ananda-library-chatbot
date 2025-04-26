#!/usr/bin/env python
"""
Finds and prints Pinecone records that match a specific category metadata field.

This script connects to a specified Pinecone index and queries it using a metadata
filter to find records where the 'categories' field contains the specified category.
It prints the title, permalink (source), and full category list for each match.
"""

import os
import sys
import argparse
from pinecone import Pinecone, NotFoundException
# OpenAIEmbeddings no longer needed
import time

# Add the python directory to the path so we can import util
# Assumes the script is run from the workspace root or the bin directory
try:
    # Running from workspace root
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), ".")))
    from pyutil.env_utils import load_env
except ImportError:
    # Running from bin directory
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from pyutil.env_utils import load_env

# --- Argument Parsing ---
def parse_arguments():
    """Parses command-line arguments."""
    parser = argparse.ArgumentParser(description="Find Pinecone records by category using metadata filter.") # Updated description
    parser.add_argument("--site", required=True, help="Site name (e.g., ananda, jairam) for config and env loading.")
    parser.add_argument("--category", required=True, help="The category name to filter records by.")
    parser.add_argument("--top-k", type=int, default=100, help="Max number of results to return from Pinecone query (default: 100). Max is 10000.") # Updated help text
    return parser.parse_args()

# --- Environment Loading ---
def load_environment(site: str):
    """Loads environment variables from the site-specific .env file."""
    try:
        load_env(site)
        print(f"Loaded environment for site: {site} using load_env utility.")
    except ValueError as e:
        print(f"Error loading environment: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error loading environment for site '{site}': {e}")
        sys.exit(1)

    # OPENAI_API_KEY is no longer required here unless other operations need it
    required_vars = ["PINECONE_API_KEY", "PINECONE_INDEX_NAME"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)

# --- Pinecone Utilities ---
def get_pinecone_client() -> Pinecone:
    """Initializes and returns a Pinecone client instance."""
    api_key = os.getenv("PINECONE_API_KEY")
    return Pinecone(api_key=api_key)

def get_pinecone_index(pinecone: Pinecone):
    """Gets the Pinecone index object and its dimension."""
    index_name = os.getenv("PINECONE_INDEX_NAME")
    try:
        index = pinecone.Index(index_name)
        stats = index.describe_index_stats()
        print(f"Successfully connected to index '{index_name}'. Stats: {stats['total_vector_count']} vectors.")
        # Get embedding dimension from stats
        dimension = stats.get('dimension')
        if dimension is None:
            # Fallback: Try describing the index itself if stats don't have dimension
            index_desc = pinecone.describe_index(index_name)
            dimension = index_desc.get('dimension')
            if dimension is None:
                print("Error: Could not determine embedding dimension for the index.")
                sys.exit(1)
        print(f"Index embedding dimension: {dimension}")
        return index, dimension
    except NotFoundException:
        print(f"Error: Pinecone index '{index_name}' not found.")
        sys.exit(1)
    except Exception as e:
        print(f"Error connecting to or describing Pinecone index '{index_name}': {e}")
        sys.exit(1)

# --- Embedding Generation (Removed) ---
# def get_category_embedding(category_name: str) -> list[float]: ...

# --- Main Query Logic ---
def find_and_print_matches(index, category_name: str, dimension: int, top_k: int):
    """Queries Pinecone using metadata filter and prints matches."""
    print(f"Querying Pinecone index with filter for category '{category_name}' (top_k={top_k})...")
    start_time = time.time()
    try:
        # Create a zero vector of the correct dimension as a placeholder
        # We rely on the filter, not vector similarity
        zero_vector = [0.0] * dimension

        # Construct the filter
        category_filter = {"categories": {"$in": [category_name]}}

        query_response = index.query(
            vector=zero_vector, # Use a placeholder vector
            top_k=top_k,
            include_metadata=True,
            filter=category_filter # Apply the metadata filter
        )
        end_time = time.time()
        returned_count = len(query_response.get('matches', []))
        print(f"Pinecone query completed in {end_time - start_time:.2f} seconds. Received {returned_count} results matching the filter.")

        matches = query_response.get('matches', [])
        found_count = 0 # Already filtered by Pinecone, so all matches should fit

        print(f"\n--- Records Matching Category: '{category_name}' ---")
        if not matches:
            print(f"No records found with the category '{category_name}'.")
            return

        for match in matches:
            found_count += 1
            metadata = match.get('metadata', {})
            categories = metadata.get('categories', [])
            title = metadata.get('title', 'N/A')
            permalink = metadata.get('source', 'N/A')

            print(f"\nMatch {found_count}:")
            print(f"  Title: {title}")
            print(f"  Permalink: {permalink}")
            print(f"  Categories: {categories}")
            # print(f"  Score: {match.get('score', 'N/A')}") # Score is less meaningful with zero vector

        print(f"\n--- Found {found_count} matching records ---")

    except Exception as e:
        print(f"Error during Pinecone query or processing: {e}")
        import traceback
        traceback.print_exc()

# --- Main Execution ---
def main():
    """Main function to orchestrate the process."""
    args = parse_arguments()
    print(f"--- Finding Records for Category: '{args.category}' (Site: {args.site}) ---")

    load_environment(args.site)

    pinecone_client = get_pinecone_client()
    # Get index and dimension
    pinecone_index, dimension = get_pinecone_index(pinecone_client)

    # Embedding generation removed
    # category_embedding = get_category_embedding(args.category)

    if args.top_k > 10000:
        print("Warning: top_k exceeds the maximum recommended value (10000). Setting to 10000.")
        args.top_k = 10000
    elif args.top_k <= 0:
        print("Error: top_k must be a positive integer.")
        sys.exit(1)

    # Pass dimension instead of embedding
    find_and_print_matches(pinecone_index, args.category, dimension, args.top_k)

    print("\n--- Script Finished ---")

if __name__ == "__main__":
    main() 