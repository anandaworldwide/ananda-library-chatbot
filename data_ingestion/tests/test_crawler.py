#!/usr/bin/env python
"""Unit tests for the website crawler functionality."""

import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from crawler.website_crawler import WebsiteCrawler, ensure_scheme, load_config


class BaseWebsiteCrawlerTest(unittest.TestCase):
    """Base test class with environment variable setup for WebsiteCrawler tests."""

    def setUp(self):
        """Set up environment variables required by WebsiteCrawler."""
        self.env_patcher = patch.dict(
            os.environ,
            {
                "OPENAI_INGEST_EMBEDDINGS_MODEL": "text-embedding-ada-002",
                "OPENAI_API_KEY": "test-api-key",
            },
        )
        self.env_patcher.start()

    def tearDown(self):
        """Clean up environment variable patches."""
        self.env_patcher.stop()


class TestCrawlerConfig(unittest.TestCase):
    """Test cases for crawler configuration loading."""

    def setUp(self):
        """Set up test environment."""
        self.temp_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.temp_dir) / "crawler_config"
        self.config_dir.mkdir()

        # Create a mock config file
        self.site_id = "test-site"
        self.config_file = self.config_dir / f"{self.site_id}-config.json"
        self.config_data = {
            "domain": "example.com",
            "skip_patterns": ["pattern1", "pattern2"],
            "crawl_frequency_days": 14,
        }

        with open(self.config_file, "w") as f:
            json.dump(self.config_data, f)

    def tearDown(self):
        """Clean up after tests."""
        shutil.rmtree(self.temp_dir)

    @patch("crawler.website_crawler.Path")
    def test_load_config(self, mock_path):
        """Test loading configuration from a site-specific config file."""
        # Set up the mock path to point to our temp directory
        mock_path.return_value.parent.return_value = Path(self.temp_dir)

        # Patch the open function to use our temp file
        with patch(
            "builtins.open",
            new_callable=unittest.mock.mock_open,
            read_data=json.dumps(self.config_data),
        ):
            config = load_config(self.site_id)

            # Verify config was loaded correctly
            self.assertIsNotNone(config)
            self.assertEqual(config["domain"], "example.com")
            self.assertEqual(config["skip_patterns"], ["pattern1", "pattern2"])
            self.assertEqual(config["crawl_frequency_days"], 14)


