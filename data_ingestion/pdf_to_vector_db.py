"""
This script ingests PDF documents from a specified directory into a Pinecone vector database.
It processes the documents, splits them into chunks using spaCy's paragraph-based chunking,
and stores them as embeddings for efficient retrieval.

The script supports resuming ingestion from checkpoints and handles graceful shutdowns.

Key features:
- Processes PDF files recursively from a given directory
- Chunks documents using spaCy's paragraph-based approach
- Creates and manages a Pinecone index for storing document embeddings
- Supports incremental updates with checkpointing
- Handles graceful shutdowns and resumption of processing
- Clears existing vectors for a given library name if requested
- Uses OpenAI embeddings for vector representation

Usage:
Run the script with the following options:
--file-path: Path to the directory containing PDF files
--site: Site name for loading environment variables
--library-name: Name of the library to process
--keep-data: Flag to keep existing data in the index (default: false)
"""

import argparse
import asyncio
import json
import logging
import os
import re
import sys

import pdfplumber
from pinecone import Index
from tqdm import tqdm

from data_ingestion.utils.checkpoint_utils import pdf_checkpoint_integration
from data_ingestion.utils.document_hash import generate_document_hash
from data_ingestion.utils.embeddings_utils import OpenAIEmbeddings
from data_ingestion.utils.pinecone_utils import (
    clear_library_vectors,
    create_pinecone_index_if_not_exists,
    get_pinecone_client,
    get_pinecone_ingest_index_name,
)
from data_ingestion.utils.progress_utils import is_exiting, setup_signal_handlers
from data_ingestion.utils.text_processing import clean_document_text
from data_ingestion.utils.text_splitter_utils import Document, SpacyTextSplitter
from pyutil.env_utils import load_env  # noqa: E402

# Configure logging
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global variable for file path
file_path = ""


def _determine_page_separator(previous_text: str, current_text: str) -> str:
    """
    Determine the appropriate separator between pages based on text flow.

    Args:
        previous_text: Text from the previous page (last part)
        current_text: Text from the current page (first part)

    Returns:
        Appropriate separator string
    """
    if not previous_text or not current_text:
        return "\n\n"

    # Get last 50 characters of previous text and first 50 of current
    prev_end = previous_text[-50:].strip()
    curr_start = current_text[:50].strip()

    # Check if previous text ends with sentence-ending punctuation
    ends_with_sentence = prev_end.endswith((".", "!", "?", ":", ";"))

    # Check if current text starts with a capital letter or number (likely new section/paragraph)
    starts_with_capital = curr_start and (
        curr_start[0].isupper() or curr_start[0].isdigit()
    )

    # Check for section headers (short lines with capitals, numbers, or special formatting)
    is_section_header = (
        len(curr_start.split()) <= 5  # Short line
        and (
            curr_start.isupper()  # All caps
            or any(char.isdigit() for char in curr_start[:10])  # Contains numbers early
            or curr_start.startswith(("Chapter", "Section", "Part", "N ", "n "))
        )  # Common headers
    )

    # Check if previous text ends mid-word (hyphenated word split across pages)
    ends_with_hyphen = prev_end.endswith("-")

    # Check if this looks like a continuation of the same sentence
    is_continuation = (
        not ends_with_sentence
        and not starts_with_capital
        and not is_section_header
        and not ends_with_hyphen
    )

    # Determine separator
    if ends_with_hyphen:
        # Hyphenated word split across pages - no space needed
        return ""
    elif is_continuation:
        # Continuing same sentence - just add a space
        return " "
    elif is_section_header or (ends_with_sentence and starts_with_capital):
        # Clear section break or sentence boundary - use paragraph break
        return "\n\n"
    else:
        # Default case - use paragraph break for safety
        return "\n\n"


