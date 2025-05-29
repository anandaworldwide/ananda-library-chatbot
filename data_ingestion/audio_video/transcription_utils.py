import gzip
import hashlib
import json
import logging
import os
import re
import signal
import sqlite3
import tempfile
from datetime import datetime

from openai import APIConnectionError, APIError, APITimeoutError, OpenAI
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from tqdm import tqdm

from data_ingestion.audio_video.media_utils import (
    get_file_hash,
    get_media_metadata,
    split_audio,
)
from data_ingestion.audio_video.youtube_utils import (
    load_youtube_data_map,
    save_youtube_data_map,
)

logger = logging.getLogger(__name__)

TRANSCRIPTIONS_DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "media", "transcriptions.db")
)
TRANSCRIPTIONS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "media", "transcriptions")
)

# Global list to store chunk lengths
chunk_lengths = []


class UnsupportedAudioFormatError(Exception):
    pass


class RateLimitError(Exception):
    """Custom exception for rate limit errors"""

    pass


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    retry=(
        retry_if_exception_type(APIConnectionError)
        | retry_if_exception_type(APITimeoutError)
        | retry_if_exception_type(APIError)
    ),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
def transcribe_chunk(
    client, chunk, previous_transcript=None, cumulative_time=0, file_name=""
):
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as temp_file:
            chunk.export(temp_file.name, format="mp3")
            chunk_size = os.path.getsize(temp_file.name)

            with open(temp_file.name, "rb") as audio_file:
                transcription_options = {
                    "file": audio_file,
                    "model": "whisper-1",
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["word"],
                }

                if previous_transcript:
                    transcription_options["prompt"] = previous_transcript

                transcript = client.audio.transcriptions.create(**transcription_options)

        os.unlink(temp_file.name)
        transcript_dict = transcript.model_dump()

        if "words" not in transcript_dict:
            logger.error(
                f"'words' not found in transcript. Full response: {transcript_dict}"
            )
            return None

        # Adjust timestamps for words
        for word in transcript_dict["words"]:
            word["start"] = round(word["start"] + cumulative_time, 2)
            word["end"] = round(word["end"] + cumulative_time, 2)

        # Create a simplified structure similar to the old 'segments' format
        simplified_transcript = {
            "text": transcript_dict["text"],
            "words": transcript_dict["words"],
        }

        return simplified_transcript
    except (APIConnectionError, APITimeoutError) as e:
        logger.warning(
            f"OpenAI API connection error for file {file_name}: {e}. Retrying..."
        )
        raise
    except APIError as e:
        if e.status_code == 429:
            logger.error(f"OpenAI API rate limit exceeded for file {file_name}: {e}")
            raise RateLimitError("Rate limit exceeded") from e
        elif (
            e.status_code == 400 and "audio file could not be decoded" in str(e).lower()
        ):
            logger.error(
                f"OpenAI API error for file {file_name}: {e}. Unsupported audio format."
            )
            raise UnsupportedAudioFormatError(
                f"Unsupported audio format for file {file_name}"
            ) from e
        logger.error(f"OpenAI API error for file {file_name}: {e}")
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error transcribing chunk for file {file_name}: {str(e)}"
        )
        logger.error(
            f"Full response: {transcript_dict if 'transcript_dict' in locals() else 'Not available'}"
        )
        logger.error(f"Chunk size: {chunk_size / (1024 * 1024):.2f} MB")
        raise