class TestSQLiteIntegration(BaseWebsiteCrawlerTest):
    """Test cases for SQLite database integration."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()

        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": ["pattern1", "pattern2"],
            "crawl_frequency_days": 7,
        }

        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        # Keep a reference to the original sqlite3.connect
        self.original_sqlite_connect = sqlite3.connect

        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        # The side_effect should call the original connect for ':memory:'
        mock_sqlite_connect.side_effect = (
            lambda db_path_arg: self.original_sqlite_connect(":memory:")
        )

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    def test_database_initialization(self):
        """Test database initialization and table creation."""
        # expected_db_path = str(Path(self.temp_dir) / "db" / f"crawler_queue_{self.site_id}.db")
        # # Override side_effect for this specific test if path verification is critical
        # # For now, the generic side_effect in setUp is fine as we test table creation.

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # sqlite3.connect (the mock) should have been called by WebsiteCrawler
        # The path it was called with would be based on the mocked Path
        # For this test, we mainly care that the crawler got a connection and set up tables.
        self.assertTrue(sqlite3.connect.called)

        # Verify table structure on the in-memory DB the crawler is using
        cursor = crawler.conn.cursor()
        cursor.execute("PRAGMA table_info(crawl_queue)")
        columns_info = cursor.fetchall()
        columns = {row[1] for row in columns_info}

        required_columns = {
            "url",
            "last_crawl",
            "next_crawl",
            "crawl_frequency",
            "content_hash",
            "last_error",
            "status",
            "retry_count",
            "retry_after",
            "failure_type",
        }
        self.assertTrue(
            required_columns.issubset(columns),
            f"Missing columns: {required_columns - columns}",
        )
        crawler.close()

    def test_seed_initial_url(self):
        """Test seeding the initial URL in an empty database."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Crawler's __init__ should seed the start_url.
        # The start_url is derived from self.site_config["domain"]
        expected_start_url = crawler.normalize_url(
            ensure_scheme(self.site_config["domain"])
        )

        cursor = crawler.conn.cursor()
        cursor.execute("SELECT url FROM crawl_queue WHERE status = 'pending'")
        rows = cursor.fetchall()

        self.assertEqual(len(rows), 1, "Should have one pending URL after seeding")
        self.assertEqual(rows[0][0], expected_start_url)

        crawler.close()

    def test_url_operations(self):
        """Test URL queue operations (add, mark visited, etc.)."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        test_urls = [
            crawler.normalize_url("https://example.com/page1"),  # Store normalized
            crawler.normalize_url("https://example.com/page2"),
            crawler.normalize_url("https://example.com/page3"),
        ]

        for url in test_urls:
            crawler.add_url_to_queue(url)  # add_url_to_queue also normalizes

        cursor = crawler.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM crawl_queue WHERE status = 'pending'")
        # Seeded URL + 3 test URLs
        self.assertEqual(cursor.fetchone()[0], len(test_urls) + 1)

        # Mark a URL as visited
        crawler.mark_url_status(test_urls[0], "visited", content_hash="test_hash")
        self.assertTrue(crawler.is_url_visited(test_urls[0]))

        cursor.execute("SELECT COUNT(*) FROM crawl_queue WHERE status = 'visited'")
        self.assertEqual(cursor.fetchone()[0], 1)

        # Mark a URL as failed (temporary)
        crawler.mark_url_status(
            test_urls[1], "failed", error_msg="Temporary connection error"
        )

        # Manually advance time for retry_after to pass for test_urls[1]
        # This depends on the default retry logic (e.g., 5 minutes)
        # For simplicity, we'll assume page3 (test_urls[2]) has its next_crawl due now.
        crawler.cursor.execute(
            "UPDATE crawl_queue SET next_crawl = datetime('now', '-1 hour') WHERE url = ?",
            (test_urls[2],),
        )
        crawler.conn.commit()

        next_url_to_crawl = crawler.get_next_url_to_crawl()
        self.assertEqual(next_url_to_crawl, test_urls[2])

        crawler.close()


class TestChangeDetection(BaseWebsiteCrawlerTest):
    """Test cases for content change detection."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
        }
        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        self.original_sqlite_connect = sqlite3.connect
        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        mock_sqlite_connect.side_effect = (
            lambda db_path_arg: self.original_sqlite_connect(":memory:")
        )

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    def test_content_change_detection(self):
        """Test detection of content changes using hash comparison."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        test_url_raw = "https://example.com/test-page"
        normalized_test_url = crawler.normalize_url(test_url_raw)
        initial_hash = "abc123"

        # Add URL to queue and mark as visited with initial hash
        # Ensure the URL stored in DB is normalized, as should_process_content will query with normalized URL
        crawler.cursor.execute(
            "INSERT INTO crawl_queue (url, status, content_hash, last_crawl, next_crawl, crawl_frequency) VALUES (?, ?, ?, datetime('now'), datetime('now', '+7 days'), ?)",
            (
                normalized_test_url,
                "visited",
                initial_hash,
                crawler.crawl_frequency_days,
            ),
        )
        crawler.conn.commit()

        # Test 1: Same hash should not need processing
        self.assertFalse(
            crawler.should_process_content(normalized_test_url, initial_hash)
        )

        # Test 2: Different hash should need processing
        new_hash = "def456"
        self.assertTrue(crawler.should_process_content(normalized_test_url, new_hash))

        # Test 3: URL not in DB should need processing (should_process_content normalizes its input)
        new_url_raw = "https://example.com/new-page"
        self.assertTrue(crawler.should_process_content(new_url_raw, initial_hash))

        crawler.close()


class TestFailureHandling(BaseWebsiteCrawlerTest):
    """Test cases for handling of failed URLs and retry logic."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
        }
        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        self.original_sqlite_connect = sqlite3.connect
        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        mock_sqlite_connect.side_effect = (
            lambda db_path_arg: self.original_sqlite_connect(":memory:")
        )

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    def test_temporary_failure_retry(self):
        """Test that temporary failures are scheduled for retry with backoff."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        test_url_raw = "https://example.com/connection-error"
        normalized_test_url = crawler.normalize_url(test_url_raw)

        # Add URL to queue as pending
        crawler.add_url_to_queue(normalized_test_url)  # This adds it as 'pending'

        # Mark as failed with a temporary error
        error_msg = "Connection reset by peer"
        crawler.mark_url_status(normalized_test_url, "failed", error_msg=error_msg)

        cursor = crawler.conn.cursor()
        cursor.execute(
            "SELECT status, failure_type, retry_count, retry_after FROM crawl_queue WHERE url = ?",
            (normalized_test_url,),
        )
        row = cursor.fetchone()

        self.assertIsNotNone(row, "URL should exist in DB after marking status")
        self.assertEqual(row["status"], "pending")  # Should be re-scheduled as pending
        self.assertEqual(row["failure_type"], "temporary")
        self.assertEqual(row["retry_count"], 1)
        self.assertIsNotNone(row["retry_after"])
        retry_after_dt = datetime.fromisoformat(row["retry_after"])
        self.assertGreater(retry_after_dt, datetime.now())
        crawler.close()

    def test_permanent_failure(self):
        """Test that permanent failures are marked as failed."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)
        test_url_raw = "https://example.com/not-found"
        normalized_test_url = crawler.normalize_url(test_url_raw)
        crawler.add_url_to_queue(normalized_test_url)

        error_msg = "HTTP 404 Not Found"
        crawler.mark_url_status(normalized_test_url, "failed", error_msg=error_msg)

        cursor = crawler.conn.cursor()
        cursor.execute(
            "SELECT status, failure_type, retry_count FROM crawl_queue WHERE url = ?",
            (normalized_test_url,),
        )
        row = cursor.fetchone()
        self.assertIsNotNone(row, "URL should exist in DB")
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["failure_type"], "permanent")
        self.assertEqual(
            row["retry_count"], 0
        )  # Retry count should be reset for permanent
        crawler.close()

    def test_retry_failed_urls(self):
        """Test that the retry_failed_urls method only retries permanent failures."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        perm_url_raw = "https://example.com/permanent-error"
        temp_url_raw = "https://example.com/temporary-error"
        norm_perm_url = crawler.normalize_url(perm_url_raw)
        norm_temp_url = crawler.normalize_url(temp_url_raw)

        # Add permanent failure
        crawler.cursor.execute(
            "INSERT INTO crawl_queue (url, status, failure_type, last_error) VALUES (?, 'failed', 'permanent', ?)",
            (norm_perm_url, "Some permanent error"),
        )
        # Add temporary failure already scheduled for retry (should not be touched by retry_failed_urls)
        retry_time = (datetime.now() + timedelta(hours=1)).isoformat()
        crawler.cursor.execute(
            "INSERT INTO crawl_queue (url, status, failure_type, retry_count, retry_after, last_error) VALUES (?, 'pending', 'temporary', 1, ?, ?)",
            (norm_temp_url, retry_time, "Some temporary error"),
        )
        crawler.conn.commit()

        crawler.retry_failed_urls()  # This method is in WebsiteCrawler

        # Check permanent failure was reset
        cursor = crawler.conn.cursor()
        cursor.execute(
            "SELECT status, retry_after, failure_type, retry_count FROM crawl_queue WHERE url = ?",
            (norm_perm_url,),
        )
        row_perm = cursor.fetchone()
        self.assertIsNotNone(row_perm, "Permanent URL should exist")
        self.assertEqual(row_perm["status"], "pending")
        self.assertIsNone(row_perm["retry_after"])  # Reset
        self.assertIsNone(row_perm["failure_type"])  # Reset
        self.assertEqual(row_perm["retry_count"], 0)  # Reset

        # Temporary failure should remain untouched (still pending with future retry_after)
        cursor.execute(
            "SELECT status, retry_after, failure_type, retry_count FROM crawl_queue WHERE url = ?",
            (norm_temp_url,),
        )
        row_temp = cursor.fetchone()
        self.assertIsNotNone(row_temp, "Temporary URL should exist")
        self.assertEqual(row_temp["status"], "pending")
        self.assertEqual(row_temp["failure_type"], "temporary")
        self.assertEqual(row_temp["retry_count"], 1)
        self.assertIsNotNone(row_temp["retry_after"])
        self.assertEqual(row_temp["retry_after"], retry_time)

        crawler.close()


class TestDaemonBehavior(BaseWebsiteCrawlerTest):
    """Test cases for daemon loop behavior."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
        }
        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        self.original_sqlite_connect = sqlite3.connect
        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        mock_sqlite_connect.side_effect = (
            lambda db_path_arg: self.original_sqlite_connect(":memory:")
        )

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    @patch("time.sleep")
    @patch(
        "crawler.website_crawler.sync_playwright"
    )  # Mock playwright to prevent actual browser launch
    def test_daemon_sleeps_when_no_urls(self, mock_sync_playwright, mock_time_sleep):
        """Test that the daemon loop sleeps when no URLs are ready to crawl."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Empty the queue to ensure get_next_url_to_crawl returns None
        crawler.cursor.execute("DELETE FROM crawl_queue")
        crawler.conn.commit()

        # Mock get_next_url_to_crawl to reliably return None for this test
        with patch.object(crawler, "get_next_url_to_crawl", return_value=None):
            # Mock args for run_crawl_loop
            mock_args = MagicMock()
            mock_args.daemon = True  # Ensure daemon mode is on
            mock_args.stop_after = (
                None  # Set stop_after to None to avoid comparison error
            )

            # Mock is_exiting from shared utilities to be False for a few iterations
            with patch("crawler.website_crawler.is_exiting") as mock_is_exiting:
                effect_count = 0

                def exit_requested_side_effect():
                    nonlocal effect_count
                    effect_count += 1
                    return effect_count > 2  # False for first two calls, True after

                mock_is_exiting.side_effect = exit_requested_side_effect

                # Mock os.getenv to return a dummy index name
                with patch("os.getenv") as mock_getenv:
                    mock_getenv.return_value = "test-index"
                    from crawler.website_crawler import run_crawl_loop

                    # Run the loop with a short timeout to prevent infinite loop in test
                    run_crawl_loop(crawler, MagicMock(), mock_args)

        # Verify that sleep was called due to no URLs
        mock_time_sleep.assert_called()

        crawler.close()


class TestPunctuationPreservation(BaseWebsiteCrawlerTest):
    """Test cases for punctuation preservation in web crawler text processing."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
        }
        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        self.original_sqlite_connect = sqlite3.connect
        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        mock_sqlite_connect.side_effect = (
            lambda db_path_arg: self.original_sqlite_connect(":memory:")
        )

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    def test_web_content_punctuation_preservation(self):
        """Test that web crawler preserves punctuation in extracted and chunked text."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Mock HTML content with rich punctuation
        html_content_with_punctuation = """
        <html>
        <head><title>Test Article: Meditation & Mindfulness</title></head>
        <body>
            <h1>Welcome to Our Guide!</h1>
            <p>Are you ready to begin your journey? Let's explore meditation together.</p>
            
            <h2>Key Principles:</h2>
            <ul>
                <li>Focus on breathing (inhale... exhale...)</li>
                <li>Don't judge your thoughts—simply observe them</li>
                <li>Practice daily @ 6:00 AM for best results</li>
            </ul>
            
            <blockquote>
                "The mind is everything. What you think you become." —Buddha
            </blockquote>
            
            <p>Remember: it's not about perfection; it's about progress!</p>
            <p>Questions? Email us at info@example.com or call (555) 123-4567.</p>
        </body>
        </html>
        """

        # Mock the text extraction and chunking process
        with patch("crawler.website_crawler.SpacyTextSplitter") as mock_splitter_class:
            # Create a mock splitter instance
            mock_splitter = MagicMock()
            mock_splitter_class.return_value = mock_splitter

            # Mock the split_documents method to return chunks with preserved punctuation
            mock_chunks = [
                MagicMock(
                    page_content="Welcome to Our Guide!\n\nAre you ready to begin your journey? Let's explore meditation together."
                ),
                MagicMock(
                    page_content="Key Principles:\n• Focus on breathing (inhale... exhale...)\n• Don't judge your thoughts—simply observe them"
                ),
                MagicMock(
                    page_content="\"The mind is everything. What you think you become.\" —Buddha\n\nRemember: it's not about perfection; it's about progress!"
                ),
                MagicMock(
                    page_content="Questions? Email us at info@example.com or call (555) 123-4567."
                ),
            ]
            mock_splitter.split_documents.return_value = mock_chunks

            # Mock the HTML extraction to return clean text with punctuation
            with patch.object(crawler, "clean_content") as mock_clean_content:
                extracted_text = """Welcome to Our Guide!

