#!/usr/bin/env python3

"""
Pinecone Text Field Word Count Analyzer

This script analyzes the word count distribution in the 'text' field of Pinecone vectors,
providing statistics like average word count and standard deviation. It can filter vectors
by ID prefix to analyze specific collections or libraries.

Usage:
    python data_ingestion/bin/analyze_text_field_words.py --site <site_id> --prefix <id_prefix>

Examples:
    # Analyze all text chunks from Crystal Clarity library
    python data_ingestion/bin/analyze_text_field_words.py --site ananda --prefix "text||Crystal Clarity||"

    # Analyze all text vectors
    python data_ingestion/bin/analyze_text_field_words.py --site ananda --prefix "text||"

    # Analyze specific document
    python data_ingestion/bin/analyze_text_field_words.py --site ananda --prefix "text||Crystal Clarity||Some_Title"
"""

import argparse
import os
import statistics
import sys
from typing import Any

from pinecone import Pinecone
from tqdm import tqdm

# Add project root to Python path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, project_root)

from pyutil.env_utils import load_env


def count_words(text: str) -> int:
    """
    Count words in a text string using simple whitespace splitting.

    Args:
        text: Text string to count words in

    Returns:
        int: Number of words in the text
    """
    if not text or not isinstance(text, str):
        return 0
    return len(text.strip().split())


def analyze_text_field_words(id_prefix: str) -> dict[str, Any]:
    """
    Analyze word counts in the 'text' field of Pinecone vectors matching the given prefix.

    Args:
        id_prefix: ID prefix to filter vectors

    Returns:
        Dict containing analysis results including average, std dev, min, max, etc.
    """
    # Initialize Pinecone
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")

    if not index_name:
        raise ValueError("PINECONE_INGEST_INDEX_NAME environment variable not set.")

    index = pc.Index(index_name)

    print(f"Analyzing text field word counts for vectors with prefix: '{id_prefix}'")
    print(f"Using Pinecone index: {index_name}")

    # Step 1: List all vector IDs matching the prefix
    print("Listing vector IDs...")
    all_vector_ids = []
    try:
        for ids_list in index.list(prefix=id_prefix):
            all_vector_ids.extend(ids_list)
    except Exception as e:
        print(f"Error listing vector IDs: {e}")
        return {}

    if not all_vector_ids:
        print(f"No vectors found with prefix '{id_prefix}'")
        return {}

    print(f"Found {len(all_vector_ids)} vectors to analyze")

    # Step 2: Fetch vectors in batches and analyze text fields
    word_counts = []
    batch_size = 50  # Conservative batch size to avoid URI too large errors
    total_processed = 0
    vectors_with_text = 0

    # Create progress bar
    pbar = tqdm(total=len(all_vector_ids), desc="Processing vectors", unit="vectors")

    for i in range(0, len(all_vector_ids), batch_size):
        batch_ids = all_vector_ids[i : i + batch_size]

        try:
            # Fetch batch of vectors
            fetch_response = index.fetch(ids=batch_ids)
            fetched_vectors = fetch_response.vectors

            for _vec_id, vector_data in fetched_vectors.items():
                metadata = vector_data.get("metadata", {})
                text_content = metadata.get("text", "")

                if text_content:
                    word_count = count_words(text_content)
                    word_counts.append(word_count)
                    vectors_with_text += 1

                total_processed += 1

            pbar.update(len(batch_ids))

        except Exception as e:
            print(f"\nError fetching batch starting at index {i}: {e}")
            pbar.update(len(batch_ids))
            continue

    pbar.close()

    if not word_counts:
        print("No vectors found with text content")
        return {
            "total_vectors": total_processed,
            "vectors_with_text": 0,
            "word_counts": [],
        }

    # Step 3: Calculate statistics
    print(
        f"\nAnalyzed {vectors_with_text} vectors with text content out of {total_processed} total vectors"
    )

    # Calculate basic statistics
    average_words = statistics.mean(word_counts)
    std_dev = statistics.stdev(word_counts) if len(word_counts) > 1 else 0
    min_words = min(word_counts)
    max_words = max(word_counts)
    median_words = statistics.median(word_counts)

    # Calculate percentiles
    word_counts_sorted = sorted(word_counts)
    q25 = (
        statistics.quantiles(word_counts_sorted, n=4)[0]
        if len(word_counts) >= 4
        else min_words
    )
    q75 = (
        statistics.quantiles(word_counts_sorted, n=4)[2]
        if len(word_counts) >= 4
        else max_words
    )

    return {
        "total_vectors": total_processed,
        "vectors_with_text": vectors_with_text,
        "word_counts": word_counts,
        "average_words": average_words,
        "std_deviation": std_dev,
        "min_words": min_words,
        "max_words": max_words,
        "median_words": median_words,
        "q25_words": q25,
        "q75_words": q75,
        "prefix": id_prefix,
    }


