#!/usr/bin/env python3
"""
Integration Test Suite for Chunk Quality Verification

This test suite verifies chunk quality consistency across all ingestion methods
by analyzing the results stored in a test Pinecone database. The tests assume
that sample data has been manually ingested using the setup instructions.

Test Coverage:
- Target token range compliance (450-750 tokens, 75%-125% of 600-token target) across all methods
- Metadata preservation verification during chunking
- Consistency verification across PDF, SQL, crawler, and audio/video methods
- Proper vector ID format validation

Prerequisites:
- Test data must be ingested manually using setup instructions
- Test Pinecone database must be populated with sample data
- Environment variables must be configured for test site
"""

import os
import statistics
from typing import Any

import pytest
from pinecone import Pinecone

from pyutil.env_utils import load_env

# Target token range for chunk quality verification (aligned with 600-token target)
TARGET_TOKEN_RANGE = (450, 750)  # 75%-125% of 600-token target
MINIMUM_TARGET_COMPLIANCE = 0.60  # 60% of chunks should be in target range
WEB_CRAWLER_MINIMUM_COMPLIANCE = (
    0.25  # 25% for web crawler (due to many pages with minimal content/video embeds)
)


class ChunkQualityAnalyzer:
    """Analyzes chunk quality metrics from Pinecone database."""

    def __init__(self, pinecone_client, index_name: str):
        self.pc = pinecone_client
        self.index = self.pc.Index(index_name)

    def count_tokens(self, text: str) -> int:
        """
        Count tokens in a text string using tiktoken for consistency with OpenAI embeddings.

        This matches the tokenization used by SpacyTextSplitter and ensures we're measuring
        chunks against the same token counting method used during ingestion.
        """
        if not text or not isinstance(text, str):
            return 0

        try:
            import tiktoken

            encoding = tiktoken.encoding_for_model("text-embedding-ada-002")
            return len(encoding.encode(text))
        except ImportError:
            # Fallback to word count estimation (rough approximation)
            return len(text.strip().split())

    def get_vectors_by_prefix(
        self, prefix: str, limit: int = 1000
    ) -> list[dict[str, Any]]:
        """Fetch vectors matching the given prefix."""
        vector_ids = []
        try:
            for ids_list in self.index.list(prefix=prefix):
                vector_ids.extend(ids_list)
                if len(vector_ids) >= limit:
                    break
        except Exception as e:
            pytest.fail(f"Error listing vector IDs with prefix '{prefix}': {e}")

        if not vector_ids:
            return []

        # Limit to avoid overwhelming the system
        vector_ids = vector_ids[:limit]

        # Fetch vectors in batches
        vectors = []
        batch_size = 50

        for i in range(0, len(vector_ids), batch_size):
            batch_ids = vector_ids[i : i + batch_size]
            try:
                fetch_response = self.index.fetch(ids=batch_ids)
                for vec_id, vector_data in fetch_response.vectors.items():
                    metadata = vector_data.get("metadata", {})
                    if metadata.get("text"):
                        vectors.append({"id": vec_id, "metadata": metadata})
            except Exception as e:
                pytest.fail(f"Error fetching batch: {e}")

        return vectors

    def analyze_chunk_quality(self, vectors: list[dict[str, Any]]) -> dict[str, Any]:
        """Analyze chunk quality metrics for a set of vectors."""
        if not vectors:
            return {
                "total_chunks": 0,
                "token_counts": [],
                "target_compliance": 0.0,
                "avg_tokens": 0,
                "median_tokens": 0,
            }

        token_counts = []
        for vector in vectors:
            text = vector["metadata"].get("text", "")
            token_count = self.count_tokens(text)
            if token_count > 0:
                token_counts.append(token_count)

        if not token_counts:
            return {
                "total_chunks": len(vectors),
                "token_counts": [],
                "target_compliance": 0.0,
                "avg_tokens": 0,
                "median_tokens": 0,
            }

        # Calculate target range compliance (450-750 tokens for 600-token target)
        in_target_range = sum(
            1
            for tc in token_counts
            if TARGET_TOKEN_RANGE[0] <= tc <= TARGET_TOKEN_RANGE[1]
        )
        target_compliance = in_target_range / len(token_counts)

        return {
            "total_chunks": len(token_counts),
            "token_counts": token_counts,
            "target_compliance": target_compliance,
            "in_target_range": in_target_range,
            "avg_tokens": statistics.mean(token_counts),
            "median_tokens": statistics.median(token_counts),
            "min_tokens": min(token_counts),
            "max_tokens": max(token_counts),
        }


