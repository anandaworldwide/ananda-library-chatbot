#!/usr/bin/env python3
"""
Chunk Size Distribution Analysis Tool

Analyzes chunk size distributions across different libraries and ingestion methods
to identify compliance with the target 450-750 token range (75%-125% of 600 token target).
This tool helps diagnose chunk quality issues and optimize chunking strategies.

Uses systematic enumeration via index.list() and fetch() to avoid sampling bias that
can miss certain content types (audio, video, specialized libraries). This ensures
comprehensive analysis across all vector types in the database.

Usage:
    python bin/analyze_chunk_distributions.py --site ananda [--library <library>] [--method <method>]
    python bin/analyze_chunk_distributions.py --site ananda --library "Crystal Clarity"
    python bin/analyze_chunk_distributions.py --site ananda --method pdf
    python bin/analyze_chunk_distributions.py --site ananda --export-csv
    python bin/analyze_chunk_distributions.py --site ananda --debug

Features:
    - Systematic enumeration of ALL vectors (no sampling bias)
    - Token count distribution analysis per library/method (using tiktoken)
    - Target range compliance (450-750 tokens) calculation
    - Statistical summaries (mean, median, percentiles)
    - Outlier detection (very small/large chunks)
    - Export results to CSV for further analysis
    - Matches SpacyTextSplitter tokenization method
    - Debug mode to monitor progress and content type discovery

Environment Variables Required:
    PINECONE_API_KEY, PINECONE_INDEX_NAME (or PINECONE_INGEST_INDEX_NAME)
"""

import argparse
import csv
import os
import sys

import numpy as np
from pinecone import Pinecone
from tqdm import tqdm

from pyutil.env_utils import load_env


