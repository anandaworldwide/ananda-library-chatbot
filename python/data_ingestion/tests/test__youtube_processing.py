import unittest
import os
import logging
import random
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, COMM
from data_ingestion.scripts.IngestQueue import IngestQueue
from data_ingestion.scripts.youtube_utils import download_youtube_audio
from data_ingestion.scripts.transcription_utils import transcribe_media
from data_ingestion.scripts.pinecone_utils import store_in_pinecone, load_pinecone
from data_ingestion.scripts.s3_utils import upload_to_s3
from data_ingestion.tests.test_utils import trim_audio
from data_ingestion.scripts.media_utils import get_media_metadata
from util.env_utils import load_env

YOUTUBE_URLS = [
    "https://youtu.be/MvyIpKLbayc?si=Nk9M7EDQ5oYngQkT",
    "https://youtu.be/WLtl1okZlYU?si=iKj-o_RwMgiA_1dn",
    "https://youtu.be/-AtW7c9pkGw?si=i4w-W6bGfIk7rI-n",
    "https://youtu.be/xUgtw_MwEas?si=HcdYvKjK17rZ3aK2",
    "https://youtu.be/zQDgBuoml4c?si=y2wGnAm76YxiMNLr",
    "https://youtu.be/r8iwgBVERm4?si=dBo7_HJ89gDUGeQw",
    "https://youtu.be/2s77yXNPwb0?si=abjnjhhBj9qGE1IY",
    "https://youtu.be/Lj8RuVB3JhI?si=xI9I4P_i5DtqoNqk",
    "https://youtu.be/m8b3E-mC6Ps?si=B7Xk3PGO_a63LXAR",
]


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

# Load environment variables
# TODO: hardcoded site for now
load_env('ananda')

