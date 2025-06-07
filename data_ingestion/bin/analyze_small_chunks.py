#!/usr/bin/env python3
"""
Analyze small chunks in Pinecone vector database for debugging chunk quality issues.

This script helps identify and analyze chunks that are unusually small (< 50 words)
to understand why they were created and whether they indicate content quality issues.

Command Line Options:
  --site SITE                   Site name for loading environment variables (required)
  --library LIBRARY             Library name to analyze (required)
  --small-threshold WORDS       Flag chunks below this word count as small (default: 50)
  --large-threshold WORDS       Flag chunks above this word count as large (default: 800)
  --show-content                Show actual chunk content for analysis
  --export-csv                  Export results to CSV file
  --delete-small                Delete chunks below small-threshold (USE WITH CAUTION)
  --dry-run                     Show what would be deleted without actually deleting

Usage Examples:
  python analyze_small_chunks.py --site ananda --library ananda.org
  python analyze_small_chunks.py --site ananda --library ananda.org --small-threshold 30 --show-content
  python analyze_small_chunks.py --site ananda --library ananda.org --export-csv
  python analyze_small_chunks.py --site ananda --library ananda.org --delete-small --dry-run
"""

import argparse
import csv
import os
import sys
from collections import defaultdict
from datetime import datetime

from data_ingestion.utils.embeddings_utils import OpenAIEmbeddings
from data_ingestion.utils.pinecone_utils import (
    get_pinecone_client,
    get_pinecone_ingest_index_name,
)
from pyutil.env_utils import load_env