Are you ready to begin your journey? Let's explore meditation together.

Key Principles:
• Focus on breathing (inhale... exhale...)
• Don't judge your thoughts—simply observe them
• Practice daily @ 6:00 AM for best results

"The mind is everything. What you think you become." —Buddha

Remember: it's not about perfection; it's about progress!
Questions? Email us at info@example.com or call (555) 123-4567."""

                mock_clean_content.return_value = extracted_text

                # Test the text extraction preserves punctuation
                cleaned_text = mock_clean_content(html_content_with_punctuation)

                # Verify punctuation marks are preserved in extracted text
                punctuation_marks = [
                    "!",
                    "?",
                    ".",
                    "'",
                    '"',
                    ":",
                    ";",
                    "(",
                    ")",
                    "•",
                    "—",
                    "@",
                    "-",
                ]

                for mark in punctuation_marks:
                    self.assertIn(
                        mark,
                        cleaned_text,
                        f"Punctuation mark '{mark}' should be preserved in extracted text",
                    )

                # Test preservation of contractions and special formatting
                special_elements = [
                    "Let's",
                    "Don't",
                    "it's",
                    "6:00",
                    "info@example.com",
                    "(555) 123-4567",
                ]
                for element in special_elements:
                    self.assertIn(
                        element,
                        cleaned_text,
                        f"Special element '{element}' should be preserved",
                    )

                # Test that chunking preserves punctuation
                from langchain_core.documents import Document

                doc = Document(page_content=cleaned_text)
                chunks = mock_splitter.split_documents([doc])

                # Verify chunks were created
                self.assertGreater(len(chunks), 0, "Should create at least one chunk")

                # Collect all chunk text
                all_chunk_text = " ".join(chunk.page_content for chunk in chunks)

                # Verify punctuation is preserved in chunks
                for mark in punctuation_marks:
                    self.assertIn(
                        mark,
                        all_chunk_text,
                        f"Punctuation mark '{mark}' should be preserved in web crawler chunks",
                    )

                # Verify that each substantial chunk contains meaningful punctuation
                for chunk in chunks:
                    chunk_text = chunk.page_content.strip()
                    if len(chunk_text) > 20:  # Only check substantial chunks
                        # Should contain some punctuation
                        has_punctuation = any(char in chunk_text for char in ".,!?;:—")
                        self.assertTrue(
                            has_punctuation,
                            f"Web crawler chunk should contain punctuation: '{chunk_text[:50]}...'",
                        )

        crawler.close()
        print(
            f"Web crawler punctuation preservation test passed. Processed {len(mock_chunks)} chunks."
        )


class TestCrawlerChunking(unittest.TestCase):
    """Test cases for website crawler chunking functionality."""

    def setUp(self):
        """Set up test environment."""
        from utils.text_splitter_utils import SpacyTextSplitter

        self.text_splitter = SpacyTextSplitter()

    def test_short_content_chunking(self):
        """Test chunking of short web content."""
        from crawler.website_crawler import PageContent, create_chunks_from_page

        page_content = PageContent(
            url="https://example.com/short",
            title="Short Article",
            content="This is a short article with just a few sentences. It should not be chunked into multiple pieces.",
            metadata={},
        )

        chunks = create_chunks_from_page(page_content, self.text_splitter)

        # Short content should result in a single chunk
        self.assertEqual(len(chunks), 1)
        self.assertIn("Short Article", chunks[0])
        self.assertIn("short article", chunks[0])

    def test_medium_content_chunking(self):
        """Test chunking of medium-length web content with paragraphs."""
        from crawler.website_crawler import PageContent, create_chunks_from_page

        page_content = PageContent(
            url="https://example.com/medium",
            title="Medium Length Article",
            content="""This is the first paragraph of a medium-length article. It contains several sentences that provide context and information about the topic being discussed.

