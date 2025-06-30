#!/usr/bin/env python
"""Unit tests for the SQL database text ingestion functionality."""

import json
import os
import tempfile
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

import pymysql

from data_ingestion.sql_to_vector_db import ingest_db_text
from data_ingestion.utils.text_splitter_utils import Document


class TestArgumentParsing(unittest.TestCase):
    """Test cases for command-line argument parsing."""

    def test_required_arguments(self):
        """Test that required arguments are properly parsed."""
        test_args = [
            "--site",
            "test-site",
            "--database",
            "test_db",
            "--library-name",
            "Test Library",
        ]

        with patch("sys.argv", ["ingest_db_text.py"] + test_args):
            args = ingest_db_text.parse_arguments()

            self.assertEqual(args.site, "test-site")
            self.assertEqual(args.database, "test_db")
            self.assertEqual(args.library_name, "Test Library")
            self.assertFalse(args.keep_data)  # Default value
            self.assertEqual(args.batch_size, 50)  # Default value
            self.assertFalse(args.dry_run)  # Default value

    def test_optional_arguments(self):
        """Test that optional arguments are properly parsed."""
        test_args = [
            "--site",
            "test-site",
            "--database",
            "test_db",
            "--library-name",
            "Test Library",
            "--keep-data",
            "--batch-size",
            "100",
            "--dry-run",
        ]

        with patch("sys.argv", ["ingest_db_text.py"] + test_args):
            args = ingest_db_text.parse_arguments()

            self.assertTrue(args.keep_data)
            self.assertEqual(args.batch_size, 100)
            self.assertTrue(args.dry_run)


