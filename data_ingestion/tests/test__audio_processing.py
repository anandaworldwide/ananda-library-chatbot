import unittest
import os
import logging
from openai import OpenAI
from pinecone import PineconeException
from unittest.mock import patch, MagicMock
from botocore.exceptions import ClientError
from argparse import ArgumentParser
from pyutil.env_utils import load_env
from data_ingestion.audio_video.IngestQueue import IngestQueue
from data_ingestion.audio_video.transcribe_and_ingest_media import process_file
from data_ingestion.audio_video.transcription_utils import TimeoutException, transcribe_media, chunk_transcription
from data_ingestion.audio_video.pinecone_utils import store_in_pinecone, load_pinecone, create_embeddings
from data_ingestion.audio_video.s3_utils import upload_to_s3, S3UploadError, upload_to_s3
from data_ingestion.audio_video.media_utils import get_media_metadata
from data_ingestion.tests.test_utils import trim_audio
import tempfile
import subprocess

def configure_logging(debug=False):
    # Configure the root logger
    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    # Configure specific loggers
    loggers_to_adjust = [
        "openai",
        "httpx",
        "httpcore",
        "boto3",
        "botocore",
        "urllib3",
        "s3transfer",
    ]
    for logger_name in loggers_to_adjust:
        logging.getLogger(logger_name).setLevel(
            logging.INFO if debug else logging.WARNING
        )

    return logging.getLogger(__name__)


# Configure logging (you can set debug=True here for more verbose output)
logger = configure_logging(debug=True)


def main():
    parser = ArgumentParser(description="Audio processing test")
    parser.add_argument('--site', required=True, help='Site ID for environment variables')
    args = parser.parse_args()

    # Load environment variables
    load_env(args.site)


