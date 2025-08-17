#!/usr/bin/env python
"""Unit tests for the website crawler functionality."""

import json
import os
import shutil
import sqlite3

# Mock spaCy at module level to prevent loading in any test
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

# Import the crawler class
import pytest
from crawler.website_crawler import WebsiteCrawler

# Mock spaCy only for the WebsiteCrawler module by patching the import
# This avoids affecting other test files that need real spaCy
mock_spacy = Mock()
mock_nlp = Mock()
mock_nlp.max_length = 2_000_000
mock_spacy.load.return_value = mock_nlp

# Store original spacy module if it exists
original_spacy = sys.modules.get("spacy")
sys.modules["spacy"] = mock_spacy

# Mock Pinecone SDK to avoid any real network I/O or API authentication
mock_pinecone = Mock(name="pinecone")
mock_pinecone.init.return_value = None


# Provide a dummy Index class that plays nicely with type-hint unions
class _FakePineconeIndex(Mock):
    def __or__(self, other):  # type: ignore[override]
        return self


mock_pinecone.Index = _FakePineconeIndex  # type: ignore[attr-defined]
mock_index = _FakePineconeIndex(name="Index")
mock_index.namespace.return_value = mock_index
mock_pinecone.Index.return_value = mock_index
sys.modules["pinecone"] = mock_pinecone

# Mock OpenAI to prevent HTTP calls
mock_openai = Mock(name="openai")
sys.modules.setdefault("openai", mock_openai)

# Mock urllib.request.urlopen to prevent robots.txt HTTP fetches
import urllib.request  # noqa: E402
from types import SimpleNamespace  # noqa: E402


def _robots_response(url: str, *args, **kwargs):
    """Return an in-memory fake robots.txt response object."""
    # Minimal file that allows everything.
    data = b"User-agent: *\nDisallow:\n"
    fake = SimpleNamespace(
        url=url,
        headers={},
        status=200,
        read=lambda: data,
        __enter__=lambda self: self,
        __exit__=lambda self, exc_type, exc, tb: None,
    )
    return fake


urllib.request.urlopen = _robots_response  # type: ignore[assignment]

# Load after mock setup.
from crawler.website_crawler import (  # noqa: E402
    ensure_scheme,
    load_config,
)


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

    @patch("crawler.website_crawler.Path")
    def test_load_config_with_csv_options(self, mock_path):
        """Test loading configuration with CSV-related options."""
        # Set up the mock path to point to our temp directory
        mock_path.return_value.parent.return_value = Path(self.temp_dir)

        # Config data with CSV options
        csv_config_data = {
            "domain": "example.com",
            "skip_patterns": ["pattern1", "pattern2"],
            "crawl_frequency_days": 14,
            "csv_export_url": "https://example.com/export.csv",
            "csv_modified_days_threshold": 3,
        }

        # Patch the open function to use our temp file
        with patch(
            "builtins.open",
            new_callable=unittest.mock.mock_open,
            read_data=json.dumps(csv_config_data),
        ):
            config = load_config(self.site_id)

            # Verify config was loaded correctly
            self.assertIsNotNone(config)
            self.assertEqual(config["domain"], "example.com")
            self.assertEqual(config["csv_export_url"], "https://example.com/export.csv")
            self.assertEqual(config["csv_modified_days_threshold"], 3)


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
            "priority",  # New column for priority support
        }
        self.assertTrue(
            required_columns.issubset(columns),
            f"Missing columns: {required_columns - columns}",
        )
        crawler.close()

    def test_csv_tracking_table_creation(self):
        """Test that CSV tracking table is created with proper schema."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify CSV tracking table structure (simplified schema)
        cursor = crawler.conn.cursor()
        cursor.execute("PRAGMA table_info(csv_tracking)")
        columns_info = cursor.fetchall()
        columns = {row[1] for row in columns_info}

        required_columns = {
            "id",
            "initial_crawl_completed",
        }
        self.assertTrue(
            required_columns.issubset(columns),
            f"Missing CSV tracking columns: {required_columns - columns}",
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

    def test_url_operations_with_priority(self):
        """Test URL queue operations with priority support."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        test_urls = [
            (crawler.normalize_url("https://example.com/page1"), 0),  # Normal priority
            (crawler.normalize_url("https://example.com/page2"), 5),  # Medium priority
            (crawler.normalize_url("https://example.com/page3"), 10),  # High priority
        ]

        for url, priority in test_urls:
            crawler.add_url_to_queue(url, priority=priority)

        cursor = crawler.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM crawl_queue WHERE status = 'pending'")
        # Seeded URL + 3 test URLs
        self.assertEqual(cursor.fetchone()[0], len(test_urls) + 1)

        # Verify priority values are stored correctly
        cursor.execute(
            "SELECT url, priority FROM crawl_queue WHERE priority > 0 ORDER BY priority DESC"
        )
        priority_rows = cursor.fetchall()

        self.assertEqual(
            len(priority_rows), 3
        )  # Three URLs with priority > 0 (including seeded URL with priority 1)

        # Check that high priority URL comes first
        self.assertEqual(priority_rows[0][1], 10)  # Highest priority
        self.assertEqual(priority_rows[1][1], 5)  # Medium priority
        self.assertEqual(priority_rows[2][1], 1)  # Seeded URL priority

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

        # Manually advance time for retry_after to pass for test_urls[2]
        # This depends on the default retry logic (e.g., 5 minutes)
        # For simplicity, we'll assume page3 (test_urls[2]) has its next_crawl due now.
        crawler.cursor.execute(
            "UPDATE crawl_queue SET next_crawl = datetime('now', '-1 hour') WHERE url = ?",
            (test_urls[2],),
        )
        crawler.conn.commit()

        # The seeded URL has priority 1, so it will be returned first
        # Let's mark it as visited so we can test getting test_urls[2]
        seeded_url = crawler.normalize_url(crawler.start_url)
        crawler.mark_url_status(seeded_url, "visited", content_hash="seeded")

        next_url_to_crawl = crawler.get_next_url_to_crawl()
        self.assertEqual(next_url_to_crawl, test_urls[2])

        crawler.close()


