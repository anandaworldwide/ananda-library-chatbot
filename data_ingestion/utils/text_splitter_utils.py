"""
Utility module for text splitting using spaCy.
This module provides a reusable SpacyTextSplitter class that can be used
across different data ingestion scripts to ensure consistent chunking behavior.
"""

import logging
import re
from typing import Any

import spacy
from tqdm import tqdm

# Configure logging
logger = logging.getLogger(__name__)


# Define Document class to avoid circular imports
class Document:
    """Simple document class with content and metadata"""

    def __init__(self, page_content: str, metadata: dict[str, Any] = None):
        self.page_content = page_content
        self.metadata = metadata or {}


class SpacyTextSplitter:
    """Text splitter that uses spaCy to split text into chunks by paragraphs."""

    def __init__(
        self,
        chunk_size=600,
        chunk_overlap=120,
        separator="\n\n",
        pipeline="en_core_web_sm",
    ):
        """
        Initialize the SpacyTextSplitter.

        Args:
            chunk_size (int): Maximum size of chunks to return
            chunk_overlap (int): Overlap in characters between chunks
            separator (str): Separator to use for splitting text
            pipeline (str): Name of spaCy pipeline/model to use

        Raises:
            ValueError: If chunk_size, chunk_overlap are invalid
        """
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if chunk_overlap < 0:
            raise ValueError("chunk_overlap must be non-negative")
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")

        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separator = separator
        self.pipeline = pipeline
        self.nlp = None
        self.logger = logging.getLogger(f"{__name__}.SpacyTextSplitter")

    def _ensure_nlp(self):
        """
        Ensure spaCy model is loaded, downloading if necessary.

        Raises:
            RuntimeError: If the model couldn't be loaded or downloaded
        """
        if self.nlp is None:
            try:
                self.logger.debug(f"Loading spaCy model {self.pipeline}")
                self.nlp = spacy.load(self.pipeline)
            except OSError:
                try:
                    self.logger.info(f"Downloading spaCy model {self.pipeline}...")
                    spacy.cli.download(self.pipeline)
                    self.nlp = spacy.load(self.pipeline)
                    self.logger.info(
                        f"Successfully downloaded and loaded {self.pipeline}"
                    )
                except Exception as e:
                    error_msg = (
                        f"Failed to download spaCy model {self.pipeline}: {str(e)}"
                    )
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg) from e
            except Exception as e:
                error_msg = f"Error loading spaCy model {self.pipeline}: {str(e)}"
                self.logger.error(error_msg)
                raise RuntimeError(error_msg) from e

    def _clean_text(self, text: str) -> str:
        """
        Clean text by removing unnecessary newlines and fixing common OCR artifacts.

        Args:
            text (str): The text to clean

        Returns:
            str: Cleaned text
        """
        if not text:
            return text

        # First, fix hyphenated words split across lines (word-\nword -> word)
        text = re.sub(r"(\w+)-\s*\n\s*(\w+)", r"\1\2", text)

        # Preserve paragraph breaks (double newlines) but normalize them
        text = re.sub(r"\n\s*\n", "\n\n", text)

        # Remove single newlines that are just line wrapping within paragraphs
        # But preserve double newlines (paragraph breaks)
        lines = text.split("\n\n")
        cleaned_lines = []

        for line_group in lines:
            # Within each paragraph, remove single newlines and clean up spacing
            cleaned_paragraph = re.sub(r"\n+", " ", line_group)
            # Clean up multiple spaces
            cleaned_paragraph = re.sub(r"\s+", " ", cleaned_paragraph)
            cleaned_paragraph = cleaned_paragraph.strip()
            if cleaned_paragraph:
                cleaned_lines.append(cleaned_paragraph)

        # Rejoin paragraphs with double newlines
        cleaned_text = "\n\n".join(cleaned_lines)

        self.logger.debug(f"Cleaned text: {len(text)} -> {len(cleaned_text)} chars")
        return cleaned_text

    def split_text(self, text: str) -> list[str]:
        """
        Split text into chunks using spaCy.

        Args:
            text (str): The text to split

        Returns:
            List[str]: A list of text chunks

        Raises:
            ValueError: If the input text is not a string
            RuntimeError: If there's an error processing the text
        """
        if not isinstance(text, str):
            error_msg = f"Expected string input, got {type(text)}"
            self.logger.error(error_msg)
            raise ValueError(error_msg)

        try:
            self._ensure_nlp()

            # Clean the text first to remove unnecessary newlines and fix OCR artifacts
            text = self._clean_text(text)

            # If text is empty, return empty list
            if not text.strip():
                return []

            chunks = []

            # Handle space separator specially - split into word-based chunks
            if self.separator == " ":
                words = text.split()
                if not words:
                    return []

                current_chunk = []
                current_size = 0

                for word in words:
                    # Calculate size with space (except for first word)
                    word_size = len(word) + (1 if current_chunk else 0)

                    # If adding this word would exceed chunk_size, start a new chunk
                    if current_size + word_size > self.chunk_size and current_chunk:
                        chunks.append(" ".join(current_chunk))
                        current_chunk = [word]
                        current_size = len(word)
                    else:
                        current_chunk.append(word)
                        current_size += word_size

                # Add the last chunk
                if current_chunk:
                    chunks.append(" ".join(current_chunk))

                self.logger.debug(f"Split text into {len(chunks)} word-based chunks")

                # Apply word-based overlap for space separator
                if self.chunk_overlap > 0 and len(chunks) > 1:
                    result = []
                    result.append(chunks[0])

                    for i in range(1, len(chunks)):
                        prev_chunk = chunks[i - 1]
                        current_chunk = chunks[i]

                        # Split into words for overlap calculation
                        prev_words = prev_chunk.split()

                        # Calculate overlap in words (approximate based on average word length)
                        avg_word_len = (
                            5  # Approximate average word length including spaces
                        )
                        overlap_words = max(1, self.chunk_overlap // avg_word_len)
                        overlap_words = min(overlap_words, len(prev_words))

                        overlap_text = " ".join(prev_words[-overlap_words:])

                        # Add overlap to current chunk if it doesn't already start with it
                        if not current_chunk.startswith(overlap_text):
                            current_chunk = overlap_text + " " + current_chunk
                            self.logger.debug(
                                f"Applied word-based overlap of {overlap_words} words between chunks"
                            )

                        result.append(current_chunk)

                    self.logger.info(
                        f"Split text into {len(result)} word-based chunks with overlap"
                    )
                    return result
                else:
                    self.logger.info(
                        f"Split text into {len(chunks)} word-based chunks without overlap"
                    )
                    return chunks

            # First split by separator - these are our primary chunk boundaries
            elif self.separator and self.separator != " ":
                # For non-space separators, split directly
                initial_splits = text.split(self.separator)
                self.logger.debug(
                    f"Split text into {len(initial_splits)} parts using separator '{self.separator}'"
                )
            else:
                initial_splits = [text]

            # Track if separator-based splits are already small enough (no overlap needed)
            separator_splits_small = True

            for split_text in initial_splits:
                split_text = split_text.strip()
                if not split_text:
                    continue

                # If the split is longer than chunk_size, break it down further with spaCy
                if len(split_text) > self.chunk_size:
                    separator_splits_small = (
                        False  # At least one split needs further processing
                    )
                    try:
                        # Process with spaCy for sentence-based splitting
                        doc = self.nlp(split_text)

                        current_chunk = []
                        current_size = 0

                        for sent in doc.sents:
                            sent_text = sent.text.strip()
                            if not sent_text:
                                continue

                            # If a single sentence is longer than chunk_size, keep it as its own chunk
                            if len(sent_text) > self.chunk_size:
                                # If we have accumulated text, add it as a chunk first
                                if current_chunk:
                                    chunks.append(" ".join(current_chunk))
                                    current_chunk = []
                                    current_size = 0
                                # Add the long sentence as its own chunk
                                chunks.append(sent_text)
                                self.logger.debug(
                                    f"Added long sentence as chunk: {len(sent_text)} chars"
                                )
                            # If adding this sentence would exceed chunk_size, start a new chunk
                            elif (
                                current_size
                                + len(sent_text)
                                + (1 if current_chunk else 0)
                                > self.chunk_size
                            ):
                                chunks.append(" ".join(current_chunk))
                                self.logger.debug(
                                    f"Created chunk of size {current_size} chars"
                                )
                                current_chunk = [sent_text]
                                current_size = len(sent_text)
                            # Otherwise, add to current chunk
                            else:
                                current_chunk.append(sent_text)
                                current_size += len(sent_text) + (
                                    1 if current_chunk else 0
                                )

                        # Add any remaining text in the current chunk
                        if current_chunk:
                            chunks.append(" ".join(current_chunk))
                            self.logger.debug(
                                f"Added final sentence chunk of size {current_size} chars"
                            )
                    except Exception as e:
                        error_msg = f"Error processing text with spaCy: {str(e)}"
                        self.logger.error(error_msg)
                        raise RuntimeError(error_msg) from e
                else:
                    # If the split is smaller than chunk_size, add it directly
                    chunks.append(split_text)
                    self.logger.debug(
                        f"Added small split as chunk: {len(split_text)} chars"
                    )

            # Apply chunk overlap if configured and appropriate
            # Don't apply overlap if separator-based splits are small and using paragraph separator
            if (
                self.chunk_overlap > 0
                and len(chunks) > 1
                and not (separator_splits_small and self.separator == "\n\n")
            ):
                try:
                    result = []
                    result.append(chunks[0])

                    for i in range(1, len(chunks)):
                        prev_chunk = chunks[i - 1]
                        current_chunk = chunks[i]

                        # For single-character separators like space, use word-based overlap
                        if (
                            self.separator
                            and len(self.separator) == 1
                            and self.separator.isspace()
                        ):
                            # Split into words for overlap calculation
                            prev_words = prev_chunk.split()
                            current_words = current_chunk.split()

                            # Calculate overlap in words (approximate based on average word length)
                            avg_word_len = (
                                5  # Approximate average word length including spaces
                            )
                            overlap_words = max(1, self.chunk_overlap // avg_word_len)
                            overlap_words = min(overlap_words, len(prev_words))

                            overlap_text = " ".join(prev_words[-overlap_words:])

                            # Add overlap to current chunk if it doesn't already start with it
                            if not current_chunk.startswith(overlap_text):
                                current_chunk = overlap_text + " " + current_chunk
                                self.logger.debug(
                                    f"Applied word-based overlap of {overlap_words} words between chunks"
                                )
                        else:
                            # Use character-based overlap for other separators
                            overlap_size = min(self.chunk_overlap, len(prev_chunk))
                            overlap_start = len(prev_chunk) - overlap_size

                            # Adjust overlap_start to ensure it starts at a word boundary
                            while overlap_start < len(prev_chunk) and overlap_start > 0:
                                if (
                                    prev_chunk[overlap_start - 1].isspace()
                                    or prev_chunk[overlap_start].isspace()
                                ):
                                    break
                                overlap_start -= 1

                            # If we couldn't find a space, try moving forward
                            if overlap_start == 0 and not prev_chunk[0].isspace():
                                overlap_start = len(prev_chunk) - overlap_size
                                while overlap_start < len(prev_chunk) - 1:
                                    if prev_chunk[overlap_start].isspace():
                                        overlap_start += 1
                                        break
                                    overlap_start += 1

                            overlap_text = (
                                prev_chunk[overlap_start:]
                                if overlap_start < len(prev_chunk)
                                else ""
                            )

                            # Add overlap to current chunk if it doesn't already start with it
                            if not current_chunk.startswith(overlap_text):
                                current_chunk = overlap_text + current_chunk
                                self.logger.debug(
                                    f"Applied character-based overlap of {len(overlap_text)} chars between chunks at word boundary"
                                )

                        result.append(current_chunk)

                    self.logger.info(
                        f"Split text into {len(result)} chunks with overlap"
                    )
                    return result
                except Exception as e:
                    error_msg = f"Error applying chunk overlap: {str(e)}"
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg) from e

            self.logger.info(f"Split text into {len(chunks)} chunks without overlap")
            return chunks
        except Exception as e:
            if isinstance(e, (ValueError, RuntimeError)):
                raise
            error_msg = f"Unexpected error in split_text: {str(e)}"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg) from e

    def split_documents(self, documents: list[Document]) -> list[Document]:
        """
        Split documents into chunks.

        Args:
            documents (List[Document]): The documents to split

        Returns:
            List[Document]: A list of chunked documents

        Raises:
            ValueError: If the input is not a list of Document objects
            RuntimeError: If there's an error processing the documents
        """
        if not isinstance(documents, list):
            error_msg = f"Expected list of documents, got {type(documents)}"
            self.logger.error(error_msg)
            raise ValueError(error_msg)

        try:
            chunked_docs = []

            for doc in tqdm(documents, desc="Splitting documents", unit="doc"):
                if not isinstance(doc, Document):
                    error_msg = f"Expected Document object, got {type(doc)}"
                    self.logger.error(error_msg)
                    raise ValueError(error_msg)

                text = doc.page_content
                chunks = self.split_text(text)

                for chunk in chunks:
                    if chunk:
                        chunked_docs.append(
                            Document(page_content=chunk, metadata=doc.metadata.copy())
                        )

            self.logger.info(
                f"Split {len(documents)} documents into {len(chunked_docs)} chunks"
            )
            return chunked_docs
        except Exception as e:
            if isinstance(e, (ValueError, RuntimeError)):
                raise
            error_msg = f"Unexpected error in split_documents: {str(e)}"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg) from e