class TestS3ExclusionRules(unittest.TestCase):
    """Test cases for S3-based exclusion rules functionality."""

    def setUp(self):
        """Set up test fixtures."""
        # S3 format (user-friendly format)
        self.sample_s3_exclusion_rules = {
            "test_site": {
                "exclude_categories": ["Restricted"],
                "exclude_combinations": [
                    {"category": "Letters", "author": "Admin User"}
                ],
                "exclude_post_hierarchies": [
                    {
                        "parent_id": 3155,
                        "description": "Unpublished class notes for premium members",
                    }
                ],
                "exclude_specific_posts": [
                    {
                        "post_id": 10800,
                        "description": "Unedited notes - reference only",
                    },
                    {"post_id": 11997, "description": "Additional unedited notes"},
                ],
            }
        }

        # Internal format (what the function should return after conversion)
        self.expected_internal_rules = {
            "rules": [
                {
                    "name": "Exclude category 'Restricted'",
                    "type": "category",
                    "category": "Restricted",
                },
                {
                    "name": "Exclude category 'Letters' + author 'Admin User'",
                    "type": "category_author_combination",
                    "category": "Letters",
                    "author": "Admin User",
                },
                {
                    "name": "Exclude hierarchy under post 3155",
                    "type": "post_hierarchy",
                    "parent_post_id": 3155,
                    "description": "Unpublished class notes for premium members",
                },
                {
                    "name": "Exclude specific post 10800",
                    "type": "specific_post_ids",
                    "post_ids": [10800],
                    "description": "Unedited notes - reference only",
                },
                {
                    "name": "Exclude specific post 11997",
                    "type": "specific_post_ids",
                    "post_ids": [11997],
                    "description": "Additional unedited notes",
                },
            ]
        }

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_bucket_name")
    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_s3_client")
    def test_download_exclusion_rules_success(
        self, mock_get_s3_client, mock_get_bucket_name
    ):
        """Test successful download of exclusion rules from S3."""
        # Mock bucket name function
        mock_get_bucket_name.return_value = "ananda-chatbot"

        # Mock S3 client and response
        mock_s3_client = MagicMock()
        mock_get_s3_client.return_value = mock_s3_client

        mock_response = {"Body": MagicMock()}
        mock_response["Body"].read.return_value = json.dumps(
            self.sample_s3_exclusion_rules
        ).encode("utf-8")
        mock_s3_client.get_object.return_value = mock_response

        # Test the function
        rules = ingest_db_text.download_exclusion_rules_from_s3("test_site")

        # Verify S3 call
        mock_s3_client.get_object.assert_called_once_with(
            Bucket="ananda-chatbot",
            Key="site-config/data_ingestion/sql_to_vector_db/exclusion_rules.json",
        )

        # Verify returned rules (should be converted to internal format)
        self.assertEqual(rules, self.expected_internal_rules)
        self.assertEqual(len(rules["rules"]), 5)  # Should have 5 rules after conversion
        self.assertEqual(rules["rules"][0]["name"], "Exclude category 'Restricted'")

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_bucket_name")
    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_s3_client")
    def test_download_exclusion_rules_s3_error(
        self, mock_get_s3_client, mock_get_bucket_name
    ):
        """Test handling of S3 errors when downloading exclusion rules."""
        # Mock bucket name function
        mock_get_bucket_name.return_value = "ananda-chatbot"

        # Mock S3 client to raise exception
        mock_s3_client = MagicMock()
        mock_get_s3_client.return_value = mock_s3_client
        mock_s3_client.get_object.side_effect = Exception("S3 access denied")

        # Test the function
        rules = ingest_db_text.download_exclusion_rules_from_s3("test_site")

        # Should return empty dict on error (based on actual implementation)
        self.assertEqual(rules, {})

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_bucket_name")
    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_s3_client")
    def test_download_exclusion_rules_invalid_json(
        self, mock_get_s3_client, mock_get_bucket_name
    ):
        """Test handling of invalid JSON in exclusion rules."""
        # Mock bucket name function
        mock_get_bucket_name.return_value = "ananda-chatbot"

        # Mock S3 client with invalid JSON response
        mock_s3_client = MagicMock()
        mock_get_s3_client.return_value = mock_s3_client

        mock_response = {"Body": MagicMock()}
        mock_response["Body"].read.return_value = b"invalid json content"
        mock_s3_client.get_object.return_value = mock_response

        # Test the function
        rules = ingest_db_text.download_exclusion_rules_from_s3("test_site")

        # Should return empty dict on JSON parse error (based on actual implementation)
        self.assertEqual(rules, {})

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_bucket_name")
    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.get_s3_client")
    def test_download_exclusion_rules_site_not_found(
        self, mock_get_s3_client, mock_get_bucket_name
    ):
        """Test handling when requested site is not in exclusion rules."""
        # Mock bucket name function
        mock_get_bucket_name.return_value = "ananda-chatbot"

        # Mock S3 client with rules for different site
        mock_s3_client = MagicMock()
        mock_get_s3_client.return_value = mock_s3_client

        rules_for_other_site = {"other_site": {"rules": []}}
        mock_response = {"Body": MagicMock()}
        mock_response["Body"].read.return_value = json.dumps(
            rules_for_other_site
        ).encode("utf-8")
        mock_s3_client.get_object.return_value = mock_response

        # Test the function
        rules = ingest_db_text.download_exclusion_rules_from_s3("test_site")

        # Should return empty dict when site not found (based on actual implementation)
        self.assertEqual(rules, {})

    def test_should_exclude_post_restricted_category(self):
        """Test exclusion rule for restricted category."""
        exclusion_rules = self.expected_internal_rules

        # Post with restricted category should be excluded
        post_data = {
            "ID": 123,
            "categories": "Restricted|||Other Category",
            "authors_list": "Some Author",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertTrue(should_exclude)
        self.assertEqual(
            rule_name, "Rule 'Exclude category 'Restricted'': Has category 'Restricted'"
        )

    def test_should_exclude_post_admin_letters(self):
        """Test exclusion rule for Admin User Letters."""
        exclusion_rules = self.expected_internal_rules

        # Post with Letters category AND Admin User author should be excluded
        post_data = {
            "ID": 456,
            "categories": "Letters|||Other Category",
            "authors_list": "Admin User|||Co-Author",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertTrue(should_exclude)
        self.assertEqual(
            rule_name,
            "Rule 'Exclude category 'Letters' + author 'Admin User'': Has category 'Letters' AND author 'Admin User'",
        )

    def test_should_exclude_post_admin_letters_category_only(self):
        """Test that Letters category alone (without Admin author) is not excluded."""
        exclusion_rules = self.expected_internal_rules

        # Post with Letters category but different author should NOT be excluded
        post_data = {
            "ID": 789,
            "categories": "Letters|||Other Category",
            "authors_list": "Other Author",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertFalse(should_exclude)
        self.assertEqual(rule_name, "")

    def test_should_exclude_post_private_classes_parent(self):
        """Test exclusion rule for Private Classes parent post."""
        exclusion_rules = self.expected_internal_rules

        # Parent post should be excluded
        post_data = {
            "ID": 3155,  # The parent post ID
            "categories": "Classes",
            "authors_list": "Test Author",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertTrue(should_exclude)
        self.assertEqual(
            rule_name,
            "Rule 'Exclude hierarchy under post 3155': Is parent post (ID: 3155)",
        )

    def test_should_exclude_post_private_classes_child(self):
        """Test exclusion rule for Private Classes child posts."""
        exclusion_rules = self.expected_internal_rules

        # Child post should be excluded
        post_data = {
            "ID": 4000,
            "categories": "Classes",
            "authors_list": "Test Author",
            "post_parent": 3155,  # Child of the Private Classes parent
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertTrue(should_exclude)
        self.assertEqual(
            rule_name,
            "Rule 'Exclude hierarchy under post 3155': Is child of parent post (ID: 3155)",
        )

    def test_should_exclude_post_draft_notes_specific_ids(self):
        """Test exclusion rule for specific Draft Notes post IDs."""
        exclusion_rules = self.expected_internal_rules

        # Specific post ID should be excluded
        post_data = {
            "ID": 10800,  # One of the specific IDs
            "categories": "Notes",
            "authors_list": "Test Author",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertTrue(should_exclude)
        self.assertEqual(
            rule_name, "Rule 'Exclude specific post 10800': Specific post ID (10800)"
        )

    def test_should_exclude_post_draft_notes_child_posts(self):
        """Test exclusion rule for children of Draft Notes."""
        exclusion_rules = self.expected_internal_rules

        # Note: The current implementation only checks specific_post_ids rule for exact ID matches,
        # it doesn't check for children when include_children is True. This test reflects current behavior.
        post_data = {
            "ID": 12000,
            "categories": "Notes",
            "authors_list": "Test Author",
            "post_parent": 10800,  # Child of excluded post
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        # Current implementation doesn't handle include_children for specific_post_ids
        self.assertFalse(should_exclude)
        self.assertEqual(rule_name, "")

    def test_should_exclude_post_no_exclusion(self):
        """Test that normal posts are not excluded."""
        exclusion_rules = self.expected_internal_rules

        # Normal post should not be excluded
        post_data = {
            "ID": 999,
            "categories": "Meditation|||Spiritual Practice",
            "authors_list": "Test Author",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertFalse(should_exclude)
        self.assertEqual(rule_name, "")

    def test_should_exclude_post_empty_rules(self):
        """Test behavior with empty exclusion rules."""
        exclusion_rules = {"rules": []}

        post_data = {
            "ID": 123,
            "categories": "Restricted",
            "authors_list": "Admin User",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(
            post_data, exclusion_rules
        )
        self.assertFalse(should_exclude)
        self.assertEqual(rule_name, "")

    def test_should_exclude_post_none_rules(self):
        """Test behavior with None exclusion rules."""
        post_data = {
            "ID": 123,
            "categories": "Restricted",
            "authors_list": "Admin User",
            "post_parent": 0,
        }

        should_exclude, rule_name = ingest_db_text.should_exclude_post(post_data, None)
        self.assertFalse(should_exclude)
        self.assertEqual(rule_name, "")


class TestExclusionRulesIntegration(unittest.TestCase):
    """Test cases for exclusion rules integration in fetch_data function."""

    def setUp(self):
        """Set up test fixtures."""
        self.sample_exclusion_rules = {
            "rules": [
                {
                    "name": "Ministry Category",
                    "type": "category",
                    "category": "Ministry",
                },
                {
                    "name": "Admin Author Letters",
                    "type": "category_author_combination",
                    "category": "Letters",
                    "author": "Admin Author",
                },
            ]
        }

    @patch(
        "data_ingestion.sql_to_vector_db.ingest_db_text.download_exclusion_rules_from_s3"
    )
    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.pymysql.connect")
    def test_fetch_data_with_exclusions(self, mock_connect, mock_download_rules):
        """Test that fetch_data properly applies exclusion rules."""
        # Mock S3 exclusion rules download
        mock_download_rules.return_value = self.sample_exclusion_rules

        # Mock database connection and cursor
        mock_connection = MagicMock()
        mock_cursor = MagicMock()
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_connection

        # Mock database rows - mix of included and excluded posts
        mock_rows = [
            {  # Should be excluded - Ministry category
                "ID": 1,
                "post_content": "<p>Ministry content</p>",
                "post_name": "ministry-post",
                "post_title": "Ministry Post",
                "PARENT_TITLE_1": None,
                "PARENT_TITLE_2": None,
                "PARENT_TITLE_3": None,
                "PARENT_SLUG_1": None,
                "PARENT_SLUG_2": None,
                "PARENT_SLUG_3": None,
                "CHILD_TITLE": "Ministry Post",
                "post_author": 1,
                "post_date": datetime(2023, 6, 15),
                "post_type": "content",
                "categories": "Ministry|||Other Category",
                "authors_list": "Test Author",
                "PARENT3_AUTHOR_ID": 1,
                "post_parent": 0,
            },
            {  # Should be excluded - Admin author Letters
                "ID": 2,
                "post_content": "<p>Letter content</p>",
                "post_name": "letter-post",
                "post_title": "Letter Post",
                "PARENT_TITLE_1": None,
                "PARENT_TITLE_2": None,
                "PARENT_TITLE_3": None,
                "PARENT_SLUG_1": None,
                "PARENT_SLUG_2": None,
                "PARENT_SLUG_3": None,
                "CHILD_TITLE": "Letter Post",
                "post_author": 2,
                "post_date": datetime(2023, 6, 15),
                "post_type": "content",
                "categories": "Letters",
                "authors_list": "Admin Author",
                "PARENT3_AUTHOR_ID": 2,
                "post_parent": 0,
            },
            {  # Should be included - normal post
                "ID": 3,
                "post_content": "<p>Normal content</p>",
                "post_name": "normal-post",
                "post_title": "Normal Post",
                "PARENT_TITLE_1": None,
                "PARENT_TITLE_2": None,
                "PARENT_TITLE_3": None,
                "PARENT_SLUG_1": None,
                "PARENT_SLUG_2": None,
                "PARENT_SLUG_3": None,
                "CHILD_TITLE": "Normal Post",
                "post_author": 1,
                "post_date": datetime(2023, 6, 15),
                "post_type": "content",
                "categories": "Meditation",
                "authors_list": "Test Author",
                "PARENT3_AUTHOR_ID": 1,
                "post_parent": 0,
            },
        ]

        mock_cursor.fetchall.return_value = mock_rows

        # Mock site configuration
        site_config = {
            "base_url": "https://example.com/",
            "post_types": ["content"],
            "category_taxonomy": "library-category",
        }

        # Mock authors dictionary
        authors = {1: "Test Author", 2: "Admin Author"}

        # Mock text processing functions
        with (
            patch(
                "data_ingestion.sql_to_vector_db.ingest_db_text.remove_html_tags"
            ) as mock_remove_html,
            patch(
                "data_ingestion.sql_to_vector_db.ingest_db_text.replace_smart_quotes"
            ) as mock_replace_quotes,
        ):
            mock_remove_html.side_effect = lambda x: x.replace("<p>", "").replace(
                "</p>", ""
            )
            mock_replace_quotes.side_effect = lambda x: x

            # Test the fetch_data function
            processed_data = ingest_db_text.fetch_data(
                mock_connection, site_config, "Test Library", authors, "ananda"
            )

            # Verify exclusion rules were downloaded
            mock_download_rules.assert_called_once_with("ananda")

            # Should only include the normal post (ID=3), exclude the Ministry and Letters posts
            self.assertEqual(len(processed_data), 1)
            self.assertEqual(processed_data[0]["id"], 3)
            self.assertEqual(processed_data[0]["title"], "Normal Post")

    @patch(
        "data_ingestion.sql_to_vector_db.ingest_db_text.download_exclusion_rules_from_s3"
    )
    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.pymysql.connect")
    def test_fetch_data_no_exclusion_rules(self, mock_connect, mock_download_rules):
        """Test that fetch_data works normally when no exclusion rules are available."""
        # Mock S3 download to return None (no rules)
        mock_download_rules.return_value = None

        # Mock database connection and cursor
        mock_connection = MagicMock()
        mock_cursor = MagicMock()
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_connection

        # Mock database row
        mock_rows = [
            {
                "ID": 1,
                "post_content": "<p>Test content</p>",
                "post_name": "test-post",
                "post_title": "Test Post",
                "PARENT_TITLE_1": None,
                "PARENT_TITLE_2": None,
                "PARENT_TITLE_3": None,
                "PARENT_SLUG_1": None,
                "PARENT_SLUG_2": None,
                "PARENT_SLUG_3": None,
                "CHILD_TITLE": "Test Post",
                "post_author": 1,
                "post_date": datetime(2023, 6, 15),
                "post_type": "content",
                "categories": "Ministry",  # Would be excluded if rules were active
                "authors_list": "Test Author",
                "PARENT3_AUTHOR_ID": 1,
                "post_parent": 0,
            }
        ]

        mock_cursor.fetchall.return_value = mock_rows

        # Mock site configuration
        site_config = {
            "base_url": "https://example.com/",
            "post_types": ["content"],
            "category_taxonomy": "library-category",
        }

        # Mock authors dictionary
        authors = {1: "Test Author"}

        # Mock text processing functions
        with (
            patch(
                "data_ingestion.sql_to_vector_db.ingest_db_text.remove_html_tags"
            ) as mock_remove_html,
            patch(
                "data_ingestion.sql_to_vector_db.ingest_db_text.replace_smart_quotes"
            ) as mock_replace_quotes,
        ):
            mock_remove_html.side_effect = lambda x: x.replace("<p>", "").replace(
                "</p>", ""
            )
            mock_replace_quotes.side_effect = lambda x: x

            # Test the fetch_data function
            processed_data = ingest_db_text.fetch_data(
                mock_connection, site_config, "Test Library", authors, "ananda"
            )

            # Should include all posts when no exclusion rules are active
            self.assertEqual(len(processed_data), 1)
            self.assertEqual(processed_data[0]["id"], 1)


class TestEnvironmentLoading(unittest.TestCase):
    """Test cases for environment variable loading."""

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.load_env")
    @patch.dict(
        "os.environ",
        {
            "DB_USER": "test_user",
            "DB_PASSWORD": "test_pass",
            "DB_HOST": "test_host",
            "PINECONE_API_KEY": "test_pinecone_key",
            "OPENAI_API_KEY": "test_openai_key",
            "PINECONE_INGEST_INDEX_NAME": "test_index",
        },
    )
    def test_load_environment_success(self, mock_load_env):
        """Test successful environment loading."""
        # Should not raise any exceptions
        ingest_db_text.load_environment("test-site")
        mock_load_env.assert_called_once_with("TEST-SITE")

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.load_env")
    @patch.dict(
        "os.environ",
        {
            "DB_USER": "test_user",
            # Missing other required variables
        },
        clear=True,
    )
    def test_load_environment_missing_vars(self, mock_load_env):
        """Test error when required environment variables are missing."""
        with self.assertRaises(SystemExit):
            ingest_db_text.load_environment("test-site")


class TestDatabaseUtilities(unittest.TestCase):
    """Test cases for database utility functions."""

    def test_get_db_config(self):
        """Test database configuration construction."""
        mock_args = MagicMock()
        mock_args.database = "test_database"

        with patch.dict(
            "os.environ",
            {
                "DB_USER": "test_user",
                "DB_PASSWORD": "test_pass",
                "DB_HOST": "test_host",
                "DB_CHARSET": "utf8mb4",
                "DB_COLLATION": "utf8mb4_unicode_ci",
            },
        ):
            config = ingest_db_text.get_db_config(mock_args)

            self.assertEqual(config["user"], "test_user")
            self.assertEqual(config["password"], "test_pass")
            self.assertEqual(config["host"], "test_host")
            self.assertEqual(config["database"], "test_database")
            self.assertEqual(config["charset"], "utf8mb4")
            self.assertEqual(config["collation"], "utf8mb4_unicode_ci")

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.pymysql.connect")
    def test_get_db_connection_success(self, mock_connect):
        """Test successful database connection."""
        mock_connection = MagicMock()
        mock_connect.return_value = mock_connection

        config = {
            "user": "test",
            "password": "test",
            "host": "test",
            "database": "test",
        }
        result = ingest_db_text.get_db_connection(config)

        self.assertEqual(result, mock_connection)
        mock_connect.assert_called_once_with(**config)

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.pymysql.connect")
    @patch("time.sleep")
    def test_get_db_connection_retry_then_success(self, mock_sleep, mock_connect):
        """Test database connection with retry logic."""
        # First call fails, second succeeds
        mock_connection = MagicMock()
        mock_connect.side_effect = [
            pymysql.MySQLError("Connection failed"),
            mock_connection,
        ]

        config = {
            "user": "test",
            "password": "test",
            "host": "test",
            "database": "test",
        }
        result = ingest_db_text.get_db_connection(config)

        self.assertEqual(result, mock_connection)
        self.assertEqual(mock_connect.call_count, 2)
        mock_sleep.assert_called_once()


class TestCheckpointUtilities(unittest.TestCase):
    """Test cases for checkpoint functionality."""

    def setUp(self):
        """Set up test environment."""
        self.temp_dir = tempfile.mkdtemp()
        self.checkpoint_file = os.path.join(self.temp_dir, "test_checkpoint.json")

    def tearDown(self):
        """Clean up test environment."""
        import shutil

        shutil.rmtree(self.temp_dir)

    def test_save_and_load_checkpoint(self):
        """Test saving and loading checkpoint data."""
        processed_ids = [1, 2, 3, 4, 5]
        last_processed_id = 5

        # Save checkpoint
        ingest_db_text.save_checkpoint(
            self.checkpoint_file, processed_ids, last_processed_id
        )

        # Verify file was created
        self.assertTrue(os.path.exists(self.checkpoint_file))

        # Load checkpoint
        loaded_data = ingest_db_text.load_checkpoint(self.checkpoint_file)

        self.assertIsNotNone(loaded_data)
        self.assertEqual(set(loaded_data["processed_doc_ids"]), set(processed_ids))
        self.assertEqual(loaded_data["last_processed_id"], last_processed_id)
        self.assertIn("timestamp", loaded_data)

    def test_load_nonexistent_checkpoint(self):
        """Test loading checkpoint when file doesn't exist."""
        nonexistent_file = os.path.join(self.temp_dir, "nonexistent.json")
        result = ingest_db_text.load_checkpoint(nonexistent_file)
        self.assertIsNone(result)

    def test_load_invalid_checkpoint(self):
        """Test loading checkpoint with invalid JSON."""
        with open(self.checkpoint_file, "w") as f:
            f.write("invalid json content")

        result = ingest_db_text.load_checkpoint(self.checkpoint_file)
        self.assertIsNone(result)


class TestSiteConfiguration(unittest.TestCase):
    """Test cases for site-specific configuration."""

    def test_get_config_ananda(self):
        """Test getting configuration for ananda site."""
        config = ingest_db_text.get_config("ananda")

        self.assertIn("base_url", config)
        self.assertIn("post_types", config)
        self.assertIn("category_taxonomy", config)
        self.assertEqual(config["base_url"], "https://www.anandalibrary.org/")
        self.assertEqual(config["post_types"], ["content"])
        self.assertEqual(config["category_taxonomy"], "library-category")

    def test_get_config_invalid_site(self):
        """Test error for invalid site configuration."""
        with self.assertRaises(SystemExit):
            ingest_db_text.get_config("invalid-site")


class TestPermalinkCalculation(unittest.TestCase):
    """Test cases for permalink calculation."""

    def test_ananda_content_permalink_with_parents(self):
        """Test permalink calculation for ananda content with parent hierarchy."""
        base_url = "https://www.anandalibrary.org/"
        post_type = "content"
        post_date = datetime(2023, 6, 15)
        post_name = "meditation-basics"
        parent_slug_1 = "techniques"
        parent_slug_2 = "beginner"
        parent_slug_3 = "spiritual-practices"

        permalink = ingest_db_text.calculate_permalink(
            base_url,
            post_type,
            post_date,
            post_name,
            parent_slug_1,
            parent_slug_2,
            parent_slug_3,
            "ananda",
        )

        expected = "https://www.anandalibrary.org/content/spiritual-practices/beginner/techniques/meditation-basics/"
        self.assertEqual(permalink, expected)

    def test_ananda_content_permalink_no_parents(self):
        """Test permalink calculation for ananda content without parents."""
        base_url = "https://www.anandalibrary.org/"
        post_type = "content"
        post_date = datetime(2023, 6, 15)
        post_name = "standalone-article"

        permalink = ingest_db_text.calculate_permalink(
            base_url, post_type, post_date, post_name, None, None, None, "ananda"
        )

        expected = "https://www.anandalibrary.org/content/standalone-article/"
        self.assertEqual(permalink, expected)

    def test_page_permalink(self):
        """Test permalink calculation for pages."""
        base_url = "https://example.com/"
        post_type = "page"
        post_date = datetime(2023, 6, 15)
        post_name = "about-us"

        permalink = ingest_db_text.calculate_permalink(
            base_url, post_type, post_date, post_name, None, None, None, "other"
        )

        expected = "https://example.com/about-us/"
        self.assertEqual(permalink, expected)

    def test_default_post_permalink(self):
        """Test permalink calculation for default posts."""
        base_url = "https://example.com/"
        post_type = "post"
        post_date = datetime(2023, 6, 15)
        post_name = "blog-post"

        permalink = ingest_db_text.calculate_permalink(
            base_url, post_type, post_date, post_name, None, None, None, "other"
        )

        expected = "https://example.com/2023/06/blog-post/"
        self.assertEqual(permalink, expected)


class TestVectorIdGeneration(unittest.TestCase):
    """Test cases for vector ID generation."""

    def test_generate_vector_id(self):
        """Test vector ID generation with all parameters."""
        library_name = "Test Library"
        title = "Test Article: Meditation & Mindfulness"
        chunk_index = 0
        author = "Test Author"
        permalink = "https://example.com/test-article"

        vector_id = ingest_db_text.generate_vector_id(
            library_name=library_name,
            title=title,
            chunk_index=chunk_index,
            source_location="db",
            source_identifier=permalink,
            content_type="text",
            author=author,
            chunk_text="Sample chunk text for testing",
        )

        # Should start with content_type||library||source_location||
        self.assertTrue(vector_id.startswith("text||Test Library||db||"))

        # Should contain sanitized title (preserves punctuation, only normalizes whitespace)
        self.assertIn("Test Article: Meditation & Mindfulness", vector_id)

        # Should end with chunk number (0-based index, so chunk 0)
        self.assertTrue(vector_id.endswith("||0"))

        # Should contain author
        self.assertIn("||Test Author||", vector_id)

        # Should contain document hash (not chunk hash)
        parts = vector_id.split("||")
        self.assertEqual(
            len(parts), 7
        )  # content_type, library, source_location, title, author, document_hash, chunk_index

    def test_generate_vector_id_title_sanitization(self):
        """Test that vector ID preserves meaningful punctuation and only removes null characters."""
        library_name = "Test Library"
        title = "Special Characters: !@#$%^&*()[]{}|\\;:'\",.<>?/`~\x00"  # Include null char
        chunk_index = 0

        vector_id = ingest_db_text.generate_vector_id(
            library_name=library_name,
            title=title,
            chunk_index=chunk_index,
            source_location="db",
            source_identifier="https://example.com/test-article",
            content_type="text",
            chunk_text="Test chunk text with special characters",
        )

        parts = vector_id.split("||")
        title_part = parts[3]  # Title is now at index 3 in the new format

        # Should preserve most special characters (Pinecone allows all ASCII except \0)
        preserved_chars = "!@#$%^&*()[]{}|\\;:'\",.<>?/`~"
        for char in preserved_chars:
            self.assertIn(char, title_part, f"Character '{char}' should be preserved")

        # Should remove null characters
        self.assertNotIn("\x00", title_part, "Null character should be removed")

        # Should normalize whitespace but preserve content
        title_with_spaces = "Title   with    multiple   spaces"
        vector_id_spaces = ingest_db_text.generate_vector_id(
            library_name=library_name,
            title=title_with_spaces,
            chunk_index=chunk_index,
            source_location="db",
            source_identifier="https://example.com/test-article",
            content_type="text",
            chunk_text="Test chunk text for spaces test",
        )
        parts_spaces = vector_id_spaces.split("||")
        title_part_spaces = parts_spaces[3]  # Title is now at index 3 in the new format
        self.assertEqual(title_part_spaces, "Title with multiple spaces")


class TestPunctuationPreservation(unittest.TestCase):
    """Test cases for punctuation preservation in ingested text."""

    @patch("data_ingestion.sql_to_vector_db.ingest_db_text.pymysql.connect")
    def test_fetch_data_punctuation_preservation(self, mock_connect):
        """Test that punctuation is preserved when fetching data from the DB."""
        # Mock database connection and cursor
        mock_connection = MagicMock()
        mock_cursor = MagicMock()
        mock_connection.cursor.return_value.__enter__.return_value = mock_cursor
        mock_connect.return_value = mock_connection

        # Mock database rows with rich punctuation
        mock_rows = [
            {
                "ID": 1,
                "post_content": """<p>Welcome to our meditation guide! Are you ready to begin?</p>
                <p>Let's explore the fundamentals: breathing, posture, and mindfulness.</p>
                <ul>
                    <li>Focus on your breath (inhale... exhale...)</li>
                    <li>Don't judge your thoughts—simply observe them</li>
                    <li>Practice daily @ 6:00 AM for best results</li>
                </ul>
                <blockquote>"The mind is everything. What you think you become." —Buddha</blockquote>
                <p>Remember: it's not about perfection; it's about progress!</p>
                <p>Questions? Email us at info@example.com or call (555) 123-4567.</p>""",
                "post_name": "meditation-guide",
                "post_title": "Complete Meditation Guide",
                "PARENT_TITLE_1": "Techniques",
                "PARENT_TITLE_2": "Beginner",
                "PARENT_TITLE_3": "Spiritual Practices",
                "PARENT_SLUG_1": "techniques",
                "PARENT_SLUG_2": "beginner",
                "PARENT_SLUG_3": "spiritual-practices",
                "CHILD_TITLE": "Complete Meditation Guide",
                "post_author": 1,
                "post_date": datetime(2023, 6, 15),
                "post_type": "content",
                "categories": "Meditation|||Mindfulness|||Beginner",
                "authors_list": "Test Author|||Co-Author",
                "PARENT3_AUTHOR_ID": 1,
            }
        ]

        mock_cursor.fetchall.return_value = mock_rows

        # Mock site configuration
        site_config = {
            "base_url": "https://example.com/",
            "post_types": ["content"],
            "category_taxonomy": "library-category",
        }

        # Mock authors dictionary
        authors = {1: "Test Author"}

        # Test the fetch_data function
        with (
            patch(
                "data_ingestion.sql_to_vector_db.ingest_db_text.remove_html_tags"
            ) as mock_remove_html,
            patch(
                "data_ingestion.sql_to_vector_db.ingest_db_text.replace_smart_quotes"
            ) as mock_replace_quotes,
        ):
            # Mock text processing to preserve punctuation
            cleaned_text = """Welcome to our meditation guide! Are you ready to begin?

Let's explore the fundamentals: breathing, posture, and mindfulness.

• Focus on your breath (inhale... exhale...)
• Don't judge your thoughts—simply observe them
• Practice daily @ 6:00 AM for best results

\"The mind is everything. What you think you become.\" —Buddha

Remember: it's not about perfection; it's about progress!
Questions? Email us at info@example.com or call (555) 123-4567."""

            mock_remove_html.return_value = cleaned_text
            mock_replace_quotes.return_value = cleaned_text

            processed_data = ingest_db_text.fetch_data(
                mock_connection, site_config, "Test Library", authors, "test-site"
            )

            # Verify data was processed
            self.assertEqual(len(processed_data), 1)

            processed_item = processed_data[0]
            content = processed_item["content"]

            # Test preservation of various punctuation marks
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
                    content,
                    f"Punctuation mark '{mark}' should be preserved in database content",
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
                    element, content, f"Special element '{element}' should be preserved"
                )

            # Verify other processed data
            self.assertEqual(
                processed_item["title"],
                "Spiritual Practices:: Beginner:: Techniques:: Complete Meditation Guide",
            )
            self.assertEqual(processed_item["author"], "Test Author")
            self.assertEqual(
                processed_item["categories"], ["Meditation", "Mindfulness", "Beginner"]
            )
            self.assertEqual(processed_item["library"], "Test Library")

    @patch("data_ingestion.utils.text_splitter_utils.SpacyTextSplitter")
    def test_process_and_upsert_batch_punctuation_preservation(
        self, mock_splitter_class
    ):
        """Test that punctuation is preserved throughout the processing and upserting batch."""
        # Create mock text splitter
        mock_splitter = MagicMock()
        mock_splitter_class.return_value = mock_splitter

        # Mock chunks with preserved punctuation
        mock_chunks = [
            Document(
                page_content="Welcome to our meditation guide! Are you ready to begin?"
            ),
            Document(
                page_content="Let's explore the fundamentals: breathing, posture, and mindfulness."
            ),
            Document(
                page_content='"The mind is everything. What you think you become." —Buddha'
            ),
            Document(
                page_content="Questions? Email us at info@example.com or call (555) 123-4567."
            ),
        ]
        mock_splitter.split_documents.return_value = mock_chunks

        # Mock embeddings model
        mock_embeddings = MagicMock()
        mock_embeddings.embed_documents.return_value = [
            [0.1, 0.2, 0.3],  # Embedding for chunk 1
            [0.4, 0.5, 0.6],  # Embedding for chunk 2
            [0.7, 0.8, 0.9],  # Embedding for chunk 3
            [0.1, 0.4, 0.7],  # Embedding for chunk 4
        ]

        # Mock Pinecone index
        mock_pinecone_index = MagicMock()
        mock_upsert_response = MagicMock()
        mock_upsert_response.upserted_count = 4
        mock_pinecone_index.upsert.return_value = mock_upsert_response

        # Test data with punctuation
        batch_data = [
            {
                "id": 1,
                "title": "Complete Meditation Guide",
                "author": "Test Author",
                "permalink": "https://example.com/meditation-guide",
                "content": """Welcome to our meditation guide! Are you ready to begin?
                
Let's explore the fundamentals: breathing, posture, and mindfulness.

"The mind is everything. What you think you become." —Buddha

Questions? Email us at info@example.com or call (555) 123-4567.""",
                "categories": ["Meditation", "Mindfulness"],
                "library": "Test Library",
            }
        ]

        # Call the function
        had_errors, processed_ids = ingest_db_text.process_and_upsert_batch(
            batch_data,
            mock_pinecone_index,
            mock_embeddings,
            mock_splitter,
            dry_run=False,
        )

        # Verify no errors and processing succeeded
        self.assertFalse(had_errors)
        self.assertEqual(processed_ids, [1])

        # Verify text splitter was called with document
        mock_splitter.split_documents.assert_called_once()
        called_docs = mock_splitter.split_documents.call_args[0][0]
        self.assertEqual(len(called_docs), 1)

        # Verify the document content preserves punctuation
        doc_content = called_docs[0].page_content
        punctuation_marks = ["!", "?", ".", "'", '"', ":", "—", "@", "-", "(", ")"]
        for mark in punctuation_marks:
            self.assertIn(
                mark,
                doc_content,
                f"Punctuation mark '{mark}' should be preserved in document content",
            )

        # Verify embeddings were generated for chunks
        mock_embeddings.embed_documents.assert_called_once()
        embedded_texts = mock_embeddings.embed_documents.call_args[0][0]

        # Verify each embedded text preserves punctuation
        all_embedded_text = " ".join(embedded_texts)
        for mark in punctuation_marks:
            self.assertIn(
                mark,
                all_embedded_text,
                f"Punctuation mark '{mark}' should be preserved in embedded text",
            )

        # Verify Pinecone upsert was called with proper vector data
        mock_pinecone_index.upsert.assert_called()
        upsert_call_args = mock_pinecone_index.upsert.call_args
        vectors = upsert_call_args.kwargs["vectors"]

        # Check that metadata contains punctuation-preserved text
        for vector in vectors:
            metadata_text = vector["metadata"]["text"]
            # Should contain some punctuation
            has_punctuation = any(char in metadata_text for char in ".,!?;:—")
            self.assertTrue(
                has_punctuation,
                f"Vector metadata text should contain punctuation: '{metadata_text}'",
            )


class TestSQLChunkingStrategy(unittest.TestCase):
    """Test cases for SQL to vector DB chunking strategy."""

    def test_spacy_text_splitter_uses_fixed_parameters(self):
        """Test that SpacyTextSplitter uses fixed parameters for optimal RAG performance."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        # Initialize with default parameters (what the script should use)
        splitter = SpacyTextSplitter()

        # Verify fixed parameters are used (historical values from performance evaluation)
        # Historical SQL/database processing used 1000 chars (~250 tokens) with 50 overlap
        self.assertEqual(
            splitter.target_chunk_size,
            250,
            f"Expected historical target_chunk_size=250 tokens, got {splitter.target_chunk_size}",
        )
        self.assertEqual(
            splitter.chunk_size,
            187,
            f"Expected historical base chunk_size=187 tokens (75% of target), got {splitter.chunk_size}",
        )
        self.assertEqual(
            splitter.chunk_overlap,
            50,
            f"Expected historical chunk_overlap=50 tokens (20%), got {splitter.chunk_overlap}",
        )
        self.assertEqual(
            splitter.separator,
            "\n\n",
            f"Expected paragraph separator '\\n\\n', got '{splitter.separator}'",
        )

    def test_spacy_text_splitter_produces_reasonable_chunks(self):
        """Test that the chunking produces reasonable chunk sizes."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        splitter = SpacyTextSplitter()

        # Test with sample spiritual content similar to what's in the database
        sample_text = """
        Meditation is the process by which the soul methodically seeks to reunite with Spirit. 
        It is an ancient science that has been practiced for thousands of years by seekers 
        of truth in all parts of the world.

        The word meditation comes from the Latin meditari, meaning "to think about" or 
        "to consider." In its deeper sense, meditation means "to become familiar with" 
        the divine consciousness within oneself.

        Regular meditation practice helps to calm the restless mind and awaken the soul's 
        innate wisdom and bliss. Through meditation, we learn to withdraw our attention 
        from the constant chatter of thoughts and the bombardment of sensory stimuli.

        In the stillness of deep meditation, the soul experiences its true nature as 
        consciousness itself—pure, eternal, and one with the infinite Spirit that 
        pervades all creation.
        """

        chunks = splitter.split_text(sample_text, document_id="test_meditation_text")

        # Verify we get chunks
        self.assertGreater(len(chunks), 0, "Should produce at least one chunk")

        # Verify chunk sizes are reasonable in tokens (250 token historical target)
        for i, chunk in enumerate(chunks):
            # Count tokens using the same method as the splitter
            token_count = len(splitter._tokenize_text(chunk))

            # Tokens should be close to 250 historical target (allow some flexibility)
            self.assertGreaterEqual(
                token_count,
                50,
                f"Chunk {i} has {token_count} tokens, below minimum range [50-500]",
            )
            self.assertLessEqual(
                token_count,
                500,
                f"Chunk {i} has {token_count} tokens, above maximum range [50-500]",
            )

    def test_reproduces_large_chunk_issue_with_token_validation(self):
        """Test that reproduces the large chunk issue and validates token counts."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        splitter = SpacyTextSplitter()

        # Create a long text that might cause the issue (simulating content from DB)
        # This simulates spiritual content that might not have clear paragraph breaks
        long_spiritual_text = (
            """The art of superconscious living involves understanding the subtle laws that govern consciousness and the relationship between the individual soul and the universal Spirit. Through meditation, right living, and the cultivation of divine qualities, one can gradually expand their awareness beyond the limitations of the ego-mind and experience the joy and freedom of their true spiritual nature. This ancient wisdom has been taught by masters and saints throughout history, offering practical guidance for those seeking to awaken to higher states of consciousness. The path requires dedication, patience, and the willingness to transform old patterns of thinking and behavior that keep us bound to limited perceptions of reality. As we learn to live in harmony with divine principles, we naturally begin to express more love, compassion, wisdom, and joy in our daily lives. This is not merely an intellectual understanding but a lived experience that transforms every aspect of our being. Through consistent practice and sincere effort, we can learn to maintain awareness of our divine nature even while engaged in the activities of daily life. This is the essence of superconscious living - the integration of spiritual awareness with practical action in the world."""
            * 20
        )  # Make it very long

        chunks = splitter.split_text(
            long_spiritual_text, document_id="test_long_spiritual_content"
        )

        self.assertGreater(len(chunks), 0, "Should produce at least one chunk")

        for i, chunk in enumerate(chunks):
            token_count = len(splitter._tokenize_text(chunk))
            word_count = len(chunk.split())

            # PRIMARY TEST: Token count should respect the 250-token historical target
            self.assertLessEqual(
                token_count,
                375,
                f"Chunk {i} is too large: {token_count} tokens (target: 250 tokens). "
                f"This exceeds reasonable bounds even with overlap.",
            )

            # SECONDARY: Word count should be reasonable based on token-to-word ratio
            # With ~2:1 ratio, 250 tokens ≈ 125 words, so max should be ~200 words + overlap
            self.assertLessEqual(
                word_count,
                250,
                f"Chunk {i} has {word_count} words, which suggests token counting isn't working properly. "
                f"Expected roughly 125 words for 250 tokens.",
            )

    def test_token_counting_accuracy(self):
        """Test that token counting is working properly and matches expectations."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        splitter = SpacyTextSplitter()

        # Test with known text
        test_text = "This is a simple test sentence with exactly ten words total."
        tokens = splitter._tokenize_text(test_text)

        # Token count should be close to word count for simple English text
        # Allow some variation due to punctuation and tokenization differences
        self.assertGreaterEqual(
            len(tokens),
            8,
            f"Token count {len(tokens)} seems too low for simple sentence. "
            f"Expected 8-15 tokens for 10 words.",
        )
        self.assertLessEqual(
            len(tokens),
            15,
            f"Token count {len(tokens)} seems too high for simple sentence. "
            f"Expected 8-15 tokens for 10 words.",
        )

    def test_fixed_chunking_consistency(self):
        """Test that fixed chunking produces consistent results."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        splitter1 = SpacyTextSplitter()
        splitter2 = SpacyTextSplitter()

        # Both should have identical parameters
        self.assertEqual(splitter1.chunk_size, splitter2.chunk_size)
        self.assertEqual(splitter1.chunk_overlap, splitter2.chunk_overlap)
        self.assertEqual(splitter1.separator, splitter2.separator)

        # Both should produce the same results for the same input
        test_text = "This is a test paragraph.\n\nThis is another test paragraph with more content."

        chunks1 = splitter1.split_text(test_text)
        chunks2 = splitter2.split_text(test_text)

        self.assertEqual(
            chunks1, chunks2, "Fixed chunking should produce consistent results"
        )

    def test_sql_chunking_uses_fixed_parameters_by_default(self):
        """Test that SQL chunking uses the correct fixed parameters by default."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        # This test verifies that when the script creates a SpacyTextSplitter(),
        # it gets the correct fixed parameters for optimal RAG performance
        splitter = SpacyTextSplitter()  # Same as what the script does

        # These should match the historical evaluation parameters for optimal RAG performance
        # Historical SQL/database processing used 1000 chars (~250 tokens) with 50 overlap
        self.assertEqual(splitter.target_chunk_size, 250)
        self.assertEqual(splitter.chunk_size, 187)  # 75% of target (187 = 250 * 0.75)
        self.assertEqual(splitter.chunk_overlap, 50)  # 20% of 250
        self.assertEqual(splitter.separator, "\n\n")  # Paragraph-based chunking

    def test_sql_chunking_matches_other_ingestion_methods(self):
        """Test that SQL chunking uses same parameters as other ingestion methods."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        # This ensures consistency across all ingestion pipelines

        # SQL ingestion splitter (default parameters)
        sql_splitter = SpacyTextSplitter()

        # Audio/video ingestion splitter (from transcription_utils.py)
        audio_splitter = SpacyTextSplitter(separator="\n\n", pipeline="en_core_web_sm")

        # PDF ingestion splitter (should use same defaults)
        pdf_splitter = SpacyTextSplitter()

        # All should use the same core parameters for consistency
        self.assertEqual(sql_splitter.chunk_size, audio_splitter.chunk_size)
        self.assertEqual(sql_splitter.chunk_size, pdf_splitter.chunk_size)
        self.assertEqual(sql_splitter.chunk_overlap, audio_splitter.chunk_overlap)
        self.assertEqual(sql_splitter.chunk_overlap, pdf_splitter.chunk_overlap)

    def test_chunking_respects_token_limits(self):
        """Test that overlap application respects the 600-token limit."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        splitter = SpacyTextSplitter()

        # Create text that would produce chunks near the 600-token limit
        medium_text = (
            "This is a test of the emergency broadcast system. " * 200
        )  # Should be close to token limit

        chunks = splitter.split_text(medium_text, document_id="test_token_limit")

        # All chunks should respect the 600-token limit
        for i, chunk in enumerate(chunks):
            token_count = len(splitter._tokenize_text(chunk))
            self.assertLessEqual(
                token_count,
                600,
                f"Chunk {i} exceeds 600-token limit: {token_count} tokens",
            )

    def test_integration_with_sql_ingestion_script(self):
        """Test that the chunking works correctly with the SQL ingestion script structure."""
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        # This mimics how the SQL script initializes the text splitter
        text_splitter = SpacyTextSplitter()  # No parameters - uses defaults

        # Test with content structure similar to what comes from the database
        database_content = {
            "content": """Welcome to our meditation guide! This is a comprehensive introduction to the ancient practice of meditation.

Meditation is a practice that has been used for thousands of years to cultivate inner peace and awareness. Through regular practice, one can develop greater clarity, compassion, and understanding.

The basic steps are simple: find a quiet place, sit comfortably, and focus your attention. Many practitioners find it helpful to focus on the breath as an anchor for the mind.""",
            "id": 123,
            "title": "Complete Meditation Guide",
            "author": "Test Author",
            "library": "Test Library",
        }

        # Create a document similar to how the SQL script does it
        from data_ingestion.utils.text_splitter_utils import Document

        document_metadata = {
            "id": f"wp_{database_content['id']}",
            "title": database_content["title"],
            "source": "https://example.com/meditation-guide",
            "wp_id": database_content["id"],
        }

        langchain_doc = Document(
            page_content=database_content["content"], metadata=document_metadata
        )

        # Split the document using the text splitter
        docs = text_splitter.split_documents([langchain_doc])

        # Verify we get reasonable results
        self.assertGreater(len(docs), 0, "Should produce at least one chunk")

        # Verify each chunk has proper metadata and content
        for i, doc in enumerate(docs):
            self.assertIsInstance(doc.page_content, str)
            self.assertGreater(len(doc.page_content.strip()), 0)
            self.assertIn("chunk_index", doc.metadata)
            self.assertEqual(doc.metadata["chunk_index"], i)

            # Verify token count is reasonable
            token_count = len(text_splitter._tokenize_text(doc.page_content))
            self.assertLessEqual(
                token_count,
                900,  # Allow some buffer for overlap
                f"Chunk {i} exceeds reasonable token limit: {token_count} tokens",
            )


if __name__ == "__main__":
    unittest.main()