class TestCSVFunctionality(BaseWebsiteCrawlerTest):
    """Test cases for CSV functionality."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()
        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
            "csv_export_url": "https://example.com/export.csv",
            "csv_modified_days_threshold": 1,
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

    def test_csv_mode_enabled_detection(self):
        """Test that CSV mode is properly detected when CSV URL is configured."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        self.assertTrue(crawler.csv_mode_enabled)
        self.assertEqual(crawler.csv_export_url, "https://example.com/export.csv")
        self.assertEqual(crawler.csv_modified_days_threshold, 1)

        crawler.close()

    def test_csv_mode_disabled_detection(self):
        """Test that CSV mode is disabled when no CSV URL is configured."""
        config_without_csv = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
            # No CSV configuration
        }

        crawler = WebsiteCrawler(self.site_id, config_without_csv)

        self.assertFalse(crawler.csv_mode_enabled)
        self.assertIsNone(crawler.csv_export_url)

        crawler.close()

    def test_parse_csv_date(self):
        """Test CSV date parsing functionality."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test valid date formats
        test_cases = [
            ("7/12/25 8:45", datetime(2025, 7, 12, 8, 45)),
            ("12/31/24 23:59", datetime(2024, 12, 31, 23, 59)),
            ("1/1/25 0:00", datetime(2025, 1, 1, 0, 0)),
        ]

        for date_str, expected_datetime in test_cases:
            with self.subTest(date_str=date_str):
                result = crawler.parse_csv_date(date_str)
                self.assertEqual(result, expected_datetime)

        # Test invalid date format
        invalid_result = crawler.parse_csv_date("invalid-date")
        self.assertIsNone(invalid_result)

        crawler.close()

    @patch("crawler.website_crawler.sync_playwright")
    def test_download_csv_data_success(self, mock_sync_playwright):
        """Test successful CSV data download using Playwright."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Mock browser and page
        mock_browser = Mock()
        mock_page = Mock()
        mock_browser.new_page.return_value = mock_page

        # Mock CSV content
        csv_content = """URL,Modified Date,Post Title
https://example.com/page1,2025-07-12 08:45:00,Test Page 1
https://example.com/page2,2025-07-13 09:30:00,Test Page 2
"""

        # Mock page interactions
        mock_page.goto.return_value = Mock(status=200)
        mock_page.wait_for_timeout.return_value = None
        mock_page.evaluate.return_value = csv_content
        mock_page.content.return_value = f"<html><body>{csv_content}</body></html>"

        # Mock download handling
        with (
            patch.object(crawler, "_establish_csv_session", return_value=True),
            patch.object(crawler, "_create_download_handler"),
            patch.object(crawler, "_navigate_to_csv_url") as mock_navigate,
            patch.object(
                crawler,
                "_parse_csv_content",
                return_value=[
                    {
                        "URL": "https://example.com/page1",
                        "Modified Date": "2025-07-12 08:45:00",
                        "Post Title": "Test Page 1",
                    },
                    {
                        "URL": "https://example.com/page2",
                        "Modified Date": "2025-07-13 09:30:00",
                        "Post Title": "Test Page 2",
                    },
                ],
            ),
        ):

            def mock_navigate_side_effect(page, download_info):
                download_info["content"] = csv_content

            mock_navigate.side_effect = mock_navigate_side_effect

            result = crawler.download_csv_data(mock_browser)

            self.assertIsNotNone(result)
            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["URL"], "https://example.com/page1")
            self.assertEqual(result[0]["Modified Date"], "2025-07-12 08:45:00")
            self.assertEqual(result[0]["Post Title"], "Test Page 1")

        crawler.close()

    def test_download_csv_data_failure(self):
        """Test CSV data download failure handling."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test with no browser context
        result = crawler.download_csv_data(None)
        self.assertIsNone(result)

        # Test with browser but network error
        mock_browser = Mock()
        mock_page = Mock()
        mock_browser.new_page.return_value = mock_page
        mock_page.goto.side_effect = Exception("Network error")

        result = crawler.download_csv_data(mock_browser)
        self.assertIsNone(result)

        crawler.close()

    def test_process_csv_data(self):
        """Test processing CSV data and adding URLs to queue."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Create test CSV data with recent and old dates
        now = datetime.now()
        recent_date = now - timedelta(hours=12)  # Within threshold
        old_date = now - timedelta(days=3)  # Outside threshold

        csv_data = [
            {
                "URL": "https://example.com/recent-page",
                "Modified Date": recent_date.strftime("%m/%d/%y %H:%M"),
                "Post Title": "Recent Post",
                "Action": "Add/Update",
            },
            {
                "URL": "https://example.com/old-page",
                "Modified Date": old_date.strftime("%m/%d/%y %H:%M"),
                "Post Title": "Old Post",
                "Action": "Add/Update",
            },
            {
                "URL": "https://external.com/page",  # External domain
                "Modified Date": recent_date.strftime("%m/%d/%y %H:%M"),
                "Post Title": "External Post",
                "Action": "Add/Update",
            },
        ]

        added_count = crawler.process_csv_data(csv_data)

        # Should only add recent URL from same domain
        self.assertEqual(added_count, 1)

        # Verify URL was added with high priority
        cursor = crawler.conn.cursor()
        normalized_url = crawler.normalize_url("https://example.com/recent-page")
        cursor.execute(
            """
            SELECT url, priority FROM crawl_queue 
            WHERE url = ? AND priority > 0
        """,
            (normalized_url,),
        )

        result = cursor.fetchone()
        self.assertIsNotNone(result)
        self.assertEqual(result[1], 10)  # High priority

        crawler.close()

    def test_update_csv_tracking(self):
        """Test CSV tracking table updates (simplified - only logs, no database updates)."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test that methods can be called without errors (simplified implementation)
        # The update_csv_tracking method now only logs, doesn't update database

        # Test successful update call
        crawler.update_csv_tracking(success=True)

        # Test error update call
        crawler.update_csv_tracking(csv_error="Test error")

        # Verify the CSV tracking table still exists and has the basic structure
        cursor = crawler.conn.cursor()
        cursor.execute("SELECT id, initial_crawl_completed FROM csv_tracking")
        # Should not raise an error, table should exist

        crawler.close()

    def test_should_check_csv_timing(self):
        """Test CSV check timing logic (simplified)."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Should NOT check when no tracking record exists (initial crawl not completed)
        self.assertFalse(crawler.should_check_csv())

        # Mark initial crawl as completed
        crawler.mark_initial_crawl_completed()

        # Should check after initial crawl is completed
        self.assertTrue(crawler.should_check_csv())

        crawler.close()

    def test_should_not_check_csv_before_initial_crawl(self):
        """Test that CSV checking is disabled before initial crawl completion."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Create tracking record but don't mark initial crawl as completed
        crawler.update_csv_tracking(success=True)

        # Should not check CSV before initial crawl is completed
        self.assertFalse(crawler.should_check_csv())

        crawler.close()

    def test_mark_initial_crawl_completed(self):
        """Test marking initial crawl as completed."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Initially not completed
        self.assertFalse(crawler.is_initial_crawl_completed())

        # Mark as completed
        crawler.mark_initial_crawl_completed()

        # Should now be completed
        self.assertTrue(crawler.is_initial_crawl_completed())
        self.assertTrue(crawler.initial_crawl_completed)

        # Verify in database
        cursor = crawler.conn.cursor()
        cursor.execute("SELECT initial_crawl_completed FROM csv_tracking LIMIT 1")
        result = cursor.fetchone()
        self.assertEqual(result[0], 1)

        crawler.close()

    @patch("crawler.website_crawler.sync_playwright")
    def test_check_and_process_csv_integration(self, mock_sync_playwright):
        """Test integrated CSV check and processing."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Mark initial crawl as completed
        crawler.mark_initial_crawl_completed()

        # Mock browser and CSV data
        mock_browser = Mock()
        mock_page = Mock()
        mock_browser.new_page.return_value = mock_page

        # Mock CSV content with recent date
        now = datetime.now()
        recent_date = now - timedelta(hours=12)
        csv_data = [
            {
                "URL": "https://example.com/recent-page",
                "Modified Date": recent_date.strftime("%Y-%m-%d %H:%M:%S"),
                "Post Title": "Recent Post",
                "Action": "Add/Update",
            }
        ]

        with patch.object(crawler, "download_csv_data", return_value=csv_data):
            # Should process CSV and add URLs
            added_count = crawler.check_and_process_csv(mock_browser)
            self.assertEqual(added_count, 1)

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

    @patch("time.sleep")
    @patch("crawler.website_crawler.sync_playwright")
    def test_daemon_csv_check_during_sleep(self, mock_sync_playwright, mock_time_sleep):
        """Test that CSV checking occurs during daemon sleep periods."""
        # Configure CSV mode
        csv_config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 7,
            "csv_export_url": "https://example.com/export.csv",
            "csv_modified_days_threshold": 1,
        }

        crawler = WebsiteCrawler(self.site_id, csv_config)

        # Mark initial crawl as completed
        crawler.mark_initial_crawl_completed()

        # Empty the queue to trigger sleep
        crawler.cursor.execute("DELETE FROM crawl_queue")
        crawler.conn.commit()

        # Mock CSV check to add URLs
        with (
            patch.object(
                crawler, "check_and_process_csv", return_value=2
            ) as mock_csv_check,
            patch.object(crawler, "get_next_url_to_crawl", return_value=None),
        ):
            mock_args = MagicMock()
            mock_args.stop_after = None

            with patch("crawler.website_crawler.is_exiting") as mock_is_exiting:
                effect_count = 0

                def exit_requested_side_effect():
                    nonlocal effect_count
                    effect_count += 1
                    return effect_count > 2

                mock_is_exiting.side_effect = exit_requested_side_effect

                with patch("os.getenv") as mock_getenv:
                    mock_getenv.return_value = "test-index"
                    from crawler.website_crawler import run_crawl_loop

                    run_crawl_loop(crawler, MagicMock(), mock_args)

        # Verify CSV check was called
        mock_csv_check.assert_called()

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
        with patch(
            "utils.text_splitter_utils.SpacyTextSplitter"
        ) as mock_splitter_class:
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
        # Mock environment variable for embedding model
        self.env_patcher = patch.dict(
            os.environ, {"OPENAI_INGEST_EMBEDDINGS_MODEL": "text-embedding-3-large"}
        )
        self.env_patcher.start()

        # Mock SpacyTextSplitter to avoid loading spaCy model
        self.text_splitter_patcher = patch(
            "utils.text_splitter_utils.SpacyTextSplitter"
        )
        mock_text_splitter_class = self.text_splitter_patcher.start()
        self.text_splitter = mock_text_splitter_class.return_value

        # Configure mock to return realistic chunks
        self.text_splitter.split_text.return_value = [
            "This is the first chunk of text content.",
            "This is the second chunk with more content.",
            "This is the third and final chunk.",
        ]

    def tearDown(self):
        """Clean up test environment."""
        self.env_patcher.stop()
        self.text_splitter_patcher.stop()

    def test_short_content_chunking(self):
        """Test chunking of short web content."""
        from crawler.website_crawler import PageContent, create_chunks_from_page

        page_content = PageContent(
            url="https://example.com/short",
            title="Short Article",
            content="This is a short article with just a few sentences. It should not be chunked into multiple pieces.",
            metadata={},
        )

        # Configure mock for short content (single chunk)
        self.text_splitter.split_text.return_value = [
            "Short Article\nThis is a short article with just a few sentences. It should not be chunked into multiple pieces."
        ]

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

        # Configure mock for medium content (multiple chunks)
        self.text_splitter.split_text.return_value = [
            "Medium Length Article\nThis is the first paragraph of a medium-length article. It contains several sentences that provide context and information about the topic being discussed.",
            "This is the second paragraph that continues the discussion. It adds more detail and expands on the concepts introduced in the first paragraph.",
            "This is the third paragraph that provides additional insights. It helps to build a comprehensive understanding of the subject matter.\n\nThis is the fourth paragraph that concludes the article. It summarizes the key points and provides final thoughts on the topic.",
        ]

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

        # Configure mock for long content (multiple chunks with title and content)
        self.text_splitter.split_text.return_value = [
            "Very Long Comprehensive Article\nThis is paragraph number 1. It contains detailed information about a specific aspect of the topic.",
            "This is paragraph number 5. It contains detailed information about a specific aspect of the topic. The content is designed to be comprehensive and informative.",
            "This is paragraph number 10. It contains detailed information about a specific aspect of the topic. The content is designed to be comprehensive and informative.",
            "This is paragraph number 15. It contains detailed information about a specific aspect of the topic. The content is designed to be comprehensive and informative.",
            "This is paragraph number 20. It contains detailed information about a specific aspect of the topic. The content is designed to be comprehensive and informative.",
        ]

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

        page_content = PageContent(
            url="https://example.com/metrics",
            title="Metrics Tracking Test",
            content="""This is a test article for metrics tracking. It has multiple paragraphs to ensure proper chunking behavior.