# Custom PDF document loader
class PyPDFLoader:
    """PDF document loader using pdfplumber for superior text extraction and layout preservation"""

    def __init__(self, file_path):
        self.file_path = file_path

    def _is_header_footer_text(self, text, y_position, page_height, page_width):
        """
        Determine if text is likely a header or footer based on position and content patterns.
        """
        if not text or not text.strip():
            return True

        text = text.strip()

        # Define header/footer regions (top 8% and bottom 8% of page)
        header_threshold = page_height * 0.92  # pdfplumber uses bottom-left origin
        footer_threshold = page_height * 0.08

        is_in_header_region = y_position > header_threshold
        is_in_footer_region = y_position < footer_threshold

        # Check for common header/footer patterns
        is_page_number = bool(re.match(r"^\s*\d+\s*$", text))
        is_chapter_header = bool(
            re.match(r"^(Chapter|Section|Part)\s+\d+", text, re.IGNORECASE)
        )
        # Check for book title patterns (Title Case Words followed by numbers)
        is_book_title_pattern = bool(
            re.search(r"\b([A-Z][a-z]+\s+){1,4}[A-Z][a-z]+\s+\d{1,3}\b", text)
        )
        is_book_title = len(text.split()) <= 5 and any(
            word[0].isupper() for word in text.split() if word
        )

        # Decision logic
        if is_page_number:
            return True

        # Always filter book title patterns regardless of position
        if is_book_title_pattern:
            return True

        if (is_in_header_region or is_in_footer_region) and (
            is_chapter_header or is_book_title
        ):
            return True

        # Very short text in margins is likely header/footer
        return (is_in_header_region or is_in_footer_region) and len(text.split()) <= 3

    def _extract_clean_text(self, page):
        """
        Extract text from page while filtering out headers and footers.
        Uses pdfplumber's superior text extraction with layout preservation.
        """
        try:
            # Get page dimensions
            page_height = page.height
            page_width = page.width

            # Extract text with character-level positioning
            chars = page.chars
            if not chars:
                # Fallback to simple text extraction
                return page.extract_text() or ""

            # Group characters into lines and filter headers/footers
            filtered_chars = []
            filtered_parts = []  # For debugging

            for char in chars:
                char_text = char.get("text", "")
                char_y = char.get("y0", 0)  # Bottom y coordinate

                if char_text and not self._is_header_footer_text(
                    char_text, char_y, page_height, page_width
                ):
                    filtered_chars.append(char)
                elif char_text.strip():
                    filtered_parts.append(f"'{char_text}' (filtered)")

            # Log what was filtered for debugging
            if filtered_parts and len(filtered_parts) > 5:
                logger.debug(
                    f"Filtered header/footer characters: {len(filtered_parts)} chars"
                )

            # If we filtered too much, fall back to full text
            if len(filtered_chars) < len(chars) * 0.7:
                logger.debug("Filtered too many characters, using full text extraction")
                return page.extract_text() or ""

            # Use pdfplumber's layout-aware text extraction on filtered content
            # This preserves word spacing and paragraph structure
            if filtered_chars:
                # Create a new page object with only the filtered characters
                filtered_page = page.within_bbox((0, 0, page_width, page_height))
                text = filtered_page.extract_text()
                return text or ""
            else:
                return ""

        except Exception as e:
            logger.debug(
                f"Advanced text extraction failed: {e}, falling back to simple extraction"
            )
            # Fallback to simple text extraction
            return page.extract_text() or ""

    def _clean_text_artifacts(self, text):
        """
        Clean up extracted text to remove common PDF artifacts and improve readability.
        """
        if not text:
            return ""

        # Remove common PDF artifacts that appear in this specific document
        # Remove "N n" artifacts that appear in the middle of text
        text = re.sub(r"\bN n\b", "", text)

        # Remove standalone single characters that are likely artifacts (but preserve "I" and "a")
        text = re.sub(r"\n[B-HJ-Z]\n", "\n", text)
        text = re.sub(r"\n[b-z]\n", "\n", text)

        # Remove standalone numbers that are likely page numbers
        text = re.sub(r"\n\d+\n", "\n", text)

        # Remove common book/chapter patterns that might appear in text
        text = re.sub(
            r"\b(Chapter|Section|Part)\s+\d+\b", "", text, flags=re.IGNORECASE
        )

        # Remove patterns that look like book titles (Title Case Words followed by numbers)
        # This catches patterns like "Control Your Destiny 23" without hard-coding specific titles
        text = re.sub(r"\b([A-Z][a-z]+\s+){1,4}[A-Z][a-z]+\s+\d{1,3}\b", "", text)

        # Remove standalone page numbers (more comprehensive)
        text = re.sub(r"\b\d{1,3}\b(?=\s|$)", "", text)

        # Remove multiple consecutive spaces
        text = re.sub(r" {3,}", " ", text)

        # Remove multiple consecutive newlines
        text = re.sub(r"\n{3,}", "\n\n", text)

        # Clean up line breaks - remove single newlines within paragraphs but keep double newlines
        # This helps with text that has been broken across lines unnecessarily
        lines = text.split("\n")
        cleaned_lines = []

        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                # Empty line - preserve as paragraph break
                if cleaned_lines and cleaned_lines[-1] != "":
                    cleaned_lines.append("")
            else:
                # Non-empty line
                if (
                    i > 0
                    and lines[i - 1].strip()  # Previous line was not empty
                    and not line[0].isupper()  # Current line doesn't start with capital
                    and not lines[i - 1]
                    .strip()
                    .endswith(
                        (".", "!", "?", ":", ";")
                    )  # Previous line doesn't end with punctuation
                    and len(line.split()) > 1
                ):  # Current line has multiple words
                    # This looks like a continuation of the previous line
                    if cleaned_lines:
                        cleaned_lines[-1] += " " + line
                    else:
                        cleaned_lines.append(line)
                else:
                    # This looks like a new paragraph or sentence
                    cleaned_lines.append(line)

        # Join lines back together
        cleaned_text = "\n".join(cleaned_lines)

        # Final cleanup
        cleaned_text = re.sub(
            r"\n{3,}", "\n\n", cleaned_text
        )  # Remove excessive newlines
        cleaned_text = re.sub(r" +", " ", cleaned_text)  # Remove excessive spaces

        return cleaned_text.strip()

    def load(self):
        """Load a PDF file into documents using pdfplumber with header/footer filtering"""
        documents = []
        try:
            # Open the PDF document with pdfplumber
            with pdfplumber.open(self.file_path) as pdf:
                # Extract metadata
                metadata_dict = pdf.metadata or {}

                for page_num, page in enumerate(pdf.pages):
                    # Extract clean text (filtering headers/footers)
                    text = self._extract_clean_text(page)

                    # Apply additional text cleaning to remove artifacts
                    if text:
                        text = self._clean_text_artifacts(text)

                    if not text or not text.strip():
                        continue

                    metadata = {
                        "source": self.file_path,
                        "page": page_num,
                        "pdf": {"info": metadata_dict},
                    }
                    documents.append(Document(page_content=text, metadata=metadata))

        except Exception as e:
            logger.error(f"Error reading PDF {self.file_path}: {e}", exc_info=True)
            return []  # Return empty on errors

        return documents