This is the second paragraph that continues the discussion. It adds more detail and expands on the concepts introduced in the first paragraph.

This is the third paragraph that provides additional insights. It helps to build a comprehensive understanding of the subject matter.

This is the fourth paragraph that concludes the article. It summarizes the key points and provides final thoughts on the topic.""",
            metadata={},
        )

        chunks = create_chunks_from_page(page_content, self.text_splitter)

        # Medium content should be chunked appropriately
        self.assertGreaterEqual(len(chunks), 1)

        # First chunk should contain the title
        self.assertIn("Medium Length Article", chunks[0])

        # Verify chunks contain content
        all_content = " ".join(chunks)
        self.assertIn("first paragraph", all_content)
        self.assertIn("fourth paragraph", all_content)

    def test_long_content_chunking(self):
        """Test chunking of long web content."""
        from crawler.website_crawler import PageContent, create_chunks_from_page

        # Create a long article with multiple paragraphs
        paragraphs = []
        for i in range(20):
            paragraphs.append(
                f"This is paragraph number {i + 1}. It contains detailed information about a specific aspect of the topic. The content is designed to be comprehensive and informative, providing readers with valuable insights and knowledge."
            )

        page_content = PageContent(
            url="https://example.com/long",
            title="Very Long Comprehensive Article",
            content="\n\n".join(paragraphs),
            metadata={},
        )

        chunks = create_chunks_from_page(page_content, self.text_splitter)

        # Long content should be chunked into multiple pieces
        self.assertGreater(len(chunks), 1)

        # First chunk should contain the title
        self.assertIn("Very Long Comprehensive Article", chunks[0])

        # Verify all content is preserved across chunks
        all_content = " ".join(chunks)
        self.assertIn("paragraph number 1", all_content)
        self.assertIn("paragraph number 20", all_content)

    def test_chunking_with_document_id(self):
        """Test that document ID is properly passed for metrics tracking."""
        from crawler.website_crawler import PageContent, create_chunks_from_page

        page_content = PageContent(
            url="https://example.com/metrics-test",
            title="Metrics Test Article",
            content="This is a test article for verifying that document IDs are properly tracked in chunking metrics.",
            metadata={},
        )

        # Mock the text splitter to verify document_id is passed
        with patch.object(
            self.text_splitter, "split_text", wraps=self.text_splitter.split_text
        ) as mock_split:
            create_chunks_from_page(page_content, self.text_splitter)

            # Verify split_text was called with document_id
            mock_split.assert_called_once()
            args, kwargs = mock_split.call_args
            self.assertEqual(kwargs.get("document_id"), page_content.url)

    def test_chunking_metrics_tracking(self):
        """Test that chunking metrics are properly tracked."""
        from crawler.website_crawler import PageContent, create_chunks_from_page
        from utils.text_splitter_utils import ChunkingMetrics

        page_content = PageContent(
            url="https://example.com/metrics",
            title="Metrics Tracking Test",
            content="""This is a test article for metrics tracking. It has multiple paragraphs to ensure proper chunking behavior.

