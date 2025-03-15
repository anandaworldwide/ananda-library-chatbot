"""
Tests for transcribe_and_ingest_media.py script functionality.

Tests cover:
1. Metadata verification and updates
2. Process file error handling
3. Report merging
4. Edge cases and error conditions
5. File processing pipeline
"""

import pytest
import os
import time
import json
import gzip
import io
import hashlib
from unittest.mock import Mock, patch, MagicMock, PropertyMock, mock_open, create_autospec
from data_ingestion.scripts.transcribe_and_ingest_media import (
    verify_and_update_transcription_metadata,
    process_file,
    merge_reports,
    process_item,
    preprocess_youtube_video,
    worker
)
from data_ingestion.scripts.transcription_utils import RateLimitError, UnsupportedAudioFormatError
from data_ingestion.scripts.s3_utils import S3UploadError
from multiprocessing import Queue, Event
from openai import RateLimitError, APIError, APIStatusError

@pytest.fixture
def sample_transcription_data():
    return {
        'text': 'Sample transcription text',
        'words': [{'word': 'Sample', 'start': 0.0, 'end': 0.5}],
    }

@pytest.fixture
def sample_youtube_data():
    return {
        'youtube_id': 'test123',
        'media_metadata': {
            'title': 'Test Video',
            'url': 'https://youtube.com/watch?v=test123',
            'duration': 120,
            'upload_date': '20240101',
            'channel': 'Test Channel',
            'view_count': 1000,
            'description': 'Test description'
        }
    }

def test_verify_metadata_basic_audio():
    """Test metadata verification for basic audio file"""
    transcription = "Just a text string"
    file_path = "test.mp3"
    author = "Test Author"
    library = "Test Library"
    
    result = verify_and_update_transcription_metadata(
        transcription, file_path, author, library, False
    )
    
    assert isinstance(result, dict)
    assert result['text'] == transcription
    assert result['file_path'] == file_path
    assert result['author'] == author
    assert result['library'] == library
    assert result['type'] == "audio_file"
    assert result['media_type'] == "audio"
    assert 'created_at' in result
    assert 'updated_at' in result

def test_verify_metadata_youtube(sample_transcription_data, sample_youtube_data):
    """Test metadata verification for YouTube content"""
    result = verify_and_update_transcription_metadata(
        sample_transcription_data,
        None,
        "Test Author",
        "Test Library",
        True,
        sample_youtube_data
    )
    
    assert result['title'] == sample_youtube_data['media_metadata']['title']
    assert result['source_url'] == sample_youtube_data['media_metadata']['url']
    assert result['youtube_id'] == sample_youtube_data['youtube_id']
    assert result['type'] == "youtube"
    assert result['media_type'] == "video"

def test_process_file_private_video():
    """Test handling of private YouTube videos"""
    youtube_data = {
        'url': 'https://youtube.com/watch?v=private123',
        'error': 'private_video'
    }
    
    result = process_file(
        None, None, None, False, False,
        "Test Author", "Test Library",
        is_youtube_video=True,
        youtube_data=youtube_data
    )
    
    assert result['private_videos'] == 1
    assert result['errors'] == 0
    assert len(result['error_details']) == 1
    assert 'Private video' in result['error_details'][0]

def test_merge_reports():
    """Test report merging functionality"""
    reports = [
        {
            'processed': 1,
            'skipped': 0,
            'errors': 1,
            'error_details': ['Error 1'],
            'warnings': ['Warning 1'],
            'fully_indexed': 1,
            'chunk_lengths': [100],
            'private_videos': 1
        },
        {
            'processed': 2,
            'skipped': 1,
            'errors': 0,
            'error_details': [],
            'warnings': ['Warning 2'],
            'fully_indexed': 2,
            'chunk_lengths': [200, 300],
            'private_videos': 0
        }
    ]
    
    merged = merge_reports(reports)
    
    assert merged['processed'] == 3
    assert merged['skipped'] == 1
    assert merged['errors'] == 1
    assert len(merged['error_details']) == 1
    assert len(merged['warnings']) == 2
    assert merged['fully_indexed'] == 3
    assert len(merged['chunk_lengths']) == 3
    assert merged['private_videos'] == 1

def test_verify_metadata_legacy_format():
    """Test handling of legacy format transcription data"""
    legacy_text = "This is legacy text only format"
    result = verify_and_update_transcription_metadata(
        legacy_text, "test.mp3", "Test Author", "Test Library", False
    )
    
    assert isinstance(result, dict)
    assert result['text'] == legacy_text
    assert isinstance(result['words'], list)
    assert len(result['words']) == 0
    assert result['type'] == "audio_file"

@patch('os.path.exists')
@patch('data_ingestion.scripts.media_utils.get_media_metadata')
@patch('os.stat')
@patch('data_ingestion.scripts.media_utils.MP3')
@patch('os.makedirs')
@patch('builtins.open', new_callable=mock_open)
def test_verify_metadata_with_file_stats(mock_file, mock_makedirs, mock_mp3, mock_stat, mock_get_metadata, mock_exists):
    """Test metadata verification with file statistics"""
    mock_exists.return_value = True
    mock_get_metadata.return_value = ("Test Title", "File Author", 120, None, "Test Album")
    mock_stat.return_value = Mock(st_size=1024)
    
    # Create proper mock tag objects with list-like behavior
    class MockTag:
        def __init__(self, text):
            self.text = text
        def __getitem__(self, idx):
            return self.text[idx]
    
    mock_tags = Mock()
    mock_tags.get.side_effect = lambda key, default=None: {
        "TIT2": MockTag(["Test Title"]),
        "TPE1": MockTag(["File Author"]),
        "TALB": MockTag(["Test Album"]),
        "COMM:url:eng": MockTag(["http://example.com"])
    }.get(key, default)
    
    # Set up MP3 mock with proper __getitem__ behavior
    mock_mp3_instance = Mock()
    mock_mp3_instance.tags = mock_tags
    mock_mp3_instance.info = Mock(length=120)
    mock_mp3.return_value = mock_mp3_instance

    transcription_data = {
        "text": "test",
        "words": [{"word": "test", "start": 0, "end": 1}]
    }

    result = verify_and_update_transcription_metadata(
        transcription_data, "test.mp3", None, "Test Library", False
    )

    assert isinstance(result, dict)
    assert result["title"] == "Test Title"
    assert result["author"] == "File Author"
    assert result["duration"] == 120
    assert result["album"] == "Test Album"
    assert result["file_name"] == "test.mp3"
    assert result["file_size"] == 1024

def test_preprocess_youtube_private():
    """Test preprocessing of private YouTube videos"""
    with patch('data_ingestion.scripts.youtube_utils.download_youtube_audio') as mock_download:
        mock_download.return_value = None
        result, youtube_id = preprocess_youtube_video(
            "https://youtube.com/watch?v=private123",
            Mock()
        )
        assert result is None
        assert youtube_id is None

def test_merge_reports_empty():
    """Test merging empty reports"""
    reports = [
        {},
        {"processed": 0, "errors": 0},
        {"warnings": [], "chunk_lengths": []}
    ]
    
    merged = merge_reports(reports)
    
    assert merged['processed'] == 0
    assert merged['errors'] == 0
    assert merged['warnings'] == []
    assert merged['chunk_lengths'] == [] 