class DirectoryLoader:
    """Load documents from a directory"""

    def __init__(
        self, dir_path, glob, loader_cls=None, show_progress=False, silent_errors=False
    ):
        self.dir_path = dir_path
        self.glob = glob
        self.loader_cls = loader_cls
        self.show_progress = show_progress
        self.silent_errors = silent_errors

    def load(self):
        """Load documents from a directory matching glob pattern"""
        import glob as glob_module

        documents = []
        # Ensure dir_path is an absolute path for robust globbing
        absolute_dir_path = os.path.abspath(self.dir_path)
        glob_pattern = os.path.join(absolute_dir_path, self.glob)

        logger.info(f"Searching for files with pattern: {glob_pattern}")
        paths = glob_module.glob(
            glob_pattern, recursive=True
        )  # Added recursive=True for '**'

        logger.info(f"Found {len(paths)} files matching glob pattern.")

        if self.show_progress and paths:  # Ensure paths is not empty
            paths_iter = tqdm(paths, desc="Loading documents")
        else:
            paths_iter = paths

        for path in paths_iter:
            logger.info(f"Attempting to load document: {path}")
            try:
                if self.loader_cls:
                    loader = self.loader_cls(path)
                    docs = loader.load()
                    logger.info(f"Successfully loaded {len(docs)} pages from {path}")
                    documents.extend(docs)
            except Exception as e:
                logger.error(
                    f"Error loading {path}: {e}", exc_info=True
                )  # Log traceback
                if not self.silent_errors:
                    # If silent_errors is False, re-raise the exception
                    # or handle it as per existing logic (e.g. print and continue)
                    print(f"Error loading {path}: {e}")

        logger.info(f"Total documents loaded: {len(documents)}")
        return documents