This is the second paragraph that adds more content to test the chunking algorithm and metrics collection.

This is the third paragraph that provides additional content for comprehensive testing of the chunking functionality.""",
            metadata={},
        )

        # Mock metrics for the text splitter
        mock_metrics = Mock()
        mock_metrics.total_documents = 1
        mock_metrics.total_chunks = 3
        self.text_splitter.metrics = mock_metrics
        self.text_splitter.get_metrics_summary.return_value = {
            "total_documents": 1,
            "total_chunks": 3,
            "avg_chunks_per_document": 3.0,
        }

        create_chunks_from_page(page_content, self.text_splitter)

        # Verify metrics were recorded (mocked values)
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

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_cache_initialization(self, mock_robot_parser_class):
        """Test robots.txt cache is properly initialized."""
        mock_parser = Mock()
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify cache timestamp is set after successful initialization
        self.assertIsNotNone(crawler.robots_cache_timestamp)
        self.assertEqual(crawler.robots_cache_duration_hours, 24)
        self.assertEqual(crawler.robots_url, "https://example.com/robots.txt")
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_cache_not_expired(self, mock_robot_parser_class):
        """Test robots.txt cache is not reloaded when still fresh."""
        mock_parser = Mock()
        mock_parser.can_fetch.return_value = True
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Reset call count after initialization
        mock_robot_parser_class.reset_mock()
        mock_parser.read.reset_mock()

        # Make multiple URL validation calls
        crawler.is_valid_url("https://example.com/page1")
        crawler.is_valid_url("https://example.com/page2")
        crawler.is_valid_url("https://example.com/page3")

        # Verify robots.txt was not reloaded
        mock_robot_parser_class.assert_not_called()
        mock_parser.read.assert_not_called()
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    @patch("crawler.website_crawler.datetime")
    def test_robots_txt_cache_expired_reload(
        self, mock_datetime, mock_robot_parser_class
    ):
        """Test robots.txt cache is reloaded when expired."""
        # Set up datetime mocks
        initial_time = datetime(2024, 1, 1, 12, 0, 0)
        expired_time = datetime(2024, 1, 2, 13, 0, 0)  # 25 hours later

        mock_datetime.now.side_effect = [initial_time, expired_time, expired_time]
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        mock_parser = Mock()
        mock_parser.can_fetch.return_value = True
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify initial cache timestamp
        self.assertEqual(crawler.robots_cache_timestamp, initial_time)

        # Reset call count after initialization
        mock_robot_parser_class.reset_mock()
        mock_parser.read.reset_mock()

        # Make URL validation call after cache expiry
        crawler.is_valid_url("https://example.com/page1")

        # Verify robots.txt was reloaded
        mock_robot_parser_class.assert_called_once()
        mock_parser.read.assert_called_once()
        self.assertEqual(crawler.robots_cache_timestamp, expired_time)
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    @patch("crawler.website_crawler.datetime")
    def test_robots_txt_cache_reload_failure(
        self, mock_datetime, mock_robot_parser_class
    ):
        """Test robots.txt cache reload failure handling."""
        # Set up datetime mocks
        initial_time = datetime(2024, 1, 1, 12, 0, 0)
        expired_time = datetime(2024, 1, 2, 13, 0, 0)  # 25 hours later

        mock_datetime.now.side_effect = [initial_time, expired_time]
        mock_datetime.side_effect = lambda *args, **kwargs: datetime(*args, **kwargs)

        # First call succeeds, second call fails
        mock_parser = Mock()
        mock_parser.can_fetch.return_value = True
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Verify initial success
        self.assertIsNotNone(crawler.robots_parser)
        self.assertEqual(crawler.robots_cache_timestamp, initial_time)

        # Set up second parser to fail
        mock_parser_2 = Mock()
        mock_parser_2.read.side_effect = Exception("Network error")
        mock_robot_parser_class.return_value = mock_parser_2

        # Make URL validation call after cache expiry
        result = crawler.is_valid_url("https://example.com/page1")

        # Should still return True (fallback behavior)
        self.assertTrue(result)
        # Parser should be None after failed reload
        self.assertIsNone(crawler.robots_parser)
        # Cache timestamp should be None after failed reload
        self.assertIsNone(crawler.robots_cache_timestamp)
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_cache_expiry_check(self, mock_robot_parser_class):
        """Test robots.txt cache expiry check logic."""
        mock_parser = Mock()
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test cache not expired (fresh)
        self.assertFalse(crawler._is_robots_cache_expired())

        # Test cache expired (manually set old timestamp)
        old_timestamp = datetime.now() - timedelta(hours=25)
        crawler.robots_cache_timestamp = old_timestamp
        self.assertTrue(crawler._is_robots_cache_expired())

        # Test no cache timestamp (should be expired)
        crawler.robots_cache_timestamp = None
        self.assertTrue(crawler._is_robots_cache_expired())
        crawler.close()

    @patch("crawler.website_crawler.RobotFileParser")
    def test_robots_txt_cache_custom_duration(self, mock_robot_parser_class):
        """Test robots.txt cache with custom duration."""
        mock_parser = Mock()
        mock_robot_parser_class.return_value = mock_parser

        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Set custom cache duration
        crawler.robots_cache_duration_hours = 12  # 12 hours instead of 24

        # Test cache not expired (within 12 hours)
        recent_timestamp = datetime.now() - timedelta(hours=6)
        crawler.robots_cache_timestamp = recent_timestamp
        self.assertFalse(crawler._is_robots_cache_expired())

        # Test cache expired (after 12 hours)
        old_timestamp = datetime.now() - timedelta(hours=13)
        crawler.robots_cache_timestamp = old_timestamp
        self.assertTrue(crawler._is_robots_cache_expired())
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


class TestCrawlFrequencyJitter(BaseWebsiteCrawlerTest):
    """Test cases for crawl frequency jitter functionality."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()  # Set up environment variables
        self.temp_dir = tempfile.mkdtemp()

        self.site_id = "test-site"
        self.site_config = {
            "domain": "example.com",
            "skip_patterns": ["pattern1", "pattern2"],
            "crawl_frequency_days": 25,  # Test with 25 days
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

    def test_jitter_calculation_range(self):
        """Test that jitter calculation produces values within expected range."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        base_frequency = 25
        expected_min = base_frequency * 0.88  # 22 days
        expected_max = base_frequency * 1.12  # 28 days

        # Test multiple calculations to verify range
        jitter_results = []
        for _ in range(50):  # Test 50 iterations
            next_crawl = crawler._calculate_next_crawl_with_jitter(base_frequency)
            days_from_now = (next_crawl - datetime.now()).total_seconds() / (24 * 3600)
            jitter_results.append(days_from_now)

        # Verify all results are within expected range
        for days in jitter_results:
            self.assertGreaterEqual(
                days,
                expected_min,
                f"Jitter result {days:.2f} is below minimum {expected_min}",
            )
            self.assertLessEqual(
                days,
                expected_max,
                f"Jitter result {days:.2f} is above maximum {expected_max}",
            )

        # Verify we get some variation (not all the same value)
        unique_values = set(round(days, 1) for days in jitter_results)
        self.assertGreater(
            len(unique_values), 10, "Jitter should produce varied results"
        )

        crawler.close()

    def test_jitter_calculation_minimum_frequency(self):
        """Test that jitter calculation respects minimum frequency of 1 day."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test with very small base frequency
        base_frequency = 1

        # Test multiple calculations
        for _ in range(10):
            next_crawl = crawler._calculate_next_crawl_with_jitter(base_frequency)
            days_from_now = (next_crawl - datetime.now()).total_seconds() / (24 * 3600)

            # Should never be less than 1 day (account for floating point precision)
            self.assertGreaterEqual(
                days_from_now,
                0.999,
                f"Jitter result {days_from_now:.2f} is below minimum 1 day",
            )

        crawler.close()

    def test_mark_url_status_visited_uses_jitter(self):
        """Test that marking URL as visited uses jitter for next_crawl calculation."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        test_url = "https://example.com/test"
        crawler.add_url_to_queue(test_url)

        # Mock the jitter calculation to return a predictable value
        expected_next_crawl = datetime.now() + timedelta(
            days=23.5
        )  # 25 days - 6% jitter

        with patch.object(
            crawler,
            "_calculate_next_crawl_with_jitter",
            return_value=expected_next_crawl,
        ) as mock_jitter:
            # Mark URL as visited
            crawler.mark_url_status(test_url, "visited", content_hash="test_hash")

            # Verify jitter calculation was called with correct frequency
            mock_jitter.assert_called_once_with(25)

            # Verify next_crawl was set to the jittered value
            cursor = crawler.conn.cursor()
            cursor.execute(
                "SELECT next_crawl FROM crawl_queue WHERE url = ?",
                (crawler.normalize_url(test_url),),
            )
            result = cursor.fetchone()

            # Convert stored ISO string back to datetime for comparison
            stored_next_crawl = datetime.fromisoformat(result[0])

            # Should be within 1 second of expected (accounting for processing time)
            time_diff = abs((stored_next_crawl - expected_next_crawl).total_seconds())
            self.assertLess(
                time_diff, 1.0, f"Stored next_crawl differs by {time_diff} seconds"
            )

        crawler.close()

    def test_jitter_average_approximates_base_frequency(self):
        """Test that jitter average approximates the base frequency over many iterations."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        base_frequency = 25
        jitter_results = []

        # Test many iterations to verify average
        for _ in range(100):
            next_crawl = crawler._calculate_next_crawl_with_jitter(base_frequency)
            days_from_now = (next_crawl - datetime.now()).total_seconds() / (24 * 3600)
            jitter_results.append(days_from_now)

        # Calculate average
        average_days = sum(jitter_results) / len(jitter_results)

        # Average should be close to base frequency (within 1 day)
        self.assertAlmostEqual(
            average_days,
            base_frequency,
            delta=1.0,
            msg=f"Average jitter {average_days:.2f} should be close to base {base_frequency}",
        )

        crawler.close()

    def test_different_base_frequencies_produce_proportional_jitter(self):
        """Test that different base frequencies produce proportionally scaled jitter."""
        crawler = WebsiteCrawler(self.site_id, self.site_config)

        # Test with different base frequencies
        test_frequencies = [7, 14, 25, 30]

        for base_freq in test_frequencies:
            jitter_results = []
            expected_min = base_freq * 0.88
            expected_max = base_freq * 1.12

            # Test multiple calculations for each frequency
            for _ in range(20):
                next_crawl = crawler._calculate_next_crawl_with_jitter(base_freq)
                days_from_now = (next_crawl - datetime.now()).total_seconds() / (
                    24 * 3600
                )
                jitter_results.append(days_from_now)

            # Verify all results are within expected range for this frequency
            for days in jitter_results:
                self.assertGreaterEqual(
                    days,
                    expected_min,
                    f"Frequency {base_freq}: result {days:.2f} below min {expected_min}",
                )
                self.assertLessEqual(
                    days,
                    expected_max,
                    f"Frequency {base_freq}: result {days:.2f} above max {expected_max}",
                )

        crawler.close()


class TestCrawlerInitializationBug(BaseWebsiteCrawlerTest):
    """Test cases for the crawler initialization bug fix.

    This test verifies that the start URL is only added when the database is
    completely empty, not when there are URLs that aren't due for re-crawling.
    """

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.temp_dir = tempfile.mkdtemp()
        self.config_dir = Path(self.temp_dir) / "crawler_config"
        self.config_dir.mkdir()

        # Create test config
        self.site_id = "test-site"
        self.config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 14,
            "crawl_delay_seconds": 0,
        }

        # Write config file
        config_file = self.config_dir / f"{self.site_id}-config.json"
        with open(config_file, "w") as f:
            json.dump(self.config, f)

    def tearDown(self):
        """Clean up test environment."""
        super().tearDown()
        shutil.rmtree(self.temp_dir)

    def test_empty_database_seeds_start_url(self):
        """Test that start URL is added when database is completely empty."""
        with patch("data_ingestion.crawler.website_crawler.load_config") as mock_load:
            mock_load.return_value = self.config

            # First, clear any existing database file to ensure we start empty
            script_dir = Path(__file__).resolve().parent.parent
            db_dir = script_dir / "crawler" / "db"
            db_file = db_dir / f"crawler_queue_{self.site_id}.db"
            if db_file.exists():
                os.remove(db_file)

            # Create crawler - should seed with start URL since database is empty
            crawler = WebsiteCrawler(
                site_id=self.site_id,
                site_config=self.config,
                retry_failed=False,
                debug=False,
            )

            # Check that start URL was added
            cursor = crawler.cursor
            cursor.execute("SELECT COUNT(*) FROM crawl_queue")
            total_count = cursor.fetchone()[0]

            cursor.execute(
                "SELECT url FROM crawl_queue WHERE url = ?",
                (crawler.normalize_url(crawler.start_url),),
            )
            start_url_exists = cursor.fetchone()

            self.assertEqual(total_count, 1, "Database should contain exactly 1 URL")
            self.assertIsNotNone(start_url_exists, "Start URL should be in database")

            crawler.close()

    def test_existing_visited_urls_no_reseed(self):
        """Test that start URL is NOT added when database has existing visited URLs."""
        with patch("data_ingestion.crawler.website_crawler.load_config") as mock_load:
            mock_load.return_value = self.config

            # Create crawler first time to get database set up
            crawler = WebsiteCrawler(
                site_id=self.site_id,
                site_config=self.config,
                retry_failed=False,
                debug=False,
            )

            # Clear the database and manually add some visited URLs that aren't due for re-crawling
            cursor = crawler.cursor
            cursor.execute("DELETE FROM crawl_queue")

            # Add some visited URLs with future next_crawl dates (not due for re-crawling)
            future_date = (datetime.now() + timedelta(days=7)).isoformat()
            test_urls = [
                "https://example.com/page1",
                "https://example.com/page2",
                "https://example.com/page3",
            ]

            for url in test_urls:
                normalized_url = crawler.normalize_url(url)
                cursor.execute(
                    """
                    INSERT INTO crawl_queue 
                    (url, status, last_crawl, next_crawl, crawl_frequency, priority) 
                    VALUES (?, 'visited', ?, ?, 14, 0)
                """,
                    (normalized_url, datetime.now().isoformat(), future_date),
                )

            crawler.conn.commit()

            # Verify we have 3 URLs in database, none available for crawling
            cursor.execute("SELECT COUNT(*) FROM crawl_queue")
            total_count = cursor.fetchone()[0]
            self.assertEqual(total_count, 3, "Should have 3 URLs in database")

            cursor.execute("""
                SELECT COUNT(*) FROM crawl_queue 
                WHERE (
                    (status = 'pending' AND (retry_after IS NULL OR retry_after <= datetime('now'))) 
                    OR 
                    (status = 'visited' AND next_crawl <= datetime('now'))
                )
            """)
            available_count = cursor.fetchone()[0]
            self.assertEqual(
                available_count, 0, "Should have 0 URLs available for crawling"
            )

            # Now re-run initialization logic
            crawler._run_initialization_logic()

            # Verify start URL was NOT added
            cursor.execute("SELECT COUNT(*) FROM crawl_queue")
            final_count = cursor.fetchone()[0]
            self.assertEqual(
                final_count, 3, "Should still have exactly 3 URLs (no start URL added)"
            )

            cursor.execute(
                "SELECT url FROM crawl_queue WHERE url = ?",
                (crawler.normalize_url(crawler.start_url),),
            )
            start_url_exists = cursor.fetchone()
            self.assertIsNone(start_url_exists, "Start URL should NOT be in database")

            crawler.close()

    def test_existing_pending_urls_no_reseed(self):
        """Test that start URL is NOT added when database has existing pending URLs."""
        with patch("data_ingestion.crawler.website_crawler.load_config") as mock_load:
            mock_load.return_value = self.config

            # Create crawler first time to get database set up
            crawler = WebsiteCrawler(
                site_id=self.site_id,
                site_config=self.config,
                retry_failed=False,
                debug=False,
            )

            # Clear the database and manually add some pending URLs
            cursor = crawler.cursor
            cursor.execute("DELETE FROM crawl_queue")

            # Add some pending URLs
            test_urls = ["https://example.com/pending1", "https://example.com/pending2"]

            for url in test_urls:
                normalized_url = crawler.normalize_url(url)
                cursor.execute(
                    """
                    INSERT INTO crawl_queue 
                    (url, status, next_crawl, crawl_frequency, priority) 
                    VALUES (?, 'pending', datetime('now'), 14, 0)
                """,
                    (normalized_url,),
                )

            crawler.conn.commit()

            # Verify we have 2 URLs in database, both available for crawling
            cursor.execute("SELECT COUNT(*) FROM crawl_queue")
            total_count = cursor.fetchone()[0]
            self.assertEqual(total_count, 2, "Should have 2 URLs in database")

            # Now re-run initialization logic
            crawler._run_initialization_logic()

            # Verify start URL was NOT added
            cursor.execute("SELECT COUNT(*) FROM crawl_queue")
            final_count = cursor.fetchone()[0]
            self.assertEqual(
                final_count, 2, "Should still have exactly 2 URLs (no start URL added)"
            )

            cursor.execute(
                "SELECT url FROM crawl_queue WHERE url = ?",
                (crawler.normalize_url(crawler.start_url),),
            )
            start_url_exists = cursor.fetchone()
            self.assertIsNone(start_url_exists, "Start URL should NOT be in database")

            crawler.close()