def init_db():
    """Initialize SQLite database for transcription indexing."""
    os.makedirs(os.path.dirname(TRANSCRIPTIONS_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(TRANSCRIPTIONS_DB_PATH)
    c = conn.cursor()

    # Check if the table already exists
    c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='transcriptions'"
    )
    if not c.fetchone():
        c.execute(
            """CREATE TABLE IF NOT EXISTS transcriptions
                     (file_hash TEXT PRIMARY KEY, file_path TEXT, timestamp REAL, json_file TEXT)"""
        )
        logger.info("Created 'transcriptions' table in the database.")
    else:
        logger.info("'transcriptions' table already exists in the database.")

    conn.commit()
    conn.close()


def get_saved_transcription(file_path, is_youtube_video=False, youtube_id=None):
    """
    Retrieve transcription for a given file or YouTube video.

    This function loads the saved transcription from the corresponding gzipped JSON file,
    if it exists.

    For Youtube videos, file_path is None
    """

    if is_youtube_video:
        if not youtube_id:
            raise ValueError("YouTube ID is required for YouTube videos")
        youtube_data_map = load_youtube_data_map()
        youtube_data = youtube_data_map.get(youtube_id)

        if youtube_data:
            # erase any audio path stored with youtube data as it's bogus (from prior run)
            youtube_data.pop("audio_path", None)
            file_hash = youtube_data["file_hash"]
        else:
            return None
    else:
        file_hash = get_file_hash(file_path)

    try:
        conn = sqlite3.connect(TRANSCRIPTIONS_DB_PATH)
        c = conn.cursor()
        c.execute(
            "SELECT json_file FROM transcriptions WHERE file_hash = ?", (file_hash,)
        )
        result = c.fetchone()
        conn.close()
    except sqlite3.OperationalError:
        logger.warning(
            f"Database file not found or inaccessible. Initializing new database at {TRANSCRIPTIONS_DB_PATH}"
        )
        init_db()
        return None

    if result:
        json_file = result[0]
        logger.info(
            f"get_transcription: Using existing transcription for {'YouTube video' if is_youtube_video else 'file'} {youtube_id or file_path} ({file_hash})"
        )

        # Ensure we're using the full path to the JSON file
        full_json_path = os.path.join(TRANSCRIPTIONS_DIR, json_file)
        if os.path.exists(full_json_path):
            with gzip.open(full_json_path, "rt", encoding="utf-8") as f:
                return json.load(f)
        else:
            logger.warning(f"JSON file not found at {full_json_path}")
    return None


def save_transcription(file_path, transcripts, youtube_id=None):
    """
    Save transcription to gzipped JSON file and update database.

    Args:
        file_path: Path to original audio file (or None for YouTube)
        transcripts: List of transcription segments or dict with transcription data
        youtube_id: YouTube video ID if applicable
    """
    # Generate hash based on either file_path or youtube_id
    if youtube_id:
        youtube_data_map = load_youtube_data_map()
        youtube_data = youtube_data_map.get(youtube_id)
        if youtube_data and "file_hash" in youtube_data:
            file_hash = youtube_data["file_hash"]
        else:
            file_hash = hashlib.md5(youtube_id.encode()).hexdigest()
    else:
        file_hash = get_file_hash(file_path)

    # Convert list of transcripts to expected format if needed
    if isinstance(transcripts, list):
        transcription_data = {
            "file_path": file_path,
            "youtube_id": youtube_id,
            "text": " ".join(segment.get("text", "") for segment in transcripts),
            "words": [
                word for segment in transcripts for word in segment.get("words", [])
            ],
            "timestamp": datetime.utcnow().isoformat(),
            "media_type": "video" if youtube_id else "audio",
        }
    else:
        transcription_data = transcripts
        transcription_data["file_path"] = file_path
        transcription_data["timestamp"] = datetime.utcnow().isoformat()
        transcription_data["media_type"] = "video" if youtube_id else "audio"
        if youtube_id:
            transcription_data["youtube_id"] = youtube_id

    if youtube_id:
        youtube_data_map = load_youtube_data_map()
        if (
            youtube_id in youtube_data_map
            and "media_metadata" in youtube_data_map[youtube_id]
        ):
            metadata = youtube_data_map[youtube_id]["media_metadata"]
            transcription_data["youtube_metadata"] = {
                "title": metadata.get("title"),
                "url": metadata.get("url"),
            }

    # Generate unique filename based on content
    json_filename = f"{file_hash}.json.gz"
    json_filepath = os.path.join(TRANSCRIPTIONS_DIR, json_filename)

    # Ensure transcriptions directory exists
    os.makedirs(TRANSCRIPTIONS_DIR, exist_ok=True)

    # Save to gzipped JSON file
    with gzip.open(json_filepath, "wt", encoding="utf-8") as f:
        json.dump(transcription_data, f)

    # Update database
    try:
        conn = sqlite3.connect(TRANSCRIPTIONS_DB_PATH)
        c = conn.cursor()
        c.execute(
            "INSERT OR REPLACE INTO transcriptions (file_hash, json_file, file_path, timestamp) VALUES (?, ?, ?, ?)",
            (file_hash, json_filename, file_path, transcription_data["timestamp"]),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as e:
        logger.error(f"Database error: {e}")
        raise

    # Create a meaningful identifier for logging
    if youtube_id:
        file_identifier = f"YouTube video {youtube_id}"
    elif file_path:
        file_identifier = f"file {file_path}"
    else:
        file_identifier = f"transcription {file_hash[:8]}"

    logger.info(f"Transcription metadata updated for {file_identifier}")
    logger.info(f"Transcription json: {json_filepath}")


def transcribe_media(
    file_path,
    force=False,
    is_youtube_video=False,
    youtube_id=None,
    interrupt_event=None,
):
    """
    Transcribe audio file, using existing transcription if available and not forced.

    This function first checks for an existing transcription using the hybrid storage system.
    If not found or if force is True, it performs the transcription and saves the result.
    """

    file_name = os.path.basename(file_path) if file_path else f"YouTube_{youtube_id}"

    existing_transcription = get_saved_transcription(
        file_path, is_youtube_video, youtube_id
    )
    if existing_transcription and not force:
        logger.debug("transcribe_media: Using existing transcription")
        return existing_transcription

    client = OpenAI()

    # Validate we have a file to process
    if not file_path:
        logger.error("No file path provided for transcription")
        if is_youtube_video:
            logger.error("YouTube video processing requires downloaded audio file path")
        return None

    logger.info(f"Splitting audio into chunks for {file_name}...")

    try:
        # Split the audio into chunks
        chunks = split_audio(file_path)

        logger.info(f"Audio split into {len(chunks)} chunks for {file_name}")

        transcripts = []
        previous_transcript = None
        cumulative_time = 0

        for i, chunk in enumerate(
            tqdm(chunks, desc=f"Transcribing chunks for {file_name}", unit="chunk")
        ):
            if interrupt_event and interrupt_event.is_set():
                logger.info("Interrupt detected. Stopping transcription...")
                break

            try:
                transcript = transcribe_chunk(
                    client, chunk, previous_transcript, cumulative_time, file_name
                )
                if transcript:
                    transcripts.append(transcript)
                    previous_transcript = transcript["text"]
                    cumulative_time += chunk.duration_seconds
                else:
                    logger.error(
                        f"Empty or invalid transcript for chunk {i + 1} in {file_name}"
                    )
            except RateLimitError:
                logger.error("Rate limit exceeded. Terminating process.")
                return None
            except UnsupportedAudioFormatError as e:
                logger.error(f"{e}. Stopping processing for file {file_name}.")
                return None
            except Exception as e:
                logger.error(
                    f"Error transcribing chunk {i + 1} for file {file_name}. Exception: {str(e)}"
                )
                raise  # Re-raise the exception to be caught by the outer try-except

        if len(transcripts) < len(chunks):
            logger.error(
                f"Failed. Not all chunks were successfully transcribed for {file_name}. {len(transcripts)} out of {len(chunks)} chunks processed."
            )
            return None

        if transcripts:
            save_transcription(
                file_path, transcripts, youtube_id if is_youtube_video else None
            )
            return transcripts

        logger.error(f"No transcripts generated for {file_name}")
        return None

    except Exception as e:
        logger.error(f"Error in transcribe_media for {file_name}: {str(e)}")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error details: {str(e)}")
        logger.exception("Full traceback:")
        raise  # Re-raise the exception after logging


def combine_small_chunks(chunks, min_chunk_size, max_chunk_size):
    i = 0
    while i < len(chunks) - 1:
        current_chunk = chunks[i]
        next_chunk = chunks[i + 1]

        if (
            len(current_chunk["words"]) < min_chunk_size
            or len(next_chunk["words"]) < min_chunk_size
        ):
            if len(current_chunk["words"]) + len(next_chunk["words"]) <= max_chunk_size:
                # Combine chunks
                time_offset = current_chunk["end"] - next_chunk["start"]
                for word in next_chunk["words"]:
                    word["start"] += time_offset
                    word["end"] += time_offset
                current_chunk["text"] += " " + next_chunk["text"]
                current_chunk["end"] = next_chunk["end"]
                current_chunk["words"].extend(next_chunk["words"])
                chunks.pop(i + 1)
            else:
                # Move to next chunk if combining would exceed max_chunk_size
                i += 1
        else:
            i += 1

    return chunks


class TimeoutException(Exception):
    pass


def timeout_handler(signum, frame):
    raise TimeoutException()


def chunk_transcription(transcript, target_chunk_size=150, overlap=75):
    """
    Chunk transcription using spaCy-based semantic chunking with dynamic sizing.

    This function now uses the SpacyTextSplitter for semantic chunking while preserving
    audio-specific features like timestamps.

    Args:
        transcript: Transcript object with 'text' and 'words' fields
        target_chunk_size: Legacy parameter, now ignored (dynamic sizing used)
        overlap: Legacy parameter, now ignored (dynamic overlap used)

    Returns:
        List of chunk dictionaries with text, start/end times, and word arrays
    """
    global chunk_lengths  # Ensure we are using the global list
    chunks = []

    # Handle case where transcript is a list of transcripts
    # michaelo 11/22/24: I'm guessing this is what happened when I got a string instead of a transcript object
    if isinstance(transcript, list):
        # Combine all words from the transcripts
        all_words = []
        full_text = ""
        for t in transcript:
            all_words.extend(t.get("words", []))
            full_text += " " + t.get("text", "")
        transcript = {"words": all_words, "text": full_text.strip()}

    words = transcript["words"]
    original_text = transcript["text"]
    total_words = len(words)

    logger.debug(f"Starting spaCy-based chunk_transcription with {total_words} words.")

    if not words or not original_text.strip():
        logger.warning("Transcription is empty or invalid.")
        return chunks

    # Filter out music chunks
    original_word_count = len(words)
    words = [word for word in words if not re.match(r"^[♪🎵🎶♫♬🔊]+$", word["word"])]
    total_words = len(words)
    if total_words != original_word_count:
        logger.debug(f"Filtered out music chunks. Remaining words: {total_words}")

    # Set a timeout for the function
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(60)

    try:
        # Import and use SpacyTextSplitter for semantic chunking guidance
        from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

        # Initialize spaCy text splitter to get dynamic chunk sizing
        text_splitter = SpacyTextSplitter(
            separator="\n\n",  # Paragraph-based chunking
            pipeline="en_core_web_sm",
        )

        # Set dynamic chunk size based on content length (but work with words, not text)
        word_count = len(words)
        text_splitter._set_dynamic_chunk_size(word_count)
        target_words_per_chunk = int(
            text_splitter.chunk_size / 2.0
        )  # More aggressive conversion to reach target word range

        logger.debug(
            f"Dynamic target: ~{target_words_per_chunk} words per chunk based on {word_count} total words"
        )

        # Chunk directly using timestamped words to preserve exact timestamps
        # This approach maintains perfect timestamp accuracy
        word_index = 0
        chunk_idx = 0

        while word_index < len(words):
            # Determine chunk size for this chunk
            remaining_words = len(words) - word_index
            if (
                remaining_words <= target_words_per_chunk * 1.3
            ):  # If close to target, take all remaining
                chunk_size = remaining_words
            else:
                chunk_size = target_words_per_chunk

            # Get the words for this chunk
            end_index = min(word_index + chunk_size, len(words))
            chunk_words = words[word_index:end_index]

            if not chunk_words:
                break

            # Extract the corresponding text segment from the original text to preserve punctuation
            start_time = chunk_words[0]["start"]
            end_time = chunk_words[-1]["end"]

            # Build a regex pattern to match the words in the current chunk
            pattern = (
                r"\b"
                + r"\W*".join(re.escape(word["word"]) for word in chunk_words)
                + r"[\W]*"
            )

            match = re.search(pattern, original_text)
            if match:
                chunk_text = match.group(0)
                # Ensure the chunk ends with punctuation if present
                end_pos = match.end()
                while end_pos < len(original_text) and re.match(
                    r"\W", original_text[end_pos]
                ):
                    end_pos += 1
                chunk_text = original_text[match.start() : end_pos]
            else:
                # Fallback to word joining if regex match fails
                chunk_text = " ".join(word_obj["word"] for word_obj in chunk_words)

            chunks.append(
                {
                    "text": chunk_text,
                    "start": start_time,
                    "end": end_time,
                    "words": chunk_words,
                }
            )

            # Store the length of the current chunk
            chunk_lengths.append(len(chunk_words))

            # Move to next chunk with overlap if configured
            overlap_words = min(
                target_words_per_chunk // 4, len(chunk_words) // 4
            )  # 25% overlap
            word_index = end_index - overlap_words
            chunk_idx += 1

            logger.debug(
                f"Created chunk {chunk_idx}: {len(chunk_words)} words, {start_time:.2f}s-{end_time:.2f}s"
            )

        # Log chunk statistics with new spaCy-based approach
        if chunks:
            chunk_word_counts = [len(chunk["words"]) for chunk in chunks]
            avg_words = sum(chunk_word_counts) / len(chunk_word_counts)
            target_range_chunks = sum(
                1 for count in chunk_word_counts if 225 <= count <= 450
            )
            target_percentage = (target_range_chunks / len(chunks)) * 100

            logger.info(
                f"SpaCy chunking results: {len(chunks)} chunks, avg {avg_words:.1f} words/chunk"
            )
            logger.info(
                f"Target range (225-450 words): {target_range_chunks}/{len(chunks)} chunks ({target_percentage:.1f}%)"
            )

            # Warn about very small chunks (but don't fail)
            small_chunks = [
                i for i, count in enumerate(chunk_word_counts) if count < 30
            ]
            if small_chunks:
                logger.warning(
                    f"Found {len(small_chunks)} chunks with <30 words: {small_chunks[:5]}"
                )

        logger.debug(
            f"Finished spaCy-based chunk_transcription with {len(chunks)} chunks."
        )

    except TimeoutException:
        logger.error("chunk_transcription timed out.")
        return {"error": "chunk_transcription timed out."}
    except Exception as e:
        logger.error(
            f"Error in spaCy-based chunking, falling back to legacy method: {str(e)}"
        )
        # Fall back to legacy chunking if spaCy fails
        return _legacy_chunk_transcription(transcript, target_chunk_size, overlap)
    finally:
        signal.alarm(0)  # Disable the alarm

    return chunks


def _legacy_chunk_transcription(transcript, target_chunk_size=150, overlap=75):
    """
    Legacy word-based chunking method as fallback.

    This is the original chunking implementation, kept as a fallback
    in case the spaCy-based chunking fails.
    """
    global chunk_lengths
    chunks = []
    words = transcript["words"]
    original_text = transcript["text"]
    total_words = len(words)

    logger.debug(f"Using legacy chunk_transcription with {total_words} words.")

    # Calculate the number of chunks needed
    num_chunks = (total_words + target_chunk_size - 1) // target_chunk_size
    # Adjust chunk size to ensure even distribution
    adjusted_chunk_size = (total_words + num_chunks - 1) // num_chunks

    i = 0
    while i < total_words:
        end_index = min(i + adjusted_chunk_size, total_words)
        current_chunk = words[i:end_index]
        if not current_chunk:
            break

        # Extract the corresponding text segment from the original text
        start_time = current_chunk[0]["start"]
        end_time = current_chunk[-1]["end"]

        # Build a regex pattern to match the words in the current chunk
        pattern = (
            r"\b"
            + r"\W*".join(re.escape(word["word"]) for word in current_chunk)
            + r"[\W]*"
        )

        match = re.search(pattern, original_text)
        if match:
            chunk_text = match.group(0)
            # Ensure the chunk ends with punctuation if present
            end_pos = match.end()
            while end_pos < len(original_text) and re.match(
                r"\W", original_text[end_pos]
            ):
                end_pos += 1
            chunk_text = original_text[match.start() : end_pos]
        else:
            chunk_text = " ".join(word["word"] for word in current_chunk)

        chunks.append(
            {
                "text": chunk_text,
                "start": start_time,
                "end": end_time,
                "words": current_chunk,
            }
        )

        # Store the length of the current chunk
        chunk_lengths.append(len(current_chunk))
        i += adjusted_chunk_size - overlap

    min_chunk_size = target_chunk_size // 2
    max_chunk_size = int(target_chunk_size * 1.2)
    chunks = combine_small_chunks(chunks, min_chunk_size, max_chunk_size)
    chunks = split_large_chunks(chunks, target_chunk_size)

    return chunks


def split_large_chunks(chunks, target_size):
    new_chunks = []
    for chunk in chunks:
        if len(chunk["words"]) > target_size * 1.5:
            # Split the chunk into smaller chunks
            words = chunk["words"]
            num_words = len(words)
            num_chunks = (num_words + target_size - 1) // target_size
            chunk_size = (num_words + num_chunks - 1) // num_chunks

            for i in range(0, num_words, chunk_size):
                end_index = min(i + chunk_size, num_words)
                new_chunk = {
                    "text": " ".join([w["word"] for w in words[i:end_index]]),
                    "start": words[i]["start"],
                    "end": words[end_index - 1]["end"],
                    "words": words[i:end_index],
                }
                new_chunks.append(new_chunk)
        else:
            new_chunks.append(chunk)

    return new_chunks


def save_youtube_transcription(youtube_data, file_path, transcripts):
    """Save transcription and update youtube data map with metadata"""
    # Don't call save_transcription here since it's already called in transcribe_media
    file_hash = get_file_hash(file_path)
    youtube_data_map = load_youtube_data_map()

    # Get media metadata and store it in youtube_data
    try:
        title, author, duration, url, album = get_media_metadata(file_path)
        youtube_data["media_metadata"] = {
            "title": title,
            "author": author,
            "duration": duration,
            "url": url,
        }
    except Exception as e:
        logger.warning(f"Failed to get media metadata for YouTube video: {e}")

    youtube_data["file_hash"] = file_hash
    youtube_data["file_size"] = youtube_data.get(
        "file_size", os.path.getsize(file_path)
    )
    youtube_data_map[youtube_data["youtube_id"]] = youtube_data
    save_youtube_data_map(youtube_data_map)