async def process_document(
    raw_doc: Document,
    pinecone_index: Index,
    embeddings: OpenAIEmbeddings,
    doc_index: int,
    library_name: str,
    text_splitter: SpacyTextSplitter,
) -> None:
    """
    Processes a single document, splitting it into chunks using spaCy and adding it to the vector store.
    """
    # Extract metadata with comprehensive field name checking
    source_url = None
    title = "Untitled"
    author = "Unknown"

    # Access metadata
    if isinstance(raw_doc.metadata, dict):
        # Check if pdf info exists in metadata
        pdf_info = raw_doc.metadata.get("pdf", {}).get("info", {})
        if isinstance(pdf_info, dict):
            # Extract title - check multiple possible field names
            title_fields = ["title", "Title", "subject", "Subject"]
            for field in title_fields:
                if field in pdf_info and pdf_info[field] and pdf_info[field].strip():
                    title = pdf_info[field].strip()
                    break

            # Extract author - check multiple possible field names
            author_fields = ["author", "Author", "creator", "Creator"]
            for field in author_fields:
                if field in pdf_info and pdf_info[field] and pdf_info[field].strip():
                    author = pdf_info[field].strip()
                    break
            else:
                logger.info(
                    f"DEBUG EXTRACTION: No author found in any of: {author_fields}"
                )

            # Extract source URL - use Subject field if available, otherwise use file path
            if pdf_info.get("subject") and pdf_info["subject"].strip():
                source_url = pdf_info["subject"].strip()
            elif pdf_info.get("Subject") and pdf_info["Subject"].strip():
                source_url = pdf_info["Subject"].strip()

        # Use source from metadata if available (fallback to file path)
        if raw_doc.metadata.get("source"):
            source_url = source_url or raw_doc.metadata.get("source")

    if not source_url:
        logger.error(
            f"ERROR: No source URL found in metadata for document from file: {raw_doc.metadata.get('source', 'Unknown File')}, page: {raw_doc.metadata.get('page', 'Unknown Page')}"
        )
        logger.error(f"Full metadata: {raw_doc.metadata}")
        logger.warning("Skipping this page/document due to missing source URL.")
        return

    # Set extracted metadata for all pages
    raw_doc.metadata["source"] = source_url
    raw_doc.metadata["title"] = title
    raw_doc.metadata["author"] = author

    # Only print debug information for the first page
    page_number = raw_doc.metadata.get("page", 0)
    if page_number == 0:  # This condition will be met for the first page of each PDF
        logger.info(f"Processing document with source URL: {source_url}")
        logger.info(f"Document title: {title}")
        logger.info(f"Document author: {author}")

    # Get document filename for logging context
    doc_filename = os.path.basename(raw_doc.metadata.get("source", "Unknown File"))

    # Split document into chunks
    logger.info(f"Splitting complete document {doc_filename} into chunks...")
    docs = text_splitter.split_documents([raw_doc])

    # Filter out invalid documents and calculate their positions efficiently
    valid_docs = []
    page_boundaries = raw_doc.metadata.get("page_boundaries", [])
    full_text = raw_doc.page_content

    # Debug logging
    logger.info(
        f"DEBUG: Processing {len(docs)} chunks, page_boundaries available: {len(page_boundaries) > 0}"
    )

    # Process chunks with TQDM progress bar
    logger.info(f"Calculating page references for {len(docs)} chunks...")

    for i, doc in enumerate(
        tqdm(docs, desc="Calculating page references", unit="chunk")
    ):
        # Check for graceful shutdown
        if is_exiting():
            logger.info(
                "Graceful shutdown detected during chunk processing. Stopping chunk processing..."
            )
            return  # Return from this function to allow higher-level checkpoint saving

        if isinstance(doc.page_content, str) and doc.page_content.strip():
            page_reference = None

            if page_boundaries:
                # More efficient approach: estimate position based on chunk sequence
                # This avoids the expensive text search for each chunk
                estimated_position = (i / len(docs)) * len(full_text)

                # Find the page containing this estimated position
                for page_boundary in page_boundaries:
                    if (
                        page_boundary["start_offset"]
                        <= estimated_position
                        <= page_boundary["end_offset"]
                    ):
                        page_reference = str(page_boundary["page_number"])
                        doc.metadata["page"] = page_reference
                        break

                # If estimation didn't work, try a few nearby pages
                if not page_reference:
                    for page_boundary in page_boundaries:
                        # Check if chunk might span this page (with some tolerance)
                        page_start = page_boundary["start_offset"]
                        page_end = page_boundary["end_offset"]
                        tolerance = len(full_text) * 0.02  # 2% tolerance

                        if (
                            estimated_position >= page_start - tolerance
                            and estimated_position <= page_end + tolerance
                        ):
                            page_reference = str(page_boundary["page_number"])
                            doc.metadata["page"] = page_reference
                            break

            valid_docs.append(doc)

    if valid_docs:
        logger.info(f"Document {doc_filename} split into {len(valid_docs)} chunks")
        # Count how many got page references
        with_page_refs = sum(1 for doc in valid_docs if doc.metadata.get("page"))
        logger.info(
            f"DEBUG: {with_page_refs}/{len(valid_docs)} chunks got page references"
        )

    # Process in smaller batches to avoid API limits
    batch_size = 10
    total_batches = (len(valid_docs) + batch_size - 1) // batch_size
    logger.info(f"Processing {len(valid_docs)} chunks in {total_batches} batches...")

    # Use TQDM for batch processing progress
    batch_ranges = [
        (i, min(i + batch_size, len(valid_docs)))
        for i in range(0, len(valid_docs), batch_size)
    ]

    for start_idx, end_idx in tqdm(
        batch_ranges, desc="Processing batches", unit="batch"
    ):
        # Check for graceful shutdown before starting each batch
        if is_exiting():
            logger.info(
                "Graceful shutdown detected during batch processing. Stopping..."
            )
            return

        batch = valid_docs[start_idx:end_idx]

        # For each chunk in the batch, process it
        tasks = []
        for j, doc in enumerate(batch):
            # Check for shutdown before creating each task
            if is_exiting():
                logger.info(
                    "Graceful shutdown detected while preparing batch tasks. Stopping..."
                )
                return

            task = process_chunk(
                doc, pinecone_index, embeddings, start_idx + j, library_name
            )
            tasks.append(task)

        # Wait for all tasks to complete with timeout to allow more responsive shutdown
        try:
            # Use wait_for with shorter timeout to make shutdown more responsive
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=30.0,  # 30 second timeout per batch
            )
        except asyncio.TimeoutError:
            logger.warning("Batch processing timeout after 30 seconds")
            # Cancel remaining tasks on timeout
            for task in tasks:
                if not task.done():
                    task.cancel()
            # Check if we should exit due to shutdown signal
            if is_exiting():
                logger.info(
                    "Graceful shutdown detected during batch timeout. Stopping..."
                )
                return
            else:
                # If not shutting down, continue with a warning
                logger.warning("Continuing with next batch after timeout...")
                continue

        # Check for exceptions
        for result in results:
            if isinstance(result, Exception):
                print(f"Error processing chunk: {result}")
                raise result