class ChunkAnalyzer:
    """Analyzes chunk quality in Pinecone vector database."""

    def __init__(self, pinecone_index, library_name: str, embedding_dimension: int):
        self.pinecone_index = pinecone_index
        self.library_name = library_name
        self.embedding_dimension = embedding_dimension
        self.chunk_stats = {
            "total_chunks": 0,
            "small_chunks": 0,
            "large_chunks": 0,
            "target_range_chunks": 0,
            "word_count_distribution": defaultdict(int),
            "source_distribution": defaultdict(int),
            "type_distribution": defaultdict(int),
        }

    def analyze_chunks(
        self,
        small_threshold: int = 50,
        large_threshold: int = 800,
        show_content: bool = False,
    ):
        """Analyze all chunks for the library and identify quality issues."""
        print(f"🔍 Analyzing chunks for library: {self.library_name}")
        print(
            f"📊 Thresholds: small=<{small_threshold} words, large=>{large_threshold} words, target=225-450 words"
        )
        print("=" * 70)

        # Query all vectors for this library
        filter_dict = {"library": {"$eq": self.library_name}}

        small_chunks = []
        large_chunks = []

        try:
            # Create dummy vector with correct dimension
            dummy_vector = [0.0] * self.embedding_dimension
            response = self.pinecone_index.query(
                vector=dummy_vector,  # Use dynamic dimension
                filter=filter_dict,
                top_k=10000,
                include_metadata=True,
            )

            vectors = response.get("matches", [])
            print(
                f"📦 Found {len(vectors)} chunks matching library filter: '{self.library_name}'"
            )

            if not vectors:
                print("❌ No chunks found for this library")
                return [], []

        except Exception as e:
            print(f"❌ Error querying Pinecone with filter: {e}")
            return [], []

        # Analyze each chunk
        for vector in vectors:
            metadata = vector.get("metadata", {})
            text = metadata.get("text", "")
            word_count = len(text.split()) if text else 0

            # Update statistics
            self.chunk_stats["total_chunks"] += 1
            self._update_stats(metadata, word_count, small_threshold, large_threshold)

            # Identify problematic chunks
            if word_count < small_threshold:
                small_chunks.append(
                    {
                        "id": vector["id"],
                        "word_count": word_count,
                        "text": text,
                        "metadata": metadata,
                    }
                )

            elif word_count > large_threshold:
                large_chunks.append(
                    {
                        "id": vector["id"],
                        "word_count": word_count,
                        "text": text,
                        "metadata": metadata,
                    }
                )

        # Sort by word count
        small_chunks.sort(key=lambda x: x["word_count"])
        large_chunks.sort(key=lambda x: x["word_count"], reverse=True)

        # Print analysis results
        self._print_analysis_results(
            small_chunks, large_chunks, small_threshold, large_threshold, show_content
        )

        return small_chunks, large_chunks

    def _update_stats(
        self,
        metadata: dict,
        word_count: int,
        small_threshold: int,
        large_threshold: int,
    ):
        """Update chunk statistics."""
        self._update_word_count_distribution(word_count)
        self._update_problem_chunk_counts(word_count, small_threshold, large_threshold)
        self._update_source_distribution(metadata)
        self._update_type_distribution(metadata)

    def _update_word_count_distribution(self, word_count: int):
        """Update word count distribution statistics."""
        if word_count < 50:
            self.chunk_stats["word_count_distribution"]["<50 words"] += 1
        elif word_count < 100:
            self.chunk_stats["word_count_distribution"]["50-99 words"] += 1
        elif word_count < 225:
            self.chunk_stats["word_count_distribution"]["100-224 words"] += 1
        elif word_count <= 450:
            self.chunk_stats["word_count_distribution"]["225-450 words (TARGET)"] += 1
            self.chunk_stats["target_range_chunks"] += 1
        elif word_count < 800:
            self.chunk_stats["word_count_distribution"]["451-799 words"] += 1
        else:
            self.chunk_stats["word_count_distribution"]["800+ words"] += 1

    def _update_problem_chunk_counts(
        self, word_count: int, small_threshold: int, large_threshold: int
    ):
        """Update counts for problematic chunks (too small or too large)."""
        if word_count < small_threshold:
            self.chunk_stats["small_chunks"] += 1
        elif word_count > large_threshold:
            self.chunk_stats["large_chunks"] += 1

    def _update_source_distribution(self, metadata: dict):
        """Update source type distribution statistics."""
        source = metadata.get("source", "Unknown")
        if source.startswith("http"):
            self.chunk_stats["source_distribution"]["Web"] += 1
        elif source.endswith(".pdf"):
            self.chunk_stats["source_distribution"]["PDF"] += 1
        elif "audio" in source or "video" in source:
            self.chunk_stats["source_distribution"]["Audio/Video"] += 1
        else:
            self.chunk_stats["source_distribution"]["Other"] += 1

    def _update_type_distribution(self, metadata: dict):
        """Update content type distribution statistics."""
        chunk_type = metadata.get("type", metadata.get("content_type", "Unknown"))
        self.chunk_stats["type_distribution"][chunk_type] += 1

    def _print_analysis_results(
        self,
        small_chunks: list,
        large_chunks: list,
        small_threshold: int,
        large_threshold: int,
        show_content: bool,
    ):
        """Print detailed analysis results."""
        self._print_overall_statistics(small_threshold, large_threshold)
        self._print_distribution_statistics()

        if small_chunks:
            self._print_small_chunks_analysis(
                small_chunks, small_threshold, show_content
            )

        if large_chunks:
            self._print_large_chunks_analysis(
                large_chunks, large_threshold, show_content
            )

    def _print_overall_statistics(self, small_threshold: int, large_threshold: int):
        """Print overall chunk statistics."""
        stats = self.chunk_stats

        print("\n📈 CHUNK QUALITY ANALYSIS RESULTS")
        print("=" * 70)

        print(f"📊 Total chunks analyzed: {stats['total_chunks']}")
        print(
            f"🎯 Target range (225-450 words): {stats['target_range_chunks']} ({stats['target_range_chunks'] / stats['total_chunks'] * 100:.1f}%)"
        )
        print(
            f"🔻 Small chunks (<{small_threshold} words): {stats['small_chunks']} ({stats['small_chunks'] / stats['total_chunks'] * 100:.1f}%)"
        )
        print(
            f"🔺 Large chunks (>{large_threshold} words): {stats['large_chunks']} ({stats['large_chunks'] / stats['total_chunks'] * 100:.1f}%)"
        )

    def _print_distribution_statistics(self):
        """Print word count, source, and content type distributions."""
        stats = self.chunk_stats

        # Word count distribution
        print("\n📊 Word Count Distribution:")
        for range_name, count in stats["word_count_distribution"].items():
            percentage = (
                (count / stats["total_chunks"] * 100)
                if stats["total_chunks"] > 0
                else 0
            )
            print(f"  {range_name}: {count} chunks ({percentage:.1f}%)")

        # Source distribution
        print("\n📁 Source Type Distribution:")
        for source_type, count in stats["source_distribution"].items():
            percentage = (
                (count / stats["total_chunks"] * 100)
                if stats["total_chunks"] > 0
                else 0
            )
            print(f"  {source_type}: {count} chunks ({percentage:.1f}%)")

        # Content type distribution
        print("\n📄 Content Type Distribution:")
        for content_type, count in stats["type_distribution"].items():
            percentage = (
                (count / stats["total_chunks"] * 100)
                if stats["total_chunks"] > 0
                else 0
            )
            print(f"  {content_type}: {count} chunks ({percentage:.1f}%)")

    def _print_small_chunks_analysis(
        self, small_chunks: list, small_threshold: int, show_content: bool
    ):
        """Print analysis of small chunks."""
        print(f"\n🔻 SMALL CHUNKS ANALYSIS (<{small_threshold} words)")
        print("=" * 70)

        by_source = self._group_chunks_by_source(small_chunks)
        print(
            f"📋 Found {len(small_chunks)} small chunks from {len(by_source)} different sources:"
        )

        self._print_chunks_by_source(by_source, show_content, max_shown=3)

    def _print_large_chunks_analysis(
        self, large_chunks: list, large_threshold: int, show_content: bool
    ):
        """Print analysis of large chunks."""
        print(f"\n🔺 LARGE CHUNKS ANALYSIS (>{large_threshold} words)")
        print("=" * 70)

        by_source = self._group_chunks_by_source(large_chunks)
        print(
            f"📋 Found {len(large_chunks)} large chunks from {len(by_source)} different sources:"
        )

        self._print_chunks_by_source(by_source, show_content, max_shown=2)

    def _group_chunks_by_source(self, chunks: list) -> dict:
        """Group chunks by their source."""
        by_source = defaultdict(list)
        for chunk in chunks:
            source = chunk["metadata"].get("source", "Unknown")
            by_source[source].append(chunk)
        return by_source

    def _print_chunks_by_source(
        self, by_source: dict, show_content: bool, max_shown: int
    ):
        """Print chunks grouped by source with optional content preview."""
        for source, chunks in by_source.items():
            word_counts = [c["word_count"] for c in chunks]
            avg_words = sum(word_counts) / len(word_counts)
            print(f"\n📄 {source}")

            if len(chunks) == 1:
                # Single chunk - just show the word count
                print(f"   Chunks: 1, {word_counts[0]} words")
            else:
                # Multiple chunks - show range and average
                print(
                    f"   Chunks: {len(chunks)}, Word range: {min(word_counts)}-{max(word_counts)}, Avg: {avg_words:.1f}"
                )

            if show_content:
                for i, chunk in enumerate(chunks[:max_shown]):
                    preview_length = 100 if max_shown == 3 else 150
                    print(
                        f'   [{i + 1}] {chunk["word_count"]} words: "{chunk["text"][:preview_length]}..."'
                    )
                if len(chunks) > max_shown:
                    print(f"   ... and {len(chunks) - max_shown} more chunks")

    def export_to_csv(
        self, small_chunks: list, large_chunks: list, filename: str = None
    ):
        """Export analysis results to CSV file."""
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = (
                f"chunk_analysis_{self.library_name.replace('.', '_')}_{timestamp}.csv"
            )

        print(f"\n💾 Exporting results to: {filename}")

        with open(filename, "w", newline="", encoding="utf-8") as csvfile:
            fieldnames = [
                "chunk_id",
                "word_count",
                "category",
                "source",
                "type",
                "author",
                "title",
                "text_preview",
            ]
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()

            # Export small chunks
            for chunk in small_chunks:
                writer.writerow(
                    {
                        "chunk_id": chunk["id"],
                        "word_count": chunk["word_count"],
                        "category": "Small",
                        "source": chunk["metadata"].get("source", ""),
                        "type": chunk["metadata"].get(
                            "type", chunk["metadata"].get("content_type", "")
                        ),
                        "author": chunk["metadata"].get("author", ""),
                        "title": chunk["metadata"].get("title", ""),
                        "text_preview": chunk["text"][:200] + "..."
                        if len(chunk["text"]) > 200
                        else chunk["text"],
                    }
                )

            # Export large chunks
            for chunk in large_chunks:
                writer.writerow(
                    {
                        "chunk_id": chunk["id"],
                        "word_count": chunk["word_count"],
                        "category": "Large",
                        "source": chunk["metadata"].get("source", ""),
                        "type": chunk["metadata"].get(
                            "type", chunk["metadata"].get("content_type", "")
                        ),
                        "author": chunk["metadata"].get("author", ""),
                        "title": chunk["metadata"].get("title", ""),
                        "text_preview": chunk["text"][:200] + "..."
                        if len(chunk["text"]) > 200
                        else chunk["text"],
                    }
                )

        print(
            f"✅ Exported {len(small_chunks)} small chunks and {len(large_chunks)} large chunks"
        )

    def delete_small_chunks(self, small_chunks: list, dry_run: bool = True):
        """Delete small chunks from Pinecone."""
        if not small_chunks:
            print("✅ No small chunks to delete")
            return

        chunk_ids = [chunk["id"] for chunk in small_chunks]

        if dry_run:
            print(f"\n🔍 DRY RUN: Would delete {len(chunk_ids)} small chunks:")
            for chunk in small_chunks[:10]:  # Show first 10
                print(f"  - {chunk['id']} ({chunk['word_count']} words)")
            if len(small_chunks) > 10:
                print(f"  ... and {len(small_chunks) - 10} more chunks")
            print("\n⚠️  To actually delete, run without --dry-run flag")
        else:
            print(f"\n🗑️  DELETING {len(chunk_ids)} small chunks...")

            # Delete in batches of 100 (Pinecone limit)
            batch_size = 100
            for i in range(0, len(chunk_ids), batch_size):
                batch = chunk_ids[i : i + batch_size]
                try:
                    self.pinecone_index.delete(ids=batch)
                    print(
                        f"✅ Deleted batch {i // batch_size + 1}/{(len(chunk_ids) + batch_size - 1) // batch_size}"
                    )
                except Exception as e:
                    print(f"❌ Error deleting batch: {e}")

            print(f"✅ Finished deleting {len(chunk_ids)} small chunks")