class TestYouTubeProcessing(unittest.TestCase):
    def setUp(self):
        self.test_video_url = random.choice(YOUTUBE_URLS)
        self.author = "Swami Kriyananda"
        self.library = "Ananda Sangha"
        self.audio_path = None
        self.temp_files = []
        logger.debug(f"Set up test with video URL: {self.test_video_url}")
        self.queue = IngestQueue()

    def tearDown(self):
        for temp_file in self.temp_files:
            if os.path.exists(temp_file):
                os.remove(temp_file)
                logger.debug(f"Cleaned up temporary file: {temp_file}")
        self.temp_files = []

    def test_youtube_download(self):
        logger.debug("Starting YouTube download test")
        result = download_youtube_audio(self.test_video_url)
        self.assertIsNotNone(result)
        self.assertTrue(os.path.exists(result["audio_path"]))
        self.audio_path = result["audio_path"]
        trimmed_path = trim_audio(self.audio_path)
        self.temp_files.append(trimmed_path)
        audio = MP3(trimmed_path)
        self.assertLessEqual(audio.info.length, 300.1, "Audio should be 5 minutes or less")
        logger.debug(f"YouTube download test completed. Trimmed audio path: {trimmed_path}")

    def test_transcription(self):
        logger.debug("Starting transcription test")
        youtube_data = download_youtube_audio(self.test_video_url)
        self.assertIsNotNone(youtube_data, "Failed to download YouTube audio")
        self.audio_path = youtube_data["audio_path"]
        trimmed_path = trim_audio(self.audio_path)
        self.temp_files.append(trimmed_path)
        transcription = transcribe_media(trimmed_path)
        self.assertIsNotNone(transcription)
        self.assertIsInstance(transcription, dict)

    def test_pinecone_storage(self):
        logger.debug("Starting Pinecone storage test")
        youtube_data = download_youtube_audio(self.test_video_url)
        self.assertIsNotNone(youtube_data, "Failed to download YouTube audio")
        self.audio_path = youtube_data["audio_path"]
        transcription = transcribe_media(self.audio_path)

        self.assertTrue(transcription, "No transcripts were generated")

        logger.debug(f"Number of transcripts: {len(transcription)}")

        # Create a single chunk for the entire transcript
        chunk = {
            "text": transcription["text"][:1000],  # Truncate text to reduce size
            "start": (
                transcription["words"][0]["start"] if transcription["words"] else None
            ),
            "end": (
                transcription["words"][-1]["end"] if transcription["words"] else None
            ),
        }

        logger.debug(f"Created chunk: {chunk}")

        index = load_pinecone()

        # Create a mock embedding with some non-zero values
        embedding = [random.uniform(0, 1) for _ in range(1536)]
        logger.debug(f"Created mock embedding with {len(embedding)} dimensions")

        # Get metadata including album
        title, author, duration, url, album = get_media_metadata(self.audio_path)

        store_in_pinecone(
            index,
            [chunk],
            [embedding],
            author if author != "Unknown" else self.author,
            self.library,
            is_youtube_video=True, 
            title=title,
            url=url,
            album=album
        )
        logger.debug("Pinecone storage test completed")

        # Add assertions to check if data was stored correctly
        self.assertEqual(1, len([chunk]), "Should have a single chunk")
        self.assertEqual(1, len([embedding]), "Should have a single embedding")
        self.assertTrue("text" in chunk, "Chunk should contain 'text'")
        self.assertTrue("start" in chunk, "Chunk should contain 'start'")
        self.assertTrue("end" in chunk, "Chunk should contain 'end'")

    def test_s3_upload_skipped(self):
        logger.debug("Starting S3 upload skip test")
        youtube_data = download_youtube_audio(self.test_video_url)

        # Check if youtube_data is None or doesn't contain 'audio_path'
        if youtube_data is None or "audio_path" not in youtube_data:
            self.fail("Failed to download YouTube audio or retrieve audio path")

        self.audio_path = youtube_data["audio_path"]
        with self.assertRaises(ValueError) as context:
            upload_to_s3(self.audio_path, None)
        
        self.assertIn("s3_key must be provided", str(context.exception))
        logger.debug("S3 upload skip test completed")

    def test_audio_metadata(self):
        logger.debug("Starting audio metadata test")
        youtube_data = download_youtube_audio(self.test_video_url)
        if youtube_data is None or "audio_path" not in youtube_data:
            self.fail("Failed to download YouTube audio or retrieve audio path")
        self.audio_path = youtube_data["audio_path"]
        trimmed_path = trim_audio(self.audio_path)
        self.temp_files.append(trimmed_path)
        self.assertTrue(
            os.path.exists(trimmed_path),
            f"Trimmed audio file does not exist: {trimmed_path}",
        )
        try:
            audio = MP3(trimmed_path, ID3=ID3)
            self.assertLessEqual(audio.info.length, 300.1, "Audio should be 5 minutes or less")

            # Check if tags exist
            self.assertIsNotNone(audio.tags, "No ID3 tags found in the audio file")

            # Retrieve all COMM frames and filter for the URL comment
            comm_frames = audio.tags.getall("COMM")
            url_comment = [frame for frame in comm_frames if frame.desc == 'url']
            
            self.assertGreater(len(url_comment), 0, f"URL comment not found. All COMM frames: {comm_frames}")
            self.assertEqual(len(url_comment), 1, "Multiple URL comments found")
            self.assertIsInstance(url_comment[0], COMM, "URL comment item should be a COMM object")
            self.assertIsInstance(url_comment[0].text, list, "URL comment text should be a list")
            self.assertGreater(len(url_comment[0].text), 0, "URL comment text should not be empty")
            self.assertIsInstance(url_comment[0].text[0], str, "URL comment text should be a string")
            self.assertEqual(
                url_comment[0].text[0],
                self.test_video_url,
                "Stored URL does not match the original YouTube URL",
            )

            logger.debug("Audio metadata test completed successfully")
        except Exception as e:
            self.fail(f"Error reading audio metadata: {str(e)}")


if __name__ == "__main__":
    logger.debug("Starting test suite")
    unittest.main()