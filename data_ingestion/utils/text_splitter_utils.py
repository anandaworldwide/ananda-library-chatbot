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


class ChunkingMetrics:
    """Class to track and log chunking metrics for analysis."""

    def __init__(self):
        self.total_documents = 0
        self.total_chunks = 0
        self.word_count_distribution = {
            "<200": 0,
            "200-999": 0,
            "1000-4999": 0,
            "5000+": 0,
        }
        self.chunk_size_distribution = {
            "<100": 0,
            "100-299": 0,
            "300-499": 0,
            "500+": 0,
        }
        self.edge_cases = []
        self.anomalies = []

    def log_document_metrics(
        self,
        word_count: int,
        chunk_count: int,
        chunk_sizes: list[int],
        chunk_overlaps: list[int],
        document_id: str = None,
    ):
        """Log metrics for a single document."""
        self.total_documents += 1
        self.total_chunks += chunk_count

        # Track word count distribution
        if word_count < 200:
            self.word_count_distribution["<200"] += 1
        elif word_count < 1000:
            self.word_count_distribution["200-999"] += 1
        elif word_count < 5000:
            self.word_count_distribution["1000-4999"] += 1
        else:
            self.word_count_distribution["5000+"] += 1

        # Track chunk size distribution
        for chunk in chunk_sizes:
            word_count_in_chunk = (
                len(chunk.split()) if isinstance(chunk, str) else chunk
            )
            if word_count_in_chunk < 100:
                self.chunk_size_distribution["<100"] += 1
            elif word_count_in_chunk < 300:
                self.chunk_size_distribution["100-299"] += 1
            elif word_count_in_chunk < 500:
                self.chunk_size_distribution["300-499"] += 1
            else:
                self.chunk_size_distribution["500+"] += 1

        # Detect edge cases
        if word_count < 50:
            self.edge_cases.append(
                f"Very short document: {word_count} words (ID: {document_id})"
            )
        elif word_count > 50000:
            self.edge_cases.append(
                f"Very long document: {word_count} words (ID: {document_id})"
            )

        if chunk_count == 1 and word_count > 1000:
            self.edge_cases.append(
                f"Large document not chunked: {word_count} words, 1 chunk (ID: {document_id})"
            )

        # Detect anomalies
        avg_chunk_size = (
            sum(
                len(chunk.split()) if isinstance(chunk, str) else chunk
                for chunk in chunk_sizes
            )
            / len(chunk_sizes)
            if chunk_sizes
            else 0
        )
        if avg_chunk_size < 50 and word_count > 500:
            self.anomalies.append(
                f"Unexpectedly small chunks: avg {avg_chunk_size:.1f} words for {word_count} word document (ID: {document_id})"
            )
        elif avg_chunk_size > 800:
            self.anomalies.append(
                f"Unexpectedly large chunks: avg {avg_chunk_size:.1f} words (ID: {document_id})"
            )

    def log_summary(self, logger: logging.Logger):
        """Log a summary of all chunking metrics."""
        logger.info("=== CHUNKING METRICS SUMMARY ===")
        logger.info(f"Total documents processed: {self.total_documents}")
        logger.info(f"Total chunks created: {self.total_chunks}")
        logger.info(
            f"Average chunks per document: {self.total_chunks / self.total_documents:.2f}"
        )

        logger.info("Word count distribution:")
        for range_key, count in self.word_count_distribution.items():
            percentage = (
                (count / self.total_documents * 100) if self.total_documents > 0 else 0
            )
            logger.info(f"  {range_key} words: {count} documents ({percentage:.1f}%)")

        logger.info("Chunk size distribution:")
        for range_key, count in self.chunk_size_distribution.items():
            percentage = (
                (count / self.total_chunks * 100) if self.total_chunks > 0 else 0
            )
            logger.info(f"  {range_key} words: {count} chunks ({percentage:.1f}%)")

        if self.edge_cases:
            logger.info(f"Edge cases detected ({len(self.edge_cases)}):")
            for case in self.edge_cases[:10]:  # Log first 10 edge cases
                logger.info(f"  {case}")
            if len(self.edge_cases) > 10:
                logger.info(f"  ... and {len(self.edge_cases) - 10} more edge cases")

        if self.anomalies:
            logger.warning(f"Anomalies detected ({len(self.anomalies)}):")
            for anomaly in self.anomalies[:10]:  # Log first 10 anomalies
                logger.warning(f"  {anomaly}")
            if len(self.anomalies) > 10:
                logger.warning(f"  ... and {len(self.anomalies) - 10} more anomalies")