def print_analysis_results(results: dict[str, Any]) -> None:
    """
    Print formatted analysis results.

    Args:
        results: Dictionary containing analysis results
    """
    if not results:
        print("No results to display")
        return

    print("\n" + "=" * 60)
    print("TEXT FIELD WORD COUNT ANALYSIS")
    print("=" * 60)
    print(f"Prefix filter: '{results['prefix']}'")
    print(f"Total vectors examined: {results['total_vectors']}")
    print(f"Vectors with text content: {results['vectors_with_text']}")

    if results["vectors_with_text"] == 0:
        print("No text content found for analysis")
        return

    print("\nWORD COUNT STATISTICS:")
    print(f"Average words per chunk: {results['average_words']:.1f}")
    print(f"Standard deviation: {results['std_deviation']:.1f}")
    print(f"Minimum words: {results['min_words']}")
    print(f"Maximum words: {results['max_words']}")
    print(f"Median words: {results['median_words']:.1f}")
    print(f"25th percentile: {results['q25_words']:.1f}")
    print(f"75th percentile: {results['q75_words']:.1f}")

    # Word count distribution
    word_counts = results["word_counts"]
    print("\nWORD COUNT DISTRIBUTION:")

    # Create simple histogram bins
    bins = [
        (0, 100, "0-100 words"),
        (100, 200, "100-200 words"),
        (200, 300, "200-300 words"),
        (300, 400, "300-400 words"),
        (400, 500, "400-500 words"),
        (500, 600, "500-600 words"),
        (600, 1000, "600-1000 words"),
        (1000, float("inf"), "1000+ words"),
    ]

    for min_words, max_words, label in bins:
        count = sum(1 for wc in word_counts if min_words <= wc < max_words)
        percentage = (count / len(word_counts)) * 100
        print(f"{label}: {count} chunks ({percentage:.1f}%)")


def main():
    """Main function to parse arguments and run analysis."""
    parser = argparse.ArgumentParser(
        description="Analyze word counts in Pinecone text fields",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze all text chunks from Crystal Clarity library
  python data_ingestion/bin/analyze_text_field_words.py --site ananda --prefix "text||Crystal Clarity||"
  
  # Analyze all text vectors
  python data_ingestion/bin/analyze_text_field_words.py --site ananda --prefix "text||"
  
  # Analyze specific document
  python data_ingestion/bin/analyze_text_field_words.py --site ananda --prefix "text||Crystal Clarity||Some_Title"
        """,
    )

    parser.add_argument(
        "--site",
        type=str,
        required=True,
        help="Site ID for environment variables (e.g., 'ananda', 'crystal')",
    )

    parser.add_argument(
        "--prefix",
        type=str,
        required=True,
        help="ID prefix to filter vectors (e.g., 'text||Crystal Clarity||')",
    )

    args = parser.parse_args()

    # Load environment variables
    try:
        load_env(args.site)
    except Exception as e:
        print(f"Error loading environment for site '{args.site}': {e}")
        sys.exit(1)

    # Check required environment variables
    if not os.getenv("PINECONE_API_KEY"):
        print("Error: PINECONE_API_KEY environment variable not set")
        sys.exit(1)

    if not os.getenv("PINECONE_INGEST_INDEX_NAME"):
        print("Error: PINECONE_INGEST_INDEX_NAME environment variable not set")
        sys.exit(1)

    try:
        # Run analysis
        results = analyze_text_field_words(args.prefix)
        print_analysis_results(results)

    except Exception as e:
        print(f"Error during analysis: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