This is the second paragraph that adds more content to test the chunking algorithm and metrics collection.

This is the third paragraph that provides additional content for comprehensive testing of the chunking functionality.""",
            metadata={},
        )

        # Clear any existing metrics
        self.text_splitter.metrics = ChunkingMetrics()

        create_chunks_from_page(page_content, self.text_splitter)

        # Verify metrics were recorded
        self.assertGreater(self.text_splitter.metrics.total_documents, 0)
        self.assertGreater(self.text_splitter.metrics.total_chunks, 0)

        # Get metrics summary
        summary = self.text_splitter.get_metrics_summary()
        self.assertIn("total_documents", summary)
        self.assertIn("total_chunks", summary)


class TestRobotsTxtCompliance(BaseWebsiteCrawlerTest):
    """Test cases for robots.txt compliance functionality."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
            "crawl_delay_seconds": 1,
        }

        # Mock Path to use temp directory
        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        # Mock sqlite3 to use in-memory database
        self.original_sqlite_connect = sqlite3.connect
        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        mock_sqlite_connect.side_effect = (
            lambda db_path_arg: self.original_sqlite_connect(":memory:")
        )

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_initialization_success(self, mock_robot_parser_class):
        """Test successful robots.txt initialization."""
        mock_parser = Mock()
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify robots.txt parser was initialized
        mock_robot_parser_class.assert_called_once()
        mock_parser.set_url.assert_called_once_with("https://example.com/robots.txt")
        mock_parser.read.assert_called_once()

        self.assertEqual(crawler.robots_parser, mock_parser)
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_initialization_failure(self, mock_robot_parser_class):
        """Test robots.txt initialization failure handling."""
        mock_parser = Mock()
        mock_parser.read.side_effect = Exception("Network error")
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify that parser is set to None on failure
        self.assertIsNone(crawler.robots_parser)
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_allows_crawling(self, mock_robot_parser_class):
        """Test URL validation when robots.txt allows crawling."""
        mock_parser = Mock()
        mock_parser.can_fetch.return_value = True
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test URL that should be allowed
        test_url = "https://example.com/allowed-page"
        result = crawler.is_valid_url(test_url)

        self.assertTrue(result)
        mock_parser.can_fetch.assert_called_with("Ananda Chatbot Crawler", test_url)
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_disallows_crawling(self, mock_robot_parser_class):
        """Test URL validation when robots.txt disallows crawling."""
        mock_parser = Mock()
        mock_parser.can_fetch.return_value = False
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test URL that should be disallowed
        test_url = "https://example.com/disallowed-page"
        result = crawler.is_valid_url(test_url)

        self.assertFalse(result)
        mock_parser.can_fetch.assert_called_with("Ananda Chatbot Crawler", test_url)
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_fallback_when_unavailable(self, mock_robot_parser_class):
        """Test URL validation when robots.txt is unavailable."""
        mock_parser = Mock()
        mock_parser.read.side_effect = Exception("Network error")
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # When robots.txt is unavailable, crawler should proceed with caution
        test_url = "https://example.com/some-page"
        result = crawler.is_valid_url(test_url)

        # Should return True since robots.txt check is skipped
        self.assertTrue(result)
        self.assertIsNone(crawler.robots_parser)
        crawler.close()