class SpacyTextSplitter:
    """Text splitter that uses spaCy to split text into chunks by paragraphs."""

    def __init__(
        self,
        separator="\n\n",
        pipeline="en_core_web_sm",
    ):
        """
        Initialize the SpacyTextSplitter.

        Args:
            separator (str): Separator to use for splitting text
            pipeline (str): Name of spaCy pipeline/model to use
        """
        self.chunk_size = 600  # Will be overridden by dynamic sizing
        self.chunk_overlap = 120  # Will be overridden by dynamic sizing
        self.separator = separator
        self.pipeline = pipeline
        self.nlp = None
        self.logger = logging.getLogger(f"{__name__}.SpacyTextSplitter")
        self.metrics = ChunkingMetrics()

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

    def _estimate_word_count(self, text: str, doc: spacy.language.Doc = None) -> int:
        """
        Estimate the word count of the input text by splitting on spaces or using pre-tokenized SpaCy Doc.

        Args:
            text (str): The text to estimate word count for (used if doc is None)
            doc (spacy.language.Doc, optional): Pre-tokenized SpaCy document to use if available

        Returns:
            int: Approximate number of words
        """
        if doc is not None:
            # Use pre-tokenized doc if provided
            words = [
                token.text for token in doc if not token.is_space and not token.is_punct
            ]
            return len(words)
        if not text:
            return 0
        # Split on whitespace and filter out empty strings
        words = [w for w in text.split() if w]
        return len(words)

    def _set_dynamic_chunk_size(self, word_count: int) -> None:
        """
        Set chunk size and overlap based on word count of the content.

        Args:
            word_count (int): The estimated word count of the text

        Updates:
            self.chunk_size and self.chunk_overlap based on content length
        """
        if word_count < 200:
            # Very short content: no chunking needed
            self.chunk_size = 1000  # Large enough to include all
            self.chunk_overlap = 0
            self.logger.debug(
                f"Very short content ({word_count} words): No chunking, size={self.chunk_size}"
            )
        elif word_count < 1000:
            # Short content: Increase chunk size to reach target range
            # Target: 225-450 words, so use larger token counts
            self.chunk_size = 800  # Increased from 200 to get larger chunks
            self.chunk_overlap = 100  # Increased from 50
            self.logger.debug(
                f"Short content ({word_count} words): chunk_size=800, overlap=100"
            )
        elif word_count < 5000:
            # Medium content: Larger chunks to reach target range
            self.chunk_size = 1200  # Increased from 400 to get larger chunks
            self.chunk_overlap = 200  # Increased from 100
            self.logger.debug(
                f"Medium content ({word_count} words): chunk_size=1200, overlap=200"
            )
        else:
            # Long content: Even larger chunks for target range
            self.chunk_size = 1600  # Increased from 600 to get larger chunks
            self.chunk_overlap = 300  # Increased from 150
            self.logger.debug(
                f"Long content ({word_count} words): chunk_size=1600, overlap=300"
            )

    def _log_chunk_metrics(
        self, chunks: list[str], word_count: int, document_id: str = None
    ) -> None:
        """
        Log detailed chunking metrics for a document.

        Args:
            chunks (list[str]): The chunks created for the document
            word_count (int): The word count of the original document
            document_id (str, optional): Identifier for the document
        """
        # Log detailed chunking metrics
        chunk_word_counts = [len(chunk.split()) for chunk in chunks]
        chunk_char_counts = [len(chunk) for chunk in chunks]

        if chunks:
            avg_chunk_words = sum(chunk_word_counts) / len(chunk_word_counts)
            min_chunk_words = min(chunk_word_counts)
            max_chunk_words = max(chunk_word_counts)
            avg_chunk_chars = sum(chunk_char_counts) / len(chunk_char_counts)

            self.logger.info(
                f"Chunk statistics (ID: {document_id}): "
                f"avg={avg_chunk_words:.1f} words, "
                f"min={min_chunk_words}, max={max_chunk_words} words, "
                f"avg_chars={avg_chunk_chars:.1f}"
            )

            # Check if chunks meet target range (225-450 words)
            target_range_chunks = sum(
                1 for count in chunk_word_counts if 225 <= count <= 450
            )
            target_percentage = (target_range_chunks / len(chunks)) * 100
            self.logger.info(
                f"Target range (225-450 words): {target_range_chunks}/{len(chunks)} chunks "
                f"({target_percentage:.1f}%)"
            )

            # Log edge cases for this document
            if min_chunk_words < 50:
                self.logger.warning(
                    f"Very small chunks detected (ID: {document_id}): "
                    f"minimum {min_chunk_words} words"
                )
            if max_chunk_words > 800:
                self.logger.warning(
                    f"Very large chunks detected (ID: {document_id}): "
                    f"maximum {max_chunk_words} words"
                )
            if len(chunks) == 1 and word_count > 1000:
                self.logger.warning(
                    f"Large document not chunked (ID: {document_id}): "
                    f"{word_count} words in single chunk"
                )

        # Record metrics for analysis
        chunk_overlaps = (
            [self.chunk_overlap] * (len(chunks) - 1) if len(chunks) > 1 else []
        )
        self.metrics.log_document_metrics(
            word_count=word_count,
            chunk_count=len(chunks),
            chunk_sizes=chunks,  # Pass actual chunk text for word counting
            chunk_overlaps=chunk_overlaps,
            document_id=document_id,
        )

    def _merge_small_chunks(
        self, chunks: list[str], document_id: str = None
    ) -> list[str]:
        """
        Merge small chunks to better meet the target word count range (225-450 words).

        Args:
            chunks (list[str]): The original chunks
            document_id (str, optional): Identifier for the document

        Returns:
            list[str]: Merged chunks that better meet target word count
        """
        if not chunks:
            return chunks

        target_min_words = 225
        target_max_words = 450
        merged_chunks = []
        current_merged = []
        current_word_count = 0

        for chunk in chunks:
            chunk_words = len(chunk.split())

            # If this chunk alone is already in target range or too large, handle it separately
            if chunk_words >= target_min_words:
                # First, finalize any accumulated chunks
                if current_merged:
                    merged_text = " ".join(current_merged)
                    merged_chunks.append(merged_text)
                    self.logger.debug(
                        f"Merged {len(current_merged)} small chunks into {len(merged_text.split())} words"
                    )
                    current_merged = []
                    current_word_count = 0

                # Add this chunk as-is (it's already good size or too large to merge)
                merged_chunks.append(chunk)
                if chunk_words > target_max_words:
                    self.logger.debug(
                        f"Kept oversized chunk: {chunk_words} words (ID: {document_id})"
                    )
                else:
                    self.logger.debug(
                        f"Kept target-sized chunk: {chunk_words} words (ID: {document_id})"
                    )
            else:
                # This chunk is too small, try to merge it
                if current_word_count + chunk_words <= target_max_words:
                    # Can add to current merge group
                    current_merged.append(chunk)
                    current_word_count += chunk_words

                    # If we've reached a good size, finalize this merge
                    if current_word_count >= target_min_words:
                        merged_text = " ".join(current_merged)
                        merged_chunks.append(merged_text)
                        self.logger.debug(
                            f"Merged {len(current_merged)} chunks into {current_word_count} words"
                        )
                        current_merged = []
                        current_word_count = 0
                else:
                    # Adding this chunk would exceed max, finalize current merge first
                    if current_merged:
                        merged_text = " ".join(current_merged)
                        merged_chunks.append(merged_text)
                        self.logger.debug(
                            f"Merged {len(current_merged)} chunks into {current_word_count} words (below target)"
                        )

                    # Start new merge group with this chunk
                    current_merged = [chunk]
                    current_word_count = chunk_words

        # Handle any remaining chunks in current_merged
        if current_merged:
            merged_text = " ".join(current_merged)
            merged_chunks.append(merged_text)
            self.logger.debug(
                f"Final merge: {len(current_merged)} chunks into {current_word_count} words"
            )

        # Log the improvement
        original_in_range = sum(
            1
            for chunk in chunks
            if target_min_words <= len(chunk.split()) <= target_max_words
        )
        merged_in_range = sum(
            1
            for chunk in merged_chunks
            if target_min_words <= len(chunk.split()) <= target_max_words
        )

        self.logger.info(
            f"Chunk merging (ID: {document_id}): {len(chunks)} → {len(merged_chunks)} chunks, "
            f"target range: {original_in_range} → {merged_in_range}"
        )

        return merged_chunks

    def split_text(self, text: str, document_id: str = None) -> list[str]:
        """
        Split text into chunks using spaCy.

        Args:
            text (str): The text to split
            document_id (str, optional): Identifier for the document being processed

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
            original_length = len(text)
            text = self._clean_text(text)
            cleaned_length = len(text)

            # Pre-tokenize the text once for efficiency
            doc = None
            if text.strip():
                doc = self.nlp(text)
                self.logger.debug("Pre-tokenized text for word count and chunking")
            else:
                self.logger.debug("Empty text after cleaning, skipping tokenization")
                return []

            # Estimate word count using pre-tokenized doc and set dynamic chunk sizes
            word_count = self._estimate_word_count(text, doc=doc)
            original_chunk_size = self.chunk_size
            original_chunk_overlap = self.chunk_overlap
            self._set_dynamic_chunk_size(word_count)

            # Log document-level metrics
            self.logger.info(
                f"Processing document (ID: {document_id}): {word_count} words, "
                f"original length: {original_length} chars, cleaned: {cleaned_length} chars"
            )
            self.logger.info(
                f"Dynamic chunk sizing: {self.chunk_size} tokens, {self.chunk_overlap} overlap "
                f"(was {original_chunk_size}/{original_chunk_overlap})"
            )

            # If text is empty, return empty list
            if not text.strip():
                return []

            chunks = []

            # Handle space separator specially - split into word-based chunks
            if self.separator == " ":
                words = (
                    [token.text for token in doc if not token.is_space]
                    if doc
                    else text.split()
                )
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
                        # Use pre-tokenized doc if possible, or re-tokenize this split
                        split_doc = (
                            next(
                                (d for d in doc.sents if d.text.strip() == split_text),
                                None,
                            )
                            if doc
                            else None
                        )
                        if not split_doc:
                            split_doc = self.nlp(split_text)
                            self.logger.debug(
                                "Re-tokenized split for sentence-based splitting"
                            )

                        current_chunk = []
                        current_size = 0

                        for sent in split_doc.sents:
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
                    # Post-process chunks to merge small ones and reach target word count
                    result = self._merge_small_chunks(result, document_id)
                    # Log detailed chunking metrics for overlap case
                    self._log_chunk_metrics(result, word_count, document_id)
                    return result
                except Exception as e:
                    error_msg = f"Error applying chunk overlap: {str(e)}"
                    self.logger.error(error_msg)
                    raise RuntimeError(error_msg) from e

            self.logger.info(f"Split text into {len(chunks)} chunks without overlap")

            # Post-process chunks to merge small ones and reach target word count
            chunks = self._merge_small_chunks(chunks, document_id)

            # Log detailed chunking metrics for non-overlap case
            self._log_chunk_metrics(chunks, word_count, document_id)
            return chunks
        except Exception as e:
            if isinstance(e, ValueError | RuntimeError):
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
            self.logger.info(f"Starting to split {len(documents)} documents")

            for i, doc in enumerate(
                tqdm(documents, desc="Splitting documents", unit="doc")
            ):
                if not isinstance(doc, Document):
                    error_msg = f"Expected Document object, got {type(doc)}"
                    self.logger.error(error_msg)
                    raise ValueError(error_msg)

                text = doc.page_content
                # Generate document ID from metadata or use index
                document_id = (
                    doc.metadata.get("source")
                    or doc.metadata.get("title")
                    or doc.metadata.get("id")
                    or f"doc_{i}"
                )

                chunks = self.split_text(text, document_id=document_id)

                for j, chunk in enumerate(chunks):
                    if chunk:
                        # Add chunk index to metadata for tracking
                        chunk_metadata = doc.metadata.copy()
                        chunk_metadata["chunk_index"] = j
                        chunk_metadata["total_chunks"] = len(chunks)
                        chunk_metadata["document_id"] = document_id

                        chunked_docs.append(
                            Document(page_content=chunk, metadata=chunk_metadata)
                        )

            self.logger.info(
                f"Split {len(documents)} documents into {len(chunked_docs)} chunks"
            )

            # Log comprehensive metrics summary
            self.metrics.log_summary(self.logger)

            return chunked_docs
        except Exception as e:
            if isinstance(e, ValueError | RuntimeError):
                raise
            error_msg = f"Unexpected error in split_documents: {str(e)}"
            self.logger.error(error_msg)
            raise RuntimeError(error_msg) from e

    def get_metrics_summary(self) -> dict:
        """
        Get a dictionary summary of chunking metrics for external analysis.

        Returns:
            dict: Summary of chunking metrics including distributions and edge cases
        """
        return {
            "total_documents": self.metrics.total_documents,
            "total_chunks": self.metrics.total_chunks,
            "avg_chunks_per_document": self.metrics.total_chunks
            / self.metrics.total_documents
            if self.metrics.total_documents > 0
            else 0,
            "word_count_distribution": self.metrics.word_count_distribution.copy(),
            "chunk_size_distribution": self.metrics.chunk_size_distribution.copy(),
            "edge_cases_count": len(self.metrics.edge_cases),
            "anomalies_count": len(self.metrics.anomalies),
            "edge_cases": self.metrics.edge_cases.copy(),
            "anomalies": self.metrics.anomalies.copy(),
        }