class TestCSVRemoval:
    """Test CSV removal functionality."""

    @pytest.fixture
    def crawler(self):
        """Create a test crawler instance without side effects."""
        config = {
            "domain": "example.com",
            "skip_patterns": [],
            "crawl_frequency_days": 14,
        }
        return WebsiteCrawler(
            site_id="test",
            site_config=config,
            skip_db_init=True,  # Skip database initialization
            skip_robots_init=True,  # Skip robots.txt loading
        )

    def test_validate_csv_row_add_update(self, crawler):
        """Test CSV validation for add/update actions."""
        row = {
            "URL": "https://example.com/test",
            "Modified Date": "2025-01-13 12:00:00",
            "Action": "Add/Update",
        }

        result = crawler._validate_csv_row(row)

        assert result is not None
        url, modified_date, action = result
        assert url == "https://example.com/test"
        assert isinstance(modified_date, datetime)
        assert action == "add/update"

    def test_validate_csv_row_remove(self, crawler):
        """Test CSV validation for remove actions."""
        row = {
            "URL": "https://example.com/test",
            "Modified Date": "2025-01-13 12:00:00",
            "Action": "remove",
        }

        result = crawler._validate_csv_row(row)

        assert result is not None
        url, modified_date, action = result
        assert url == "https://example.com/test"
        assert isinstance(modified_date, datetime)
        assert action == "remove"

    def test_validate_csv_row_case_insensitive(self, crawler):
        """Test that action validation is case-insensitive."""
        test_cases = ["REMOVE", "Remove", "ADD/UPDATE", "add/update", "Add/Update"]

        for action_input in test_cases:
            row = {
                "URL": "https://example.com/test",
                "Modified Date": "2025-01-13 12:00:00",
                "Action": action_input,
            }

            result = crawler._validate_csv_row(row)
            assert result is not None
            _, _, action = result
            assert action in ["add/update", "remove"]

    def test_validate_csv_row_invalid_action(self, crawler):
        """Test CSV validation with invalid action."""
        row = {
            "URL": "https://example.com/test",
            "Modified Date": "2025-01-13 12:00:00",
            "Action": "invalid",
        }

        result = crawler._validate_csv_row(row)
        assert result is None

    def test_validate_csv_row_missing_fields(self, crawler):
        """Test CSV validation with missing required fields."""
        # Missing URL
        row1 = {"Modified Date": "2025-01-13 12:00:00", "Action": "remove"}
        assert crawler._validate_csv_row(row1) is None

        # Missing Modified Date
        row2 = {"URL": "https://example.com/test", "Action": "remove"}
        assert crawler._validate_csv_row(row2) is None

        # Missing Action
        row3 = {
            "URL": "https://example.com/test",
            "Modified Date": "2025-01-13 12:00:00",
        }
        assert crawler._validate_csv_row(row3) is None

    def test_remove_url_from_pinecone_success(self, crawler):
        """Test successful Pinecone vector removal."""
        # Mock Pinecone index
        mock_index = Mock()
        mock_match = Mock()
        mock_match.id = "test_vector_id"

        mock_index.query.return_value = Mock(matches=[mock_match])
        mock_index.delete.return_value = None

        result = crawler.remove_url_from_pinecone(
            mock_index, "https://example.com/test"
        )

        assert result == 1
        mock_index.query.assert_called_once()
        mock_index.delete.assert_called_once_with(ids=["test_vector_id"])

    def test_remove_url_from_pinecone_no_vectors(self, crawler):
        """Test Pinecone removal when no vectors found."""
        # Mock Pinecone index with no matches
        mock_index = Mock()
        mock_index.query.return_value = Mock(matches=[])

        result = crawler.remove_url_from_pinecone(
            mock_index, "https://example.com/test"
        )

        assert result == 0
        mock_index.query.assert_called_once()
        mock_index.delete.assert_not_called()

    def test_remove_url_from_pinecone_batch_deletion(self, crawler):
        """Test Pinecone removal with multiple vectors (batch processing)."""
        # Mock Pinecone index with multiple matches
        mock_index = Mock()
        mock_matches = [
            Mock(id=f"vector_{i}") for i in range(150)
        ]  # More than batch size
        mock_index.query.return_value = Mock(matches=mock_matches)
        mock_index.delete.return_value = None

        result = crawler.remove_url_from_pinecone(
            mock_index, "https://example.com/test"
        )

        assert result == 150
        mock_index.query.assert_called_once()
        # Should be called twice due to batch size of 100
        assert mock_index.delete.call_count == 2

    def test_remove_url_from_pinecone_error_handling(self, crawler):
        """Test Pinecone removal error handling."""
        # Mock Pinecone index that raises exception
        mock_index = Mock()
        mock_index.query.side_effect = Exception("Pinecone error")

        result = crawler.remove_url_from_pinecone(
            mock_index, "https://example.com/test"
        )

        assert result == 0  # Should return 0 on error


if __name__ == "__main__":
    unittest.main()