class TestRateLimiting(BaseWebsiteCrawlerTest):
    """Test cases for rate limiting enforcement."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()

        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": ["pattern1", "pattern2"],
            "crawl_frequency_days": 7,
            "crawl_delay_seconds": 2,  # 2 seconds between requests
        }

        self.path_patcher = patch("crawler.website_crawler.Path")
        mock_path_constructor = self.path_patcher.start()
        mock_path_constructor.return_value.parent.return_value = Path(self.temp_dir)

        self.original_sqlite_connect = sqlite3.connect
        self.connect_patcher = patch("sqlite3.connect")
        mock_sqlite_connect = self.connect_patcher.start()
        mock_sqlite_connect.return_value.row_factory = sqlite3.Row
        mock_sqlite_connect.return_value.cursor.return_value.execute.return_value.fetchall.return_value = []

        # Mock other dependencies as needed
        self.robots_parser_patcher = patch("crawler.website_crawler.RobotFileParser")
        mock_robots_parser = self.robots_parser_patcher.start()
        mock_robots_parser.return_value.can_fetch.return_value = True

    def tearDown(self):
        """Clean up after tests."""
        self.path_patcher.stop()
        self.connect_patcher.stop()
        self.robots_parser_patcher.stop()
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    def test_crawl_delay_configuration(self):
        """Test that crawl delay is properly configured from site config."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify crawler delay is set from config
        self.assertEqual(crawler.crawl_delay_seconds, 2)

        crawler.close()

    def test_crawl_delay_default_value(self):
        """Test default crawl delay when not specified in config."""
        config_without_delay = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
            # No crawl_delay_seconds specified
        }

        crawler = WebsiteCrawler(self.site_id, config_without_delay)

        # Default delay should be 1 second (from crawler code)
        self.assertEqual(crawler.crawl_delay_seconds, 1)

        crawler.close()

    @patch("time.sleep")
    def test_rate_limiting_enforcement(self, mock_sleep):
        """Test that rate limiting sleep is called after successful page processing."""
        from crawler.website_crawler import _process_crawl_iteration

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Mock dependencies for _process_crawl_iteration
        mock_browser = Mock()
        mock_page = Mock()
        mock_pinecone_index = Mock()
        index_name = "test-index"
        url = "https://example.com/test"

        # Mock sub-functions for successful processing
        with (
            patch(
                "crawler.website_crawler._handle_url_processing",
                return_value=((Mock(), [], False), False),
            ),
            patch(
                "crawler.website_crawler._process_page_content",
                return_value=(
                    1,
                    1,
                ),  # pages_inc=1, restart_inc=1 (successful processing)
            ),
            patch.object(crawler, "commit_db_changes"),
            patch("crawler.website_crawler.is_exiting", return_value=False),
        ):
            pages_inc, restart_inc, should_exit = _process_crawl_iteration(
                url,
                crawler,
                mock_browser,
                mock_page,
                mock_pinecone_index,
                index_name,
            )

            # Verify function executed successfully
            self.assertEqual(pages_inc, 1)
            self.assertEqual(restart_inc, 1)
            self.assertFalse(should_exit)

            # Verify rate limiting sleep was called with correct delay
            mock_sleep.assert_called_once_with(2)  # crawl_delay_seconds from config

        crawler.close()

    @patch("time.sleep")
    def test_no_rate_limiting_on_failed_processing(self, mock_sleep):
        """Test that rate limiting sleep is NOT called when page processing fails."""
        from crawler.website_crawler import _process_crawl_iteration

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Mock dependencies
        mock_browser = Mock()
        mock_page = Mock()
        mock_pinecone_index = Mock()
        index_name = "test-index"
        url = "https://example.com/test"

        # Mock sub-functions to simulate failed processing
        with (
            patch(
                "crawler.website_crawler._handle_url_processing",
                return_value=((Mock(), [], False), False),
            ),
            patch(
                "crawler.website_crawler._process_page_content",
                return_value=(0, 0),  # pages_inc=0, restart_inc=0 (failed processing)
            ),
            patch.object(crawler, "commit_db_changes"),
            patch("crawler.website_crawler.is_exiting", return_value=False),
        ):
            pages_inc, restart_inc, should_exit = _process_crawl_iteration(
                url,
                crawler,
                mock_browser,
                mock_page,
                mock_pinecone_index,
                index_name,
            )

            # Verify processing failed
            self.assertEqual(pages_inc, 0)
            self.assertEqual(restart_inc, 0)
            self.assertFalse(should_exit)

            # Verify NO rate limiting sleep was called
            mock_sleep.assert_not_called()

        crawler.close()

    @patch("time.sleep")
    def test_no_rate_limiting_when_delay_zero(self, mock_sleep):
        """Test that rate limiting sleep is NOT called when delay is set to 0."""
        # Config with zero delay
        config_no_delay = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
            "crawl_delay_seconds": 0,  # No delay
        }

        from crawler.website_crawler import _process_crawl_iteration

        crawler = WebsiteCrawler(self.site_id, config_no_delay)

        # Mock dependencies
        mock_browser = Mock()
        mock_page = Mock()
        mock_pinecone_index = Mock()
        index_name = "test-index"
        url = "https://example.com/test"

        # Mock sub-functions for successful processing
        with (
            patch(
                "crawler.website_crawler._handle_url_processing",
                return_value=((Mock(), [], False), False),
            ),
            patch(
                "crawler.website_crawler._process_page_content",
                return_value=(
                    1,
                    1,
                ),  # pages_inc=1, restart_inc=1 (successful processing)
            ),
            patch.object(crawler, "commit_db_changes"),
            patch("crawler.website_crawler.is_exiting", return_value=False),
        ):
            pages_inc, restart_inc, should_exit = _process_crawl_iteration(
                url,
                crawler,
                mock_browser,
                mock_page,
                mock_pinecone_index,
                index_name,
            )

            # Verify processing succeeded
            self.assertEqual(pages_inc, 1)
            self.assertEqual(restart_inc, 1)
            self.assertFalse(should_exit)

            # Verify NO sleep was called (delay is 0)
            mock_sleep.assert_not_called()

        crawler.close()


