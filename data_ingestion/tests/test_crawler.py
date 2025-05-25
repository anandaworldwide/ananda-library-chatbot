#!/usr/bin/env python
"""Unit tests for the website crawler functionality."""

import json
import shutil
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

# Import the crawler module
sys.path.insert(0, str(Path(__file__).parent.parent))
from crawler.website_crawler import WebsiteCrawler, ensure_scheme, load_config


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


class TestSQLiteIntegration(unittest.TestCase):
    """Test cases for SQLite database integration."""

    def setUp(self):
        """Set up test environment."""
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


class TestChangeDetection(unittest.TestCase):
    """Test cases for content change detection."""

    def setUp(self):
        """Set up test environment."""
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


class TestFailureHandling(unittest.TestCase):
    """Test cases for handling of failed URLs and retry logic."""

    def setUp(self):
        """Set up test environment."""
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


class TestDaemonBehavior(unittest.TestCase):
    """Test cases for daemon loop behavior."""

    def setUp(self):
        """Set up test environment."""
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


if __name__ == "__main__":
    unittest.main()