def main():
    """Main function to analyze chunks in Pinecone."""
    parser = argparse.ArgumentParser(
        description="Analyze small chunks in Pinecone vector database"
    )
    parser.add_argument(
        "--site", required=True, help="Site name for loading environment variables"
    )
    parser.add_argument("--library", required=True, help="Library name to analyze")
    parser.add_argument(
        "--small-threshold",
        type=int,
        default=50,
        help="Flag chunks below this word count as small (default: 50)",
    )
    parser.add_argument(
        "--large-threshold",
        type=int,
        default=800,
        help="Flag chunks above this word count as large (default: 800)",
    )
    parser.add_argument(
        "--show-content",
        action="store_true",
        help="Show actual chunk content for analysis",
    )
    parser.add_argument(
        "--export-csv", action="store_true", help="Export results to CSV file"
    )
    parser.add_argument(
        "--delete-small",
        action="store_true",
        help="Delete chunks below small-threshold (USE WITH CAUTION)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without actually deleting",
    )

    args = parser.parse_args()

    # Load environment variables
    load_env(args.site)

    try:
        # Initialize Pinecone
        pinecone = get_pinecone_client()
        index_name = get_pinecone_ingest_index_name()
        pinecone_index = pinecone.Index(index_name)

        print(f"🚀 Connected to Pinecone index: {index_name}")

        # Get embedding dimension from OpenAI model
        try:
            model_name = os.environ.get("OPENAI_INGEST_EMBEDDINGS_MODEL")
            if not model_name:
                raise ValueError(
                    "OPENAI_INGEST_EMBEDDINGS_MODEL environment variable not set"
                )

            embeddings = OpenAIEmbeddings(model=model_name)
            # Get dimension by creating a test embedding
            test_embedding = embeddings.embed_query("test")
            embedding_dimension = len(test_embedding)
            print(
                f"📏 Using embedding dimension: {embedding_dimension} (from model: {model_name})"
            )
        except Exception as e:
            print(f"⚠️  Could not determine embedding dimension from model: {e}")
            print("🔧 Falling back to default dimension: 1536")
            embedding_dimension = 1536

        # Create analyzer and run analysis
        analyzer = ChunkAnalyzer(pinecone_index, args.library, embedding_dimension)
        small_chunks, large_chunks = analyzer.analyze_chunks(
            small_threshold=args.small_threshold,
            large_threshold=args.large_threshold,
            show_content=args.show_content,
        )

        # Export to CSV if requested
        if args.export_csv:
            analyzer.export_to_csv(small_chunks, large_chunks)

        # Delete small chunks if requested
        if args.delete_small:
            analyzer.delete_small_chunks(small_chunks, dry_run=args.dry_run)

        # Summary
        print("\n🎯 SUMMARY")
        print("=" * 70)
        print(f"📊 Total chunks: {analyzer.chunk_stats['total_chunks']}")
        print(f"🔻 Small chunks (<{args.small_threshold} words): {len(small_chunks)}")
        print(f"🔺 Large chunks (>{args.large_threshold} words): {len(large_chunks)}")

        # Fix division by zero error
        total_chunks = analyzer.chunk_stats["total_chunks"]
        if total_chunks > 0:
            target_percentage = (
                analyzer.chunk_stats["target_range_chunks"] / total_chunks * 100
            )
            print(
                f"🎯 Target range (225-450): {analyzer.chunk_stats['target_range_chunks']} ({target_percentage:.1f}%)"
            )
        else:
            print("🎯 Target range (225-450): 0 (N/A - no chunks found)")

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