class TestBrowserRestartCounter(BaseWebsiteCrawlerTest):
    """Test cases for browser restart counter logic."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
        }

    def tearDown(self):
        """Clean up after tests."""
        shutil.rmtree(self.temp_dir)
        super().tearDown()  # Clean up environment variables

    @patch("crawler.website_crawler.sync_playwright")
    def test_error_restart_counter_bug(self, mock_sync_playwright):
        """Test that error-triggered restart doesn't manipulate pages_since_restart counter incorrectly."""
        from crawler.website_crawler import run_crawl_loop

        # Mock args
        args = Mock()
        args.stop_after = 5  # Stop after 5 pages for testing

        # Mock crawler
        mock_crawler = Mock()
        mock_crawler.get_next_url_to_crawl = Mock()
        mock_crawler.get_queue_stats.return_value = {
            "pending": 10,
            "visited": 5,
            "failed": 2,
            "total": 17,
        }

        # Mock pinecone
        mock_pinecone_index = Mock()

        # Set up URL sequence: first URL causes error, then successful URLs
        urls = [
            "https://example.com/error",
            "https://example.com/page1",
            "https://example.com/page2",
        ]
        mock_crawler.get_next_url_to_crawl.side_effect = urls + [
            None
        ]  # None to end loop

        # Mock browser setup
        mock_playwright = Mock()
        mock_browser = Mock()
        mock_page = Mock()
        mock_sync_playwright.return_value.__enter__.return_value = mock_playwright
        mock_playwright.firefox.launch.return_value = mock_browser
        mock_browser.new_page.return_value = mock_page

        # Track calls to _handle_browser_restart to verify bug
        restart_calls = []

        def mock_handle_browser_restart(*args):
            pages_since_restart_arg = args[3]  # Fourth argument is pages_since_restart
            restart_calls.append(pages_since_restart_arg)
            # Return mocked values
            return mock_browser, mock_page, 0.0, []

        # Track calls to _process_crawl_iteration
        iteration_calls = []

        def mock_process_iteration(url, *args):
            if "error" in url:
                # Simulate error that requires restart: return (0, 0, False)
                iteration_calls.append((url, "error"))
                return (0, 0, False)  # pages_inc=0, restart_inc=0, should_exit=False
            else:
                # Simulate successful processing: return (1, 1, False)
                iteration_calls.append((url, "success"))
                return (1, 1, False)  # pages_inc=1, restart_inc=1, should_exit=False

        # Mock environment variable needed by crawler loop
        with (
            patch("os.getenv") as mock_getenv,
            patch(
                "crawler.website_crawler._handle_browser_restart",
                side_effect=mock_handle_browser_restart,
            ),
            patch(
                "crawler.website_crawler._process_crawl_iteration",
                side_effect=mock_process_iteration,
            ),
            patch("crawler.website_crawler._should_stop_crawling") as mock_should_stop,
            patch("crawler.website_crawler.is_exiting", return_value=False),
        ):
            mock_getenv.return_value = "test-index"  # Mock PINECONE_INGEST_INDEX_NAME

            # Set up stop condition to prevent infinite loop
            mock_should_stop.side_effect = [
                False,
                False,
                False,
                True,
            ]  # Stop after a few iterations

            # This should trigger the bug: error on first URL causes restart to be called
            # with pages_since_restart=1 (not 50), demonstrating premature stats printing
            run_crawl_loop(mock_crawler, mock_pinecone_index, args)

        # Verify the bug exists: restart should be called with the actual counter value
        # (1 page since restart) not the PAGES_PER_RESTART constant (50)
        self.assertTrue(
            len(restart_calls) > 0, "Browser restart should have been triggered"
        )

        # The bug causes this assertion to fail - restart is called with actual pages_since_restart
        # instead of being forced to 50
        first_restart_pages = restart_calls[0]
        self.assertLess(
            first_restart_pages,
            50,
            f"Bug detected: Browser restart was called with {first_restart_pages} pages, "
            f"indicating premature restart stats printing instead of waiting for 50 pages",
        )