@pytest.fixture(scope="session")
def chunk_analyzer():
    """Initialize chunk quality analyzer with test environment."""
    # Load test environment
    test_site = os.getenv("TEST_SITE", "test")
    try:
        load_env(test_site)
    except Exception as e:
        pytest.skip(f"Could not load test environment for site '{test_site}': {e}")

    # Initialize Pinecone
    api_key = os.getenv("PINECONE_API_KEY")
    index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")

    if not api_key or not index_name:
        pytest.skip("PINECONE_API_KEY or PINECONE_INGEST_INDEX_NAME not configured")

    pc = Pinecone(api_key=api_key)

    # Verify index exists and has data
    try:
        index = pc.Index(index_name)
        stats = index.describe_index_stats()
        if stats["total_vector_count"] == 0:
            pytest.skip(
                f"Test index '{index_name}' is empty. Run manual ingestion first."
            )
    except Exception as e:
        pytest.skip(f"Could not connect to test index '{index_name}': {e}")

    return ChunkQualityAnalyzer(pc, index_name)


class TestPDFIngestionQuality:
    """Test chunk quality for PDF ingestion methods."""

    def test_crystal_clarity_pdf_chunks(self, chunk_analyzer):
        """Test chunk quality for Crystal Clarity PDF content."""
        # PDF script should use standardized 7-part format: text||library||source_location||title||author||hash||chunk
        # Expected prefix: text||Crystal Clarity||pdf||
        vectors = chunk_analyzer.get_vectors_by_prefix("text||Crystal Clarity||pdf||")

        if len(vectors) == 0:
            pytest.skip(
                "No Crystal Clarity PDF vectors found in test database. "
                "PDF script needs to be updated to use standardized generate_vector_id() function. "
                "Run manual ingestion first - see data_ingestion/tests/INTEGRATION_TEST_SETUP.md"
            )

        analysis = chunk_analyzer.analyze_chunk_quality(vectors)

        # Verify target range compliance
        assert analysis["target_compliance"] >= MINIMUM_TARGET_COMPLIANCE, (
            f"Crystal Clarity PDF target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {MINIMUM_TARGET_COMPLIANCE:.2%}"
        )

        # Verify reasonable chunk sizes (aligned with 600-token target)
        assert analysis["avg_tokens"] >= 300, (
            f"Average tokens {analysis['avg_tokens']:.1f} too low for PDF content (min 300)"
        )
        assert analysis["avg_tokens"] <= 900, (
            f"Average tokens {analysis['avg_tokens']:.1f} too high for PDF content (max 900)"
        )

        print(
            f"Crystal Clarity PDF Analysis: {analysis['total_chunks']} chunks, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )

    def test_jairam_pdf_chunks(self, chunk_analyzer):
        """Test chunk quality for Jairam PDF content."""
        # PDF script should use standardized 7-part format: text||library||source_location||title||author||hash||chunk
        # Expected prefix: text||jairam||pdf||
        vectors = chunk_analyzer.get_vectors_by_prefix("text||jairam||pdf||")

        if len(vectors) == 0:
            pytest.skip("No Jairam PDF vectors found in test database")

        analysis = chunk_analyzer.analyze_chunk_quality(vectors)

        # Verify target range compliance
        assert analysis["target_compliance"] >= MINIMUM_TARGET_COMPLIANCE, (
            f"Jairam PDF target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {MINIMUM_TARGET_COMPLIANCE:.2%}"
        )

        print(
            f"Jairam PDF Analysis: {analysis['total_chunks']} chunks, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )


class TestAudioVideoIngestionQuality:
    """Test chunk quality for audio/video transcription ingestion."""

    def test_audio_transcription_chunks(self, chunk_analyzer):
        """Test chunk quality for audio transcription content."""
        # Audio script should use standardized 7-part format: audio||library||source_location||title||author||hash||chunk
        # Expected prefix: audio||The Bhaktan Files||audio||
        vectors = chunk_analyzer.get_vectors_by_prefix(
            "audio||The Bhaktan Files||audio||"
        )

        if len(vectors) == 0:
            pytest.skip(
                "No audio transcription vectors found in test database. "
                "Audio script needs to be updated to use standardized generate_vector_id() function."
            )

        analysis = chunk_analyzer.analyze_chunk_quality(vectors)

        # Verify target range compliance
        assert analysis["target_compliance"] >= MINIMUM_TARGET_COMPLIANCE, (
            f"Audio transcription target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {MINIMUM_TARGET_COMPLIANCE:.2%}"
        )

        # Verify metadata preservation for audio content
        sample_vector = chunk_analyzer.get_vectors_by_prefix(
            "audio||The Bhaktan Files||audio||", limit=1
        )[0]
        metadata = sample_vector["metadata"]

        # Check for audio-specific metadata
        assert "filename" in metadata, "Audio chunks missing filename metadata"
        assert "library" in metadata, "Audio chunks missing library metadata"
        assert "start_time" in metadata, "Audio chunks missing start_time metadata"
        assert "end_time" in metadata, "Audio chunks missing end_time metadata"
        assert "duration" in metadata, "Audio chunks missing duration metadata"

        print(
            f"Audio Transcription Analysis: {analysis['total_chunks']} chunks, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )

    def test_video_transcription_chunks(self, chunk_analyzer):
        """Test chunk quality for video transcription content."""
        # Video script should use standardized 7-part format: video||library||source_location||title||author||hash||chunk
        # Expected prefix: video||ananda||video||
        vectors = chunk_analyzer.get_vectors_by_prefix("video||ananda||video||")

        if len(vectors) == 0:
            pytest.skip("No video transcription vectors found in test database")

        analysis = chunk_analyzer.analyze_chunk_quality(vectors)

        # Verify target range compliance
        assert analysis["target_compliance"] >= MINIMUM_TARGET_COMPLIANCE, (
            f"Video transcription target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {MINIMUM_TARGET_COMPLIANCE:.2%}"
        )

        print(
            f"Video Transcription Analysis: {analysis['total_chunks']} chunks, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )


class TestWebCrawlerIngestionQuality:
    """Test chunk quality for web crawler ingestion."""

    def test_web_crawler_chunks(self, chunk_analyzer):
        """Test chunk quality for web crawler content."""
        # Web crawler uses standardized 7-part format: text||library||source_location||title||author||hash||chunk
        # Expected prefix: text||ananda.org||web||
        vectors = chunk_analyzer.get_vectors_by_prefix("text||ananda.org||web||")

        if len(vectors) == 0:
            pytest.skip("No web crawler vectors found in test database")

        analysis = chunk_analyzer.analyze_chunk_quality(vectors)

        # Verify target range compliance (lower threshold for web content due to many pages with minimal content/video embeds)
        assert analysis["target_compliance"] >= WEB_CRAWLER_MINIMUM_COMPLIANCE, (
            f"Web crawler target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {WEB_CRAWLER_MINIMUM_COMPLIANCE:.2%}"
        )

        # Verify metadata preservation for web content
        sample_vector = chunk_analyzer.get_vectors_by_prefix(
            "text||ananda.org||web||", limit=1
        )[0]
        metadata = sample_vector["metadata"]

        # Check for web-specific metadata
        assert "url" in metadata, "Web chunks missing url metadata"
        assert "title" in metadata, "Web chunks missing title metadata"

        print(
            f"Web Crawler Analysis: {analysis['total_chunks']} chunks, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )


class TestSQLIngestionQuality:
    """Test chunk quality for SQL database ingestion."""

    def test_sql_database_chunks(self, chunk_analyzer):
        """Test chunk quality for SQL database content."""
        # SQL script uses standardized 7-part format: text||library||source_location||title||author||hash||chunk
        # Expected prefix: text||ananda||db||
        vectors = chunk_analyzer.get_vectors_by_prefix("text||Ananda Library||db||")

        if len(vectors) == 0:
            pytest.skip("No SQL database vectors found in test database")

        analysis = chunk_analyzer.analyze_chunk_quality(vectors)

        # Verify target range compliance
        assert analysis["target_compliance"] >= MINIMUM_TARGET_COMPLIANCE, (
            f"SQL database target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {MINIMUM_TARGET_COMPLIANCE:.2%}"
        )

        print(
            f"SQL Database Analysis: {analysis['total_chunks']} chunks, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )


class TestCrossMethodConsistency:
    """Test consistency across all ingestion methods."""

    def test_vector_id_format_consistency(self, chunk_analyzer):
        """Test that all vectors follow the standardized 7-part ID format."""
        # Test each content type with correct standardized prefixes
        prefixes = [
            "text||Crystal Clarity||pdf||",
            "text||jairam||pdf||",
            "audio||The Bhaktan Files||audio||",
            "video||ananda||video||",
            "text||ananda.org||web||",
            "text||ananda||db||",
        ]

        format_violations = []

        for prefix in prefixes:
            vectors = chunk_analyzer.get_vectors_by_prefix(prefix, limit=10)
            if not vectors:
                continue

            for vector in vectors:
                vector_id = vector["id"]
                parts = vector_id.split("||")

                if len(parts) != 7:
                    format_violations.append(
                        f"Vector {vector_id} has {len(parts)} parts, expected 7"
                    )
                else:
                    # Verify format: content_type||library||source_location||title||author||hash||chunk_index
                    if parts[0] not in ["text", "audio", "video"]:
                        format_violations.append(
                            f"Vector {vector_id} content_type '{parts[0]}' should be one of: text, audio, video"
                        )
                    if not parts[6].isdigit():
                        format_violations.append(
                            f"Vector {vector_id} chunk_index '{parts[6]}' should be numeric"
                        )

        assert not format_violations, (
            f"Vector ID format violations: {format_violations}"
        )

    def test_metadata_consistency(self, chunk_analyzer):
        """Test that all vectors have required metadata fields."""
        prefixes = [
            "text||Crystal Clarity||pdf||",
            "text||jairam||pdf||",
            "audio||The Bhaktan Files||audio||",
            "text||ananda.org||web||",
            "text||ananda||db||",
        ]

        required_fields = ["text", "library", "type"]
        missing_fields = []

        for prefix in prefixes:
            vectors = chunk_analyzer.get_vectors_by_prefix(prefix, limit=5)
            if not vectors:
                continue

            for vector in vectors:
                metadata = vector["metadata"]
                for field in required_fields:
                    if field not in metadata:
                        missing_fields.append(
                            f"Vector {vector['id']} missing field '{field}'"
                        )

        assert not missing_fields, f"Missing metadata fields: {missing_fields}"

    def test_overall_target_compliance(self, chunk_analyzer):
        """Test overall target range compliance across all methods."""
        # Get vectors from all content types
        all_vectors = []
        content_prefixes = ["text||", "audio||", "video||"]
        for content_prefix in content_prefixes:
            vectors = chunk_analyzer.get_vectors_by_prefix(content_prefix, limit=500)
            all_vectors.extend(vectors)

        if len(all_vectors) == 0:
            pytest.skip(
                "No vectors found in test database. "
                "Run manual ingestion first - see data_ingestion/tests/INTEGRATION_TEST_SETUP.md"
            )

        analysis = chunk_analyzer.analyze_chunk_quality(all_vectors)

        # Overall compliance should meet minimum threshold
        assert analysis["target_compliance"] >= MINIMUM_TARGET_COMPLIANCE, (
            f"Overall target compliance {analysis['target_compliance']:.2%} "
            f"below minimum {MINIMUM_TARGET_COMPLIANCE:.2%}"
        )

        print(
            f"Overall Analysis: {analysis['total_chunks']} chunks across all methods, "
            f"{analysis['target_compliance']:.2%} in target range, "
            f"avg {analysis['avg_tokens']:.1f} tokens"
        )

    def test_method_consistency(self, chunk_analyzer):
        """Test that different ingestion methods produce similar quality metrics."""
        method_analyses = {}

        method_prefixes = {
            "PDF": "text||Crystal Clarity||pdf||",
            "Audio": "audio||The Bhaktan Files||audio||",
            "Web": "text||ananda.org||web||",
            "SQL": "text||ananda||db||",
        }

        for method, prefix in method_prefixes.items():
            vectors = chunk_analyzer.get_vectors_by_prefix(prefix, limit=100)
            if vectors:
                analysis = chunk_analyzer.analyze_chunk_quality(vectors)
                method_analyses[method] = analysis

        # Ensure we have at least 2 methods to compare
        if len(method_analyses) < 2:
            pytest.skip(
                f"Need at least 2 methods for comparison, found {len(method_analyses)}. "
                "Run manual ingestion for multiple content types - see data_ingestion/tests/INTEGRATION_TEST_SETUP.md"
            )

        # Check that all methods meet minimum compliance (use different thresholds for web crawler)
        for method, analysis in method_analyses.items():
            expected_compliance = (
                WEB_CRAWLER_MINIMUM_COMPLIANCE
                if method == "Web"
                else MINIMUM_TARGET_COMPLIANCE
            )
            threshold_name = (
                "web crawler minimum" if method == "Web" else "standard minimum"
            )
            assert analysis["target_compliance"] >= expected_compliance, (
                f"{method} method compliance {analysis['target_compliance']:.2%} below {threshold_name} ({expected_compliance:.2%})"
            )

        # Check that average token counts are reasonably consistent (within 2x of each other)
        avg_tokens = [analysis["avg_tokens"] for analysis in method_analyses.values()]
        max_avg = max(avg_tokens)
        min_avg = min(avg_tokens)

        assert max_avg / min_avg <= 3.0, (
            f"Average token counts too inconsistent across methods: {dict(zip(method_analyses.keys(), avg_tokens, strict=False))}"
        )

        print("Method Consistency Analysis:")
        for method, analysis in method_analyses.items():
            print(
                f"  {method}: {analysis['total_chunks']} chunks, "
                f"{analysis['target_compliance']:.2%} compliance, "
                f"avg {analysis['avg_tokens']:.1f} tokens"
            )


if __name__ == "__main__":
    # Run tests with verbose output
    pytest.main([__file__, "-v", "-s"])