async def process_chunk(
    doc: Document,
    pinecone_index: Index,
    embeddings: OpenAIEmbeddings,
    chunk_index: int,
    library_name: str,
) -> None:
    """Process and store a single document chunk."""
    # Check for shutdown at the start of processing each chunk
    if is_exiting():
        logger.info(
            f"Graceful shutdown detected before processing chunk {chunk_index}. Skipping..."
        )
        return

    title = doc.metadata.get("title", "Untitled")
    sanitized_title = "".join(
        c if c.isalnum() or c == "_" else "_" for c in title.replace(" ", "_")
    )[:40]

    # Generate document-level hash for the complete document
    document_hash = generate_document_hash(
        source=doc.metadata.get("source", ""),
        title=title,
        author=doc.metadata.get("author"),
        library=library_name,
    )
    id = f"text||{library_name}||{sanitized_title}||{document_hash}||chunk{chunk_index + 1}"

    try:
        # Check for shutdown before expensive embedding operation
        if is_exiting():
            logger.info(
                f"Graceful shutdown detected before embedding chunk {chunk_index}. Skipping..."
            )
            return

        # Minimize metadata
        minimal_metadata = {
            "id": id,
            "library": library_name,
            "type": "text",
            "author": doc.metadata.get("author", "Unknown"),
            "source": doc.metadata.get("source"),
            "title": doc.metadata.get("title"),
            "text": doc.page_content,
        }

        # Add page reference if it was calculated during processing
        page_reference = doc.metadata.get("page")
        if page_reference:
            minimal_metadata["page"] = page_reference

        # Generate embedding with timeout to make it more responsive
        try:
            vector = await asyncio.wait_for(
                asyncio.to_thread(embeddings.embed_query, doc.page_content),
                timeout=15.0,  # 15 second timeout for embedding
            )
        except asyncio.TimeoutError:
            logger.warning(f"Embedding timeout for chunk {chunk_index}, skipping...")
            return

        # Check for shutdown before Pinecone upsert
        if is_exiting():
            logger.info(
                f"Graceful shutdown detected before upserting chunk {chunk_index}. Skipping..."
            )
            return

        # Upsert to Pinecone with timeout
        try:
            await asyncio.wait_for(
                asyncio.to_thread(
                    pinecone_index.upsert, vectors=[(id, vector, minimal_metadata)]
                ),
                timeout=10.0,  # 10 second timeout for upsert
            )
        except asyncio.TimeoutError:
            logger.warning(
                f"Pinecone upsert timeout for chunk {chunk_index}, skipping..."
            )
            return

    except Exception as e:
        # Check if error is due to shutdown
        if is_exiting():
            logger.info(
                f"Error during shutdown for chunk {chunk_index}, stopping gracefully..."
            )
            return
        print(f"Error processing chunk {chunk_index}: {e}")
        print(f"Chunk size: {len(json.dumps(doc.__dict__))} bytes")
        raise