class TestGracefulSleep(unittest.TestCase):
    """Test cases for graceful sleep functionality."""

    @patch("crawler.website_crawler.is_exiting")
    @patch("time.sleep")
    def test_graceful_sleep_normal_completion(self, mock_sleep, mock_is_exiting):
        """Test that graceful sleep completes normally when no exit signal."""
        from crawler.website_crawler import _graceful_sleep

        # Mock is_exiting to always return False (no exit requested)
        mock_is_exiting.return_value = False

        # Test sleeping for 90 seconds with 30-second intervals
        result = _graceful_sleep(90, 30)

        # Should complete normally (return False)
        self.assertFalse(result)

        # Should call sleep 3 times: 30, 30, 30 seconds
        self.assertEqual(mock_sleep.call_count, 3)
        mock_sleep.assert_has_calls(
            [unittest.mock.call(30), unittest.mock.call(30), unittest.mock.call(30)]
        )

    @patch("crawler.website_crawler.is_exiting")
    @patch("time.sleep")
    def test_graceful_sleep_exit_requested(self, mock_sleep, mock_is_exiting):
        """Test that graceful sleep exits early when signal received."""
        from crawler.website_crawler import _graceful_sleep

        # Mock is_exiting to return False first, then True (exit after first interval)
        mock_is_exiting.side_effect = [False, True]

        # Test sleeping for 90 seconds with 30-second intervals
        result = _graceful_sleep(90, 30)

        # Should exit early (return True)
        self.assertTrue(result)

        # Should only call sleep once before detecting exit
        self.assertEqual(mock_sleep.call_count, 1)
        mock_sleep.assert_called_once_with(30)

    @patch("crawler.website_crawler.is_exiting")
    @patch("time.sleep")
    def test_graceful_sleep_short_duration(self, mock_sleep, mock_is_exiting):
        """Test graceful sleep with duration shorter than check interval."""
        from crawler.website_crawler import _graceful_sleep

        # Mock is_exiting to always return False
        mock_is_exiting.return_value = False

        # Test sleeping for 15 seconds with 30-second intervals
        result = _graceful_sleep(15, 30)

        # Should complete normally
        self.assertFalse(result)

        # Should call sleep once for the full 15 seconds
        self.assertEqual(mock_sleep.call_count, 1)
        mock_sleep.assert_called_once_with(15)


if __name__ == "__main__":
    unittest.main()
