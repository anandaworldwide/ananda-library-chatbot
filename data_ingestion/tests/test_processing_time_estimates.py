#!/usr/bin/env python3
"""
Unit tests for processing_time_estimates.py

Tests the processing time estimation functionality including:
- File locking and JSON persistence
- Error handling and retries
- Time estimation calculations
- Default value handling
"""

import json
import os
import tempfile
import unittest
from datetime import timedelta
from unittest.mock import mock_open, patch

from data_ingestion.audio_video.processing_time_estimates import (
    MAX_RETRIES,
    estimate_total_processing_time,
    get_estimate,
    load_estimates,
    save_estimate,
)


class TestProcessingTimeEstimates(unittest.TestCase):
    """Test suite for processing_time_estimates.py functions."""

    def setUp(self):
        """Set up test fixtures."""
        self.test_dir = tempfile.mkdtemp()
        self.test_file = os.path.join(self.test_dir, "test_estimates.json")
        self.sample_estimates = {
            "audio_file": {"time": 300.0, "size": 1024000},
            "youtube_video": {"time": 600.0, "size": 2048000},
        }

    def tearDown(self):
        """Clean up test fixtures."""
        if os.path.exists(self.test_file):
            os.remove(self.test_file)
        os.rmdir(self.test_dir)

    @patch("data_ingestion.audio_video.processing_time_estimates.ESTIMATES_FILE")
    def test_load_estimates_new_file_creation(self, mock_file_path):
        """Test load_estimates creates a new file with defaults when file doesn't exist."""
        mock_file_path.return_value = self.test_file

        with patch("builtins.open", mock_open()) as mock_file:
            mock_file.return_value.__enter__.return_value.read.return_value = ""

            result = load_estimates()

            expected_defaults = {
                "audio_file": {"time": None, "size": None},
                "youtube_video": {"time": None, "size": None},
            }
            self.assertEqual(result, expected_defaults)

    def test_load_estimates_existing_file(self):
        """Test load_estimates successfully loads existing file with real file operations."""
        # Create a real test file with sample data
        with open(self.test_file, "w") as f:
            json.dump(self.sample_estimates, f)

        # Mock only the ESTIMATES_FILE path to point to our test file
        with patch(
            "data_ingestion.audio_video.processing_time_estimates.ESTIMATES_FILE",
            self.test_file,
        ):
            result = load_estimates()
            self.assertEqual(result, self.sample_estimates)

    @patch("data_ingestion.audio_video.processing_time_estimates.ESTIMATES_FILE")
    @patch("data_ingestion.audio_video.processing_time_estimates.time.sleep")
    def test_load_estimates_json_decode_error_retry(self, mock_sleep, mock_file_path):
        """Test load_estimates retries on JSON decode error and returns defaults."""
        mock_file_path.return_value = self.test_file

        with patch("builtins.open", mock_open(read_data="invalid json")) as mock_file:
            mock_file.return_value.__enter__.return_value.read.return_value = (
                "invalid json"
            )

            result = load_estimates()

            # Should retry MAX_RETRIES times
            self.assertEqual(mock_sleep.call_count, MAX_RETRIES - 1)
            # Should return defaults after all retries fail
            expected_defaults = {
                "audio_file": {"time": None, "size": None},
                "youtube_video": {"time": None, "size": None},
            }
            self.assertEqual(result, expected_defaults)

    @patch("data_ingestion.audio_video.processing_time_estimates.ESTIMATES_FILE")
    @patch("data_ingestion.audio_video.processing_time_estimates.time.sleep")
    def test_load_estimates_os_error_retry(self, mock_sleep, mock_file_path):
        """Test load_estimates retries on OS error and returns defaults."""
        mock_file_path.return_value = self.test_file

        with patch("builtins.open", side_effect=OSError("Permission denied")):
            result = load_estimates()

            # Should retry MAX_RETRIES times
            self.assertEqual(mock_sleep.call_count, MAX_RETRIES - 1)
            # Should return defaults after all retries fail
            expected_defaults = {
                "audio_file": {"time": None, "size": None},
                "youtube_video": {"time": None, "size": None},
            }
            self.assertEqual(result, expected_defaults)

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    @patch("builtins.open", new_callable=mock_open)
    def test_save_estimate_new_item_type(self, mock_file, mock_load):
        """Test save_estimate creates new estimate for unknown item type."""
        mock_load.return_value = {}

        save_estimate("new_type", 100.0, 500000)

        # Should call json.dump with the new estimate
        mock_file.return_value.write.assert_called()
        args_list = mock_file.return_value.write.call_args_list
        written_data = "".join(call[0][0] for call in args_list)
        result = json.loads(written_data)

        self.assertEqual(result["new_type"]["time"], 100.0)
        self.assertEqual(result["new_type"]["size"], 500000)

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    @patch("builtins.open", new_callable=mock_open)
    def test_save_estimate_existing_item_type_averaging(self, mock_file, mock_load):
        """Test save_estimate averages with existing estimates."""
        mock_load.return_value = {"audio_file": {"time": 200.0, "size": 1000000}}

        save_estimate("audio_file", 400.0, 2000000)

        # Should average: (200 + 400) / 2 = 300, (1000000 + 2000000) / 2 = 1500000
        mock_file.return_value.write.assert_called()
        args_list = mock_file.return_value.write.call_args_list
        written_data = "".join(call[0][0] for call in args_list)
        result = json.loads(written_data)

        self.assertEqual(result["audio_file"]["time"], 300.0)
        self.assertEqual(result["audio_file"]["size"], 1500000)

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_get_estimate_existing_type(self, mock_load):
        """Test get_estimate returns estimate for existing type."""
        mock_load.return_value = self.sample_estimates

        result = get_estimate("audio_file")

        self.assertEqual(result, {"time": 300.0, "size": 1024000})

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_get_estimate_nonexistent_type(self, mock_load):
        """Test get_estimate returns None for nonexistent type."""
        mock_load.return_value = self.sample_estimates

        result = get_estimate("nonexistent_type")

        self.assertIsNone(result)

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_estimate_total_processing_time_with_estimates(self, mock_load):
        """Test estimate_total_processing_time with available estimates."""
        mock_load.return_value = self.sample_estimates

        items = [
            {"status": "pending", "type": "audio_file", "file_size": 512000},
            {"status": "pending", "type": "youtube_video", "file_size": 1024000},
            {
                "status": "completed",
                "type": "audio_file",
                "file_size": 512000,
            },  # Should be skipped
        ]

        result = estimate_total_processing_time(items)

        # Audio: (300 / 1024000) * 512000 = 150 seconds
        # Video: (600 / 2048000) * 1024000 = 300 seconds
        # Total: 450 seconds / 4 processes = 112.5 seconds
        expected_seconds = int(450 / 4)
        self.assertEqual(result, timedelta(seconds=expected_seconds))

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_estimate_total_processing_time_no_estimates(self, mock_load):
        """Test estimate_total_processing_time uses defaults when no estimates available."""
        mock_load.return_value = {
            "audio_file": {"time": None, "size": None},
            "youtube_video": {"time": None, "size": None},
        }

        items = [
            {"status": "pending", "type": "audio_file", "file_size": 512000},
            {"status": "pending", "type": "youtube_video", "file_size": 1024000},
        ]

        result = estimate_total_processing_time(items)

        # Audio default: 300 seconds, Video default: 600 seconds
        # Total: 900 seconds / 4 processes = 225 seconds
        expected_seconds = int(900 / 4)
        self.assertEqual(result, timedelta(seconds=expected_seconds))

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_estimate_total_processing_time_mixed_estimates(self, mock_load):
        """Test estimate_total_processing_time with mixed available/unavailable estimates."""
        mock_load.return_value = {
            "audio_file": {"time": 250.0, "size": 1000000},
            "youtube_video": {"time": None, "size": None},
        }

        items = [
            {"status": "pending", "type": "audio_file", "file_size": 500000},
            {"status": "pending", "type": "youtube_video", "file_size": 1024000},
        ]

        result = estimate_total_processing_time(items)

        # Audio: (250 / 1000000) * 500000 = 125 seconds
        # Video: 600 seconds (default)
        # Total: 725 seconds / 4 processes = 181.25 seconds
        expected_seconds = int(725 / 4)
        self.assertEqual(result, timedelta(seconds=expected_seconds))

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_estimate_total_processing_time_no_file_size(self, mock_load):
        """Test estimate_total_processing_time uses average size when file_size is None."""
        mock_load.return_value = {"audio_file": {"time": 300.0, "size": 1024000}}

        items = [
            {"status": "pending", "type": "audio_file", "file_size": None},
        ]

        result = estimate_total_processing_time(items)

        # Should use average size: (300 / 1024000) * 1024000 = 300 seconds
        # Total: 300 seconds / 4 processes = 75 seconds
        expected_seconds = int(300 / 4)
        self.assertEqual(result, timedelta(seconds=expected_seconds))

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_estimate_total_processing_time_empty_items(self, mock_load):
        """Test estimate_total_processing_time with empty items list."""
        mock_load.return_value = self.sample_estimates

        result = estimate_total_processing_time([])

        self.assertEqual(result, timedelta(seconds=0))

    @patch("data_ingestion.audio_video.processing_time_estimates.load_estimates")
    def test_estimate_total_processing_time_invalid_types(self, mock_load):
        """Test estimate_total_processing_time ignores invalid item types."""
        mock_load.return_value = self.sample_estimates

        items = [
            {"status": "pending", "type": "invalid_type", "file_size": 512000},
            {"status": "pending", "type": "audio_file", "file_size": 512000},
        ]

        result = estimate_total_processing_time(items)

        # Only audio_file should be processed: (300 / 1024000) * 512000 = 150 seconds
        # Total: 150 seconds / 4 processes = 37.5 seconds
        expected_seconds = int(150 / 4)
        self.assertEqual(result, timedelta(seconds=expected_seconds))


if __name__ == "__main__":
    unittest.main()