class TestAudioProcessing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        parser = ArgumentParser()
        parser.add_argument('--site', default='ananda', help='Site ID for environment variables')
        args, _ = parser.parse_known_args()
        load_env(args.site)

    def setUp(self):
        # Update the path to use the correct relative path
        self.test_audio_path = os.path.abspath(os.path.join(
            os.path.dirname(__file__), 
            "..", 
            "media", "test", "unit-test-data", "how-to-commune-with-god.mp3"
        ))
        self.author = "Paramhansa Yogananda"
        self.library = "Ananda Sangha"
        self.client = OpenAI()
        self.queue = IngestQueue()
        logger.debug(f"Set up test with audio file: {self.test_audio_path}")
        self.trimmed_audio_path = trim_audio(self.test_audio_path)
        logger.debug(f"Created trimmed audio file: {self.trimmed_audio_path}")
        self.temp_files = [self.trimmed_audio_path]

    def tearDown(self):
        for temp_file in self.temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)
                logger.debug(f"Cleaned up temporary file: {temp_file}")
        self.temp_files = []

    def test_audio_metadata(self):
        logger.debug("Starting audio metadata test")
        title, author, duration, url, album = get_media_metadata(self.trimmed_audio_path)
        self.assertIsNotNone(title)
        self.assertIsNotNone(author)
        self.assertGreater(duration, 0)
        self.assertLessEqual(duration, 300.1, "Audio should be 5 minutes or less")
        self.assertIsNone(url)  # URL should be None for non-YouTube audio
        self.assertIsNotNone(album)  # Album should not be None for MP3 files
        logger.debug(
            f"Audio metadata test completed. Title: {title}, Author: {author}, Duration: {duration}, Album: {album}"
        )

    def test_transcription(self):
        logger.debug("Starting transcription test")
        transcription = transcribe_media(self.trimmed_audio_path)
        self.assertIsNotNone(transcription)
        self.assertIsInstance(transcription, list)
        self.assertTrue(len(transcription) > 0)
        self.assertIsInstance(transcription[0], dict)
        self.assertIn("text", transcription[0])
        self.assertIn("words", transcription[0])

    def test_chunk_transcription(self):
        logger.debug("Starting process transcription test")
        transcription = transcribe_media(self.trimmed_audio_path)
        chunks = chunk_transcription(transcription)
        self.assertIsNotNone(chunks)
        self.assertTrue(len(chunks) > 0)
        logger.debug(
            f"Process transcription test completed. Number of chunks: {len(chunks)}"
        )

    def test_pinecone_storage_success(self):
        logger.debug("Starting Pinecone storage success test")
        transcription = transcribe_media(self.trimmed_audio_path)
        chunks = chunk_transcription(transcription)

        self.assertTrue(chunks, "No chunks were generated")

        logger.debug(f"Number of chunks: {len(chunks)}")

        index = load_pinecone()

        # Create real embeddings using the existing library code
        embeddings = create_embeddings(chunks, self.client)

        logger.debug(
            f"Created {len(embeddings)} embeddings, each with {len(embeddings[0])} dimensions"
        )

        # Get metadata including album
        title, author, duration, url, album = get_media_metadata(self.trimmed_audio_path)

        try:
            store_in_pinecone(
                index,
                chunks,
                embeddings,
                author if author != "Unknown" else self.author,
                self.library,
                is_youtube_video=False,
                title=title,
                url=url,
                album=album
            )
            logger.debug("Pinecone storage success test completed")
        except PineconeException as e:
            self.fail(f"Pinecone storage failed unexpectedly: {str(e)}")

        # Add assertions to check if data was stored correctly
        self.assertGreater(len(chunks), 0, "Should have at least one chunk")
        self.assertTrue("text" in chunks[0], "Chunk should contain 'text'")
        self.assertTrue("start" in chunks[0], "Chunk should contain 'start'")
        self.assertTrue("end" in chunks[0], "Chunk should contain 'end'")

    def test_pinecone_storage_error(self):
        logger.debug("Starting Pinecone storage error test")
        transcription = transcribe_media(self.trimmed_audio_path)
        chunks = chunk_transcription(transcription)

        self.assertTrue(chunks, "No chunks were generated")

        logger.debug(f"Number of chunks: {len(chunks)}")

        index = load_pinecone()

        # Create real embeddings using the existing library code
        embeddings = create_embeddings(chunks, self.client)

        logger.debug(
            f"Created {len(embeddings)} embeddings, each with {len(embeddings[0])} dimensions"
        )

        # Simulate an error by patching the index.upsert method
        with patch.object(
            index, "upsert", side_effect=Exception("Simulated Pinecone error")
        ):
            # Expect a PineconeException to be raised
            with self.assertRaises(PineconeException) as context:
                store_in_pinecone(
                    index,
                    chunks,
                    embeddings,
                    self.author,
                    self.library,
                    is_youtube_video=False,
                )

        # Check if the error message contains the expected content
        self.assertIn("Failed to upsert vectors", str(context.exception))
        self.assertIn("Simulated Pinecone error", str(context.exception))

        logger.debug("Pinecone storage error test completed with expected error")

    def test_s3_upload_error_handling(self):
        logger.debug("Starting S3 upload error handling test")
        
        # Mock the S3 client to simulate an error
        with patch('data_ingestion.audio_video.s3_utils.get_s3_client') as mock_get_s3_client:
            mock_s3 = MagicMock()
            mock_s3.upload_file.side_effect = ClientError(
                {'Error': {'Code': 'TestException', 'Message': 'Test error message'}},
                'upload_file'
            )
            mock_get_s3_client.return_value = mock_s3

            # Attempt to upload the file, expecting an S3UploadError
            with self.assertRaises(S3UploadError) as context:
                upload_to_s3(self.trimmed_audio_path, "test_s3_key")

            # Check if the error message contains the expected content
            self.assertIn("Error uploading", str(context.exception))
            self.assertIn("Test error message", str(context.exception))

        logger.debug("S3 upload error handling test completed")

    def test_s3_upload_request_time_skewed(self):
        logger.debug("Starting S3 upload RequestTimeTooSkewed test")
        
        # Mock the S3 client to simulate a RequestTimeTooSkewed error
        with patch('data_ingestion.audio_video.s3_utils.get_s3_client') as mock_get_s3_client:
            mock_s3 = MagicMock()
            mock_s3.upload_file.side_effect = [
                ClientError(
                    {'Error': {'Code': 'RequestTimeTooSkewed', 'Message': 'Time skewed'}},
                    'upload_file'
                ),
                None  # Successful on second attempt
            ]
            mock_get_s3_client.return_value = mock_s3

            # Attempt to upload the file
            result = upload_to_s3(self.trimmed_audio_path, "test_s3_key")

            # Check that the upload was successful after retry
            self.assertIsNone(result)

            # Verify that upload_file was called twice
            self.assertEqual(mock_s3.upload_file.call_count, 2)

        logger.debug("S3 upload RequestTimeTooSkewed test completed")

    def test_chunk_transcription_timeout(self):
        logger.debug("Starting chunk transcription timeout test")
        
        # Mock the signal.alarm to simulate a timeout
        with patch('signal.alarm', side_effect=TimeoutException):
            try:
                transcription = transcribe_media(self.trimmed_audio_path)
                chunks = chunk_transcription(transcription)
            except TimeoutException:
                chunks = {"error": "chunk_transcription timed out."}
            self.assertIsInstance(chunks, dict)
            self.assertIn("error", chunks)
            self.assertEqual(chunks["error"], "chunk_transcription timed out.")
        
        logger.debug("Chunk transcription timeout test completed")

    def test_process_file_chunk_transcription_timeout(self):
        logger.debug("Starting process file chunk transcription timeout test")
        
        # Mock the chunk_transcription to simulate a timeout error
        with patch('data_ingestion.audio_video.transcribe_and_ingest_media.chunk_transcription', 
                   return_value={"error": "chunk_transcription timed out."}):
            report = process_file(
                self.trimmed_audio_path,
                MagicMock(),  # Mock pinecone index
                self.client,
                force=False,
                dryrun=False,
                default_author=self.author,
                library_name=self.library,
                is_youtube_video=False,
                youtube_data=None,
            )
            self.assertEqual(report["errors"], 1)
            self.assertIn("chunk_transcription timed out.", report["error_details"][0])
        
        logger.debug("Process file chunk transcription timeout test completed")

    def test_transcription_with_empty_audio(self):
        logger.debug("Starting transcription with empty audio test")
        
        # Create an empty audio file
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp_file:
            temp_file_path = temp_file.name
            self.temp_files.append(temp_file_path)
            
            # Create a valid but empty MP3 file
            subprocess.run(['ffmpeg', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-y', '-acodec', 'libmp3lame', '-b:a', '128k', temp_file_path], check=True)
            
            # Mock split_audio to return empty chunks
            with patch('data_ingestion.audio_video.media_utils.split_audio') as mock_split:
                mock_split.return_value = []
                transcription = transcribe_media(temp_file_path)
                
                self.assertIsNone(transcription, "Expected None for empty audio file")
        
        logger.debug("Transcription with empty audio test completed")

    def test_transcription_with_corrupted_audio(self):
        logger.debug("Starting transcription with corrupted audio test")
        
        # Create a corrupted audio file
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp_file:
            temp_file.write(b"This is not valid MP3 data")
            temp_file_path = temp_file.name
            self.temp_files.append(temp_file_path)
            
            # Test transcription with corrupted audio
            with self.assertRaises(Exception) as context:
                transcribe_media(temp_file_path)
            
            self.assertIn("Error", str(context.exception))
        
        logger.debug("Transcription with corrupted audio test completed")

    def test_pinecone_storage_with_empty_chunks(self):
        logger.debug("Starting Pinecone storage with empty chunks test")
        
        index = load_pinecone()
        empty_chunks = []
        empty_embeddings = []
        
        # Mock the index.upsert method to raise an exception
        with patch.object(index, 'upsert', side_effect=PineconeException("No chunks to store")):
            with self.assertRaises(PineconeException) as context:
                store_in_pinecone(
                    index,
                    empty_chunks,
                    empty_embeddings,
                    self.author,
                    self.library,
                    is_youtube_video=False
                )
            
            self.assertIn("No chunks to store", str(context.exception))
        logger.debug("Pinecone storage with empty chunks test completed")

    def test_process_file_with_invalid_path(self):
        logger.debug("Starting process file with invalid path test")
        
        invalid_path = "/path/to/nonexistent/file.mp3"
        report = process_file(
            invalid_path,
            MagicMock(),  # Mock pinecone index
            self.client,
            force=False,
            dryrun=False,
            default_author=self.author,
            library_name=self.library,
            is_youtube_video=False,
            youtube_data=None,
        )
        
        self.assertEqual(report["errors"], 1)
        self.assertIn("No such file or directory", report["error_details"][0])
        logger.debug("Process file with invalid path test completed")


if __name__ == "__main__":
    main()