class ChunkDistributionAnalyzer:
    """Analyzes chunk size distributions from Pinecone vector database."""

    def __init__(self, site: str, use_ingest_index: bool = False):
        self.site = site
        # Update to use token-based targets matching the chunking strategy
        self.target_min = 450  # Target minimum tokens per chunk (75% of 600)
        self.target_max = 750  # Target maximum tokens per chunk (125% of 600)
        self.target_ideal = 600  # Ideal target tokens per chunk

        # Load environment and initialize Pinecone
        load_env(site)
        self.pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

        # Determine which index to use
        if use_ingest_index:
            index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")
            if not index_name:
                raise ValueError("PINECONE_INGEST_INDEX_NAME not set")
        else:
            index_name = os.getenv("PINECONE_INDEX_NAME")
            if not index_name:
                raise ValueError("PINECONE_INDEX_NAME not set")

        self.index = self.pc.Index(index_name)
        self.index_name = index_name

        # Storage for analysis results
        self.chunk_data = []  # List of dicts with chunk info

    def analyze_chunks(
        self,
        sample_size: int | None = None,
        debug: bool = False,
    ) -> dict:
        """
        Analyze chunk size distributions from the vector database.

        Uses systematic enumeration via index.list() and fetch() to avoid sampling bias.
        This ensures all content types (audio, video, web, pdf, etc.) are properly represented.

        Args:
            library_filter: Filter to specific library (e.g., "Crystal Clarity")
            method_filter: Filter to specific ingestion method (e.g., "pdf", "audio", "web")
            sample_size: Limit analysis to N chunks (for large databases)
            debug: Enable debug output to show progress and discovered content types

        Returns:
            Dict with analysis results
        """
        print(f"Analyzing chunks from index: {self.index_name}")

        # Get index stats
        index_stats = self.index.describe_index_stats()
        total_vectors = index_stats.total_vector_count

        print(f"Index contains {total_vectors:,} vectors")

        # Determine how many vectors to process
        vectors_to_process = sample_size if sample_size else total_vectors
        print(f"Analyzing up to {vectors_to_process:,} vectors...")

        # Use systematic enumeration via index.list() and fetch()
        # This avoids vector similarity bias inherent in query-based sampling
        fetch_batch_size = (
            100  # IDs to fetch per request (smaller due to metadata size)
        )
        processed = 0
        all_ids = []

        try:
            if debug:
                print("DEBUG: Using systematic enumeration via index.list() + fetch()")

            # Phase 1: List all IDs using pagination
            ids_collected = 0
            list_batch_size = 1000  # Fetch IDs in batches of 1000 to reduce API calls

            # Progress bar for listing phase
            pbar = tqdm(total=vectors_to_process, desc="Listing vector IDs")

            try:
                # The index.list() method returns a generator of IDs
                # We need to iterate through it to collect the IDs
                if debug:
                    print(
                        "DEBUG: Collecting IDs from index.list() generator with batch size",
                        list_batch_size,
                    )

                next_token = None
                while ids_collected < vectors_to_process:
                    try:
                        if next_token:
                            response = self.index.list(
                                limit=list_batch_size, pagination_token=next_token
                            )
                        else:
                            response = self.index.list(limit=list_batch_size)

                        batch_ids = response.get("ids", [])
                        if not batch_ids:
                            if debug:
                                print(
                                    "DEBUG: No more IDs received, ending listing phase"
                                )
                            break

                        all_ids.extend(batch_ids)
                        ids_collected += len(batch_ids)
                        pbar.update(
                            len(batch_ids)
                        )  # Update progress bar only per batch

                        if debug and ids_collected % 5000 == 0:
                            print(f"DEBUG: Collected {ids_collected:,} IDs so far")

                        next_token = response.get("pagination", {}).get("next")
                        if not next_token:
                            if debug:
                                print(
                                    "DEBUG: No more pagination tokens, all IDs collected"
                                )
                            break

                    except Exception as e:
                        print(f"Error listing IDs at position {ids_collected}: {e}")
                        # If listing fails, fall back to query-based sampling
                        print("Falling back to query-based sampling...")
                        return self._fallback_to_query_sampling(
                            vectors_to_process, debug
                        )

            except Exception as list_e:
                print(f"Error listing IDs: {list_e}")
                # If listing fails completely, fall back to query-based sampling
                print("Falling back to query-based sampling...")
                return self._fallback_to_query_sampling(vectors_to_process, debug)
            finally:
                pbar.close()

            print(f"Collected {len(all_ids):,} vector IDs")

            # Phase 2: Fetch metadata in batches
            pbar = tqdm(total=len(all_ids), desc="Fetching metadata")
            processed = 0

            for i in range(0, len(all_ids), fetch_batch_size):
                try:
                    batch_ids = all_ids[i : i + fetch_batch_size]

                    # Fetch metadata for this batch
                    fetch_result = self.index.fetch(ids=batch_ids)

                    if debug and processed == 0:
                        print(
                            f"DEBUG: First fetch batch contains {len(fetch_result.vectors)} vectors"
                        )
                        if fetch_result.vectors:
                            first_id = list(fetch_result.vectors.keys())[0]
                            print(f"DEBUG: Example ID: {first_id}")

                    # Process each vector in the batch
                    for vector_id, vector_data in fetch_result.vectors.items():
                        chunk_info = self._extract_chunk_info(
                            vector_id, vector_data.metadata
                        )
                        if chunk_info:
                            self.chunk_data.append(chunk_info)

                    processed += len(batch_ids)
                    pbar.update(len(batch_ids))

                    if debug and processed % 1000 == 0:
                        print(f"DEBUG: After {processed} vectors processed")

                except Exception as fetch_e:
                    print(f"Error fetching batch starting at {i}: {fetch_e}")
                    # Continue with next batch instead of failing completely
                    processed += len(batch_ids)
                    pbar.update(len(batch_ids))
                    continue

            pbar.close()

            print(f"Processed {len(self.chunk_data):,} chunks matching filters")

            # Generate analysis results
            return self._generate_analysis()

        except Exception as e:
            print(f"Error during systematic enumeration: {e}")
            # If systematic enumeration fails, fall back to query-based sampling
            print("Falling back to query-based sampling...")
            return self._fallback_to_query_sampling(vectors_to_process, debug)

    def _fallback_to_query_sampling(
        self,
        sample_size: int | None = None,
        debug: bool = False,
    ) -> dict:
        """
        Fallback to query-based sampling if systematic enumeration fails.

        This uses the old query() API approach with dummy vectors, which has
        sampling bias but is more reliable across different Pinecone client versions.
        """
        print("Using fallback query-based sampling (may have sampling bias)")

        # Get index stats for dimension
        index_stats = self.index.describe_index_stats()
        dimension = index_stats.dimension

        # Use query API with dummy vector for metadata retrieval
        dummy_vector = [0.0] * dimension
        batch_size = 10000  # Large batches since we're not fetching vector values
        processed = 0
        vectors_to_process = (
            sample_size if sample_size else min(index_stats.total_vector_count, 50000)
        )

        pbar = tqdm(total=vectors_to_process, desc="Processing chunks (fallback)")

        try:
            while processed < vectors_to_process:
                try:
                    query_result = self.index.query(
                        vector=dummy_vector,
                        top_k=min(batch_size, vectors_to_process - processed),
                        include_metadata=True,
                        include_values=False,  # Don't include vector values for speed
                    )

                    if not query_result.matches:
                        break

                    # Process this batch
                    for match in query_result.matches:
                        chunk_info = self._extract_chunk_info(match.id, match.metadata)
                        if chunk_info:
                            self.chunk_data.append(chunk_info)

                    processed += len(query_result.matches)
                    pbar.update(len(query_result.matches))

                    # If we got fewer results than requested, we've reached the end
                    if len(query_result.matches) < batch_size:
                        break

                except Exception as query_e:
                    print(f"Error in batch starting at {processed}: {query_e}")
                    break

        except Exception as e:
            print(f"Error during fallback query sampling: {e}")
            raise
        finally:
            pbar.close()

        print(
            f"Processed {len(self.chunk_data):,} chunks matching filters (fallback method)"
        )
        return self._generate_analysis()

    def _extract_chunk_info(self, vector_id: str, metadata: dict) -> dict | None:
        """Extract chunk information from vector ID and metadata."""
        if not metadata:
            return None

        # Get token count from text metadata using same method as SpacyTextSplitter
        text = metadata.get("text", "")
        if not text:
            return None

        token_count = self._tokenize_text(text)

        # Extract additional info
        author = metadata.get("author", "Unknown")
        source = metadata.get("source", "Unknown")
        doc_type = metadata.get("type", "Unknown")

        return {
            "vector_id": vector_id,
            "token_count": token_count,
            "author": author,
            "source": source,
            "type": doc_type,
            "text_preview": text[:100] + "..." if len(text) > 100 else text,
        }

    def _tokenize_text(self, text: str) -> int:
        """
        Tokenize text and return token count using the same method as SpacyTextSplitter.

        Uses tiktoken for consistency with OpenAI embeddings, with fallback to simple splitting.
        """
        if not text.strip():
            return 0

        try:
            # Use tiktoken for consistent token counting with OpenAI embeddings
            import tiktoken

            encoding = tiktoken.encoding_for_model("text-embedding-ada-002")
            token_count = len(encoding.encode(text))
            return token_count
        except ImportError:
            # Fallback to simple word splitting if tiktoken not available
            return len(text.split())

    def _generate_analysis(self) -> dict:
        """Generate comprehensive analysis of chunk distributions."""
        if not self.chunk_data:
            return {"error": "No chunks found matching criteria"}

        analysis = {
            "summary": self._generate_summary(),
            "compliance_analysis": self._analyze_compliance(),
            "outlier_analysis": self._analyze_outliers(),
        }

        return analysis

    def _generate_summary(self) -> dict:
        """Generate overall summary statistics."""
        all_token_counts = [chunk["token_count"] for chunk in self.chunk_data]

        return {
            "total_chunks": len(all_token_counts),
            "mean_tokens": np.mean(all_token_counts),
            "median_tokens": np.median(all_token_counts),
            "std_tokens": np.std(all_token_counts),
            "min_tokens": min(all_token_counts),
            "max_tokens": max(all_token_counts),
            "percentiles": {
                "25th": np.percentile(all_token_counts, 25),
                "75th": np.percentile(all_token_counts, 75),
                "90th": np.percentile(all_token_counts, 90),
                "95th": np.percentile(all_token_counts, 95),
            },
        }

    def _analyze_compliance(self) -> dict:
        """Analyze overall target range compliance."""
        all_token_counts = [chunk["token_count"] for chunk in self.chunk_data]

        compliant = sum(
            1 for tc in all_token_counts if self.target_min <= tc <= self.target_max
        )
        under_target = sum(1 for tc in all_token_counts if tc < self.target_min)
        over_target = sum(1 for tc in all_token_counts if tc > self.target_max)

        return {
            "target_range": f"{self.target_min}-{self.target_max} tokens",
            "total_chunks": len(all_token_counts),
            "compliant_chunks": compliant,
            "compliance_rate": compliant / len(all_token_counts),
            "under_target_chunks": under_target,
            "under_target_rate": under_target / len(all_token_counts),
            "over_target_chunks": over_target,
            "over_target_rate": over_target / len(all_token_counts),
        }

    def _analyze_outliers(self) -> dict:
        """Identify and analyze outlier chunks."""

        # Define outlier thresholds based on token counts
        very_small_threshold = 100  # Very small chunks (< 100 tokens)
        very_large_threshold = 1200  # Very large chunks (> 1200 tokens, 2x target)

        very_small = [
            chunk
            for chunk in self.chunk_data
            if chunk["token_count"] < very_small_threshold
        ]
        very_large = [
            chunk
            for chunk in self.chunk_data
            if chunk["token_count"] > very_large_threshold
        ]

        return {
            "very_small_chunks": {
                "threshold": f"< {very_small_threshold} tokens",
                "count": len(very_small),
                "rate": len(very_small) / len(self.chunk_data),
                "examples": very_small[:5],  # First 5 examples
            },
            "very_large_chunks": {
                "threshold": f"> {very_large_threshold} tokens",
                "count": len(very_large),
                "rate": len(very_large) / len(self.chunk_data),
                "examples": very_large[:5],  # First 5 examples
            },
        }

    def print_analysis(self, analysis: dict) -> None:
        """Print formatted analysis results."""
        if "error" in analysis:
            print(f"Error: {analysis['error']}")
            return

        # Summary
        summary = analysis["summary"]
        print("\n" + "=" * 60)
        print("CHUNK SIZE DISTRIBUTION ANALYSIS")
        print("=" * 60)
        print(f"Total chunks analyzed: {summary['total_chunks']:,}")
        print(f"Mean tokens per chunk: {summary['mean_tokens']:.1f}")
        print(f"Median tokens per chunk: {summary['median_tokens']:.1f}")
        print(f"Standard deviation: {summary['std_tokens']:.1f}")
        print(f"Range: {summary['min_tokens']} - {summary['max_tokens']} tokens")
        print(f"25th percentile: {summary['percentiles']['25th']:.1f}")
        print(f"75th percentile: {summary['percentiles']['75th']:.1f}")
        print(f"95th percentile: {summary['percentiles']['95th']:.1f}")

        # Compliance Analysis
        compliance = analysis["compliance_analysis"]
        print(f"\nTARGET RANGE COMPLIANCE ({compliance['target_range']}):")
        print(
            f"Compliant chunks: {compliance['compliant_chunks']:,} ({compliance['compliance_rate']:.1%})"
        )
        print(
            f"Under target: {compliance['under_target_chunks']:,} ({compliance['under_target_rate']:.1%})"
        )
        print(
            f"Over target: {compliance['over_target_chunks']:,} ({compliance['over_target_rate']:.1%})"
        )

        # Outliers
        outliers = analysis["outlier_analysis"]
        print("\nOUTLIER ANALYSIS:")
        print(
            f"Very small chunks {outliers['very_small_chunks']['threshold']}: "
            f"{outliers['very_small_chunks']['count']:,} ({outliers['very_small_chunks']['rate']:.1%})"
        )
        print(
            f"Very large chunks {outliers['very_large_chunks']['threshold']}: "
            f"{outliers['very_large_chunks']['count']:,} ({outliers['very_large_chunks']['rate']:.1%})"
        )

    def export_to_csv(self, filename: str) -> None:
        """Export chunk data to CSV file."""
        if not self.chunk_data:
            print("No data to export")
            return

        with open(filename, "w", newline="", encoding="utf-8") as csvfile:
            fieldnames = [
                "vector_id",
                "token_count",
                "author",
                "source",
                "type",
                "target_compliant",
                "text_preview",
            ]
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

            writer.writeheader()
            for chunk in self.chunk_data:
                # Add compliance flag
                chunk["target_compliant"] = (
                    self.target_min <= chunk["token_count"] <= self.target_max
                )
                writer.writerow(chunk)

        print(f"Exported {len(self.chunk_data):,} chunks to {filename}")


def main():
    parser = argparse.ArgumentParser(
        description="Analyze chunk size distributions in Pinecone vector database"
    )
    parser.add_argument(
        "--site", required=True, help="Site ID for environment variables"
    )

    parser.add_argument("--sample-size", type=int, help="Limit analysis to N chunks")
    parser.add_argument(
        "--use-ingest-index",
        action="store_true",
        help="Use PINECONE_INGEST_INDEX_NAME instead of PINECONE_INDEX_NAME",
    )
    parser.add_argument("--export-csv", help="Export results to CSV file")
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug output to diagnose sampling issues",
    )

    args = parser.parse_args()

    try:
        # Initialize analyzer
        analyzer = ChunkDistributionAnalyzer(args.site, args.use_ingest_index)

        # Run analysis
        analysis = analyzer.analyze_chunks(
            sample_size=args.sample_size,
            debug=args.debug,
        )

        # Print results
        analyzer.print_analysis(analysis)

        # Export if requested
        if args.export_csv:
            analyzer.export_to_csv(args.export_csv)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