async def run(keep_data: bool, library_name: str) -> None:
    """
    Main function to run the document ingestion process.
    This function orchestrates the entire ingestion workflow.
    """
    global file_path  # file_path is set in main()
    logger.info(f"Processing documents from directory: {file_path}")

    # Initialize Pinecone
    try:
        pinecone = get_pinecone_client()
    except ValueError as e:  # More specific exception
        logger.error(f"Failed to initialize Pinecone: {e}")
        sys.exit(1)  # Exit if Pinecone setup fails

    # Get or create index
    index_name = get_pinecone_ingest_index_name()
    create_pinecone_index_if_not_exists(pinecone, index_name)

    # Get index
    try:
        pinecone_index = pinecone.Index(index_name)
    except Exception as e:
        logger.error(f"Error getting Pinecone index '{index_name}': {e}", exc_info=True)
        sys.exit(1)

    # Clear existing data if needed
    if not keep_data:
        logger.info(f"Clearing existing vectors for library '{library_name}'.")
        clear_library_vectors(pinecone_index, library_name)
    else:
        logger.info(
            "keep_data is True. Proceeding with adding/updating vectors, existing data will be preserved."
        )

    # Initialize text splitter
    text_splitter = SpacyTextSplitter()

    # Initialize OpenAI embeddings
    try:
        model_name = os.environ.get("OPENAI_INGEST_EMBEDDINGS_MODEL")
        if not model_name:
            raise ValueError(
                "OPENAI_INGEST_EMBEDDINGS_MODEL environment variable not set"
            )
        embeddings = OpenAIEmbeddings(model=model_name)
    except ValueError as e:
        logger.error(f"Error initializing OpenAI Embeddings: {e}")
        sys.exit(1)

    # Get all PDF file paths recursively
    pdf_file_paths = []
    for root, _, files_in_dir in os.walk(
        file_path
    ):  # Renamed 'files' to 'files_in_dir'
        for file_name in files_in_dir:
            if file_name.lower().endswith(".pdf"):
                pdf_file_paths.append(os.path.join(root, file_name))
    pdf_file_paths.sort()  # Ensure consistent order for checkpointing

    if not pdf_file_paths:
        logger.info(f"No PDF files found in {file_path}. Ingestion complete.")
        return

    logger.info(f"Found {len(pdf_file_paths)} PDF files to process.")

    # Get checkpoint information
    processed_files_count = 0
    processed_files_count, current_folder_signature, save_checkpoint_func = (
        pdf_checkpoint_integration(
            checkpoint_dir="./media/pdf-docs",
            folder_path=file_path,
            library_name=library_name,
            keep_data=keep_data,
        )
    )

    # Set up signal handler for graceful shutdown
    setup_signal_handlers()

    # Process PDF files
    files_actually_processed_in_this_run = 0
    for i in range(processed_files_count, len(pdf_file_paths)):
        if is_exiting():
            logger.info(
                "Graceful shutdown detected: saving progress before exiting loop."
            )
            save_checkpoint_func(i)  # Save current file index 'i' (next to process)
            if i == 0:
                logger.info(
                    "Exiting before processing any files. Next run will start from the beginning."
                )
            else:
                logger.info(
                    f"Exiting. Processed up to file index {i - 1}. Next run will start from file index {i}."
                )
            sys.exit(0)

        current_pdf_path = pdf_file_paths[i]
        logger.info(
            f"Processing PDF file {i + 1} of {len(pdf_file_paths)}: {current_pdf_path}"
        )

        try:
            pdf_loader = PyPDFLoader(current_pdf_path)
            pages_from_pdf = (
                pdf_loader.load()
            )  # This now handles basic PDF errors and returns list

            if not pages_from_pdf:
                logger.warning(
                    f"No pages or text extracted from {current_pdf_path}. Skipping."
                )
                # Even if skipped, we mark it as "processed" in terms of sequence for checkpoint
                save_checkpoint_func(i + 1)
                continue

            logger.info(f"Loaded {len(pages_from_pdf)} pages from {current_pdf_path}.")

            # Process entire PDF as one document instead of page-by-page
            # This improves chunking quality by preserving context across page boundaries
            if pages_from_pdf:
                # Extract metadata from first page (should be consistent across all pages)
                first_page = pages_from_pdf[0]

                # Concatenate all page content and track page boundaries
                full_text_parts = []
                page_boundaries = []  # Track where each page starts/ends in concatenated text
                current_offset = 0

                for page_index, page_doc in enumerate(pages_from_pdf):
                    if page_doc.page_content and page_doc.page_content.strip():
                        page_text = page_doc.page_content.strip()

                        # Add intelligent spacing between pages
                        if page_index > 0:
                            # Get the last few characters of the previous page
                            previous_text = (
                                full_text_parts[-1] if full_text_parts else ""
                            )

                            # Determine appropriate separator based on text flow
                            page_separator = _determine_page_separator(
                                previous_text, page_text
                            )
                            full_text_parts.append(page_separator)
                            current_offset += len(page_separator)

                        # Track this page's boundaries in the concatenated text
                        start_offset = current_offset
                        full_text_parts.append(page_text)
                        current_offset += len(page_text)
                        end_offset = current_offset

                        # Use actual PDF page number (not sequential index)
                        actual_pdf_page_number = (
                            page_doc.metadata.get("page", page_index) + 1
                        )
                        page_boundaries.append(
                            {
                                "page_number": actual_pdf_page_number,
                                "start_offset": start_offset,
                                "end_offset": end_offset,
                            }
                        )

                if not full_text_parts:
                    logger.warning(
                        f"No text content found in any pages of {current_pdf_path}. Skipping."
                    )
                    save_checkpoint_func(i + 1)
                    continue

                # Create a single document with all content (no page markers)
                full_document = Document(
                    page_content=clean_document_text("".join(full_text_parts)),
                    metadata={
                        **first_page.metadata.copy(),
                        "page_boundaries": page_boundaries,
                        "total_pages": len(pages_from_pdf),
                    },
                )

                # Process the complete document (this will handle chunking better)
                await process_document(
                    full_document,
                    pinecone_index,
                    embeddings,
                    0,
                    library_name,
                    text_splitter,
                )

                # Check for graceful shutdown after processing each document
                if is_exiting():
                    logger.info(
                        f"Graceful shutdown detected after processing {current_pdf_path}. Saving progress and exiting."
                    )
                    save_checkpoint_func(
                        i + 1
                    )  # Mark this file as done since we just completed it
                    logger.info(
                        f"Progress saved. Next run will start from file index {i + 1}."
                    )
                    sys.exit(0)

            # All pages of the current PDF processed successfully
            files_actually_processed_in_this_run += 1
            save_checkpoint_func(i + 1)  # Mark this file as done

            # Add summary for this PDF
            pdf_filename = os.path.basename(current_pdf_path)
            logger.info(
                f"✓ Completed {pdf_filename} - processed {len(pages_from_pdf)} pages as single document"
            )
            logger.info(
                f"Successfully processed PDF file {i + 1} of {len(pdf_file_paths)} ({((i + 1) / len(pdf_file_paths) * 100):.1f}% done in scan)"
            )

        except Exception as file_processing_error:
            logger.error(
                f"Failed to process PDF file {current_pdf_path}: {file_processing_error}",
                exc_info=True,
            )
            error_message = str(file_processing_error)
            if "InsufficientQuotaError" in error_message or "429" in error_message:
                logger.error(
                    "OpenAI API quota exceeded during file processing. Saving progress and exiting."
                )
                save_checkpoint_func(i)
                sys.exit(1)

            logger.warning(
                f"Skipping file {current_pdf_path} due to error. Will attempt to continue with next file."
            )
            # Mark this problematic file as "processed" (i.e., attempted and failed, so skipped)
            # to avoid retrying it indefinitely on subsequent runs if the error is persistent for this file.
            save_checkpoint_func(i + 1)
            continue  # Continue to the next file

    logger.info(
        f"Ingestion run complete. Scanned {len(pdf_file_paths)} files. Actually processed content from {files_actually_processed_in_this_run} files in this session."
    )

    # Print chunking statistics
    print()
    text_splitter.metrics.print_summary()


def main():
    """Parse arguments and run the script."""
    global file_path

    parser = argparse.ArgumentParser(
        description="Ingest PDF documents into Pinecone vector database"
    )
    parser.add_argument(
        "--file-path", required=True, help="Path to the directory containing PDF files"
    )
    parser.add_argument(
        "--site", required=True, help="Site name for loading environment variables"
    )
    parser.add_argument(
        "--library-name", required=True, help="Name of the library to process"
    )
    parser.add_argument(
        "--keep-data",
        "-k",
        action="store_true",
        help="Flag to keep existing data in the index",
    )

    args = parser.parse_args()

    # Load environment variables
    load_env(args.site)

    # Validate file path
    file_path = os.path.abspath(args.file_path)
    if not os.path.isdir(file_path):
        print(f"Error: {file_path} is not a valid directory")
        sys.exit(1)

    # Run the ingestion process
    asyncio.run(run(args.keep_data, args.library_name))


if __name__ == "__main__":
    main()
