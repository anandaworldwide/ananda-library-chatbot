"""
Text processing utilities for data ingestion.

This module provides comprehensive text cleaning and processing functions
for use across different ingestion pipelines (PDF, HTML/web content, SQL database).
Functions handle various text artifacts and normalize content for better
vectorization and retrieval quality.

Key features:
- HTML tag removal with BeautifulSoup
- Smart quote and Unicode character normalization
- Table of contents artifact removal
- Configurable whitespace normalization
- Combined text cleaning pipelines
"""

import logging
import re

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def remove_html_tags(text: str) -> str:
    """
    Remove HTML tags, script elements, style elements, and normalize whitespace.

    Uses BeautifulSoup for robust HTML parsing and tag removal.
    Particularly useful for content extracted from web pages or HTML-formatted
    database fields.

    Args:
        text: Input text that may contain HTML markup

    Returns:
        Clean text with HTML removed and whitespace normalized
    """
    if not text:
        return ""

    try:
        # Use BeautifulSoup to parse and remove unwanted tags
        soup = BeautifulSoup(text, "html.parser")

        # Remove script and style elements completely
        for script_or_style in soup(["script", "style"]):
            script_or_style.decompose()

        # Handle block vs inline elements differently for proper text extraction
        # Block elements should create paragraph breaks, inline elements should just add spaces
        block_elements = soup.find_all(
            [
                "p",
                "div",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "li",
                "blockquote",
                "article",
                "section",
            ]
        )
        for element in block_elements:
            # Insert double newline after block elements
            element.insert_after("\n\n")

        # Add spaces around inline elements to preserve word boundaries
        inline_elements = soup.find_all(
            [
                "strong",
                "em",
                "b",
                "i",
                "a",
                "span",
                "code",
                "small",
                "sup",
                "sub",
                "mark",
            ]
        )
        for element in inline_elements:
            # Insert space before and after inline elements
            element.insert_before(" ")
            element.insert_after(" ")

        # Get text content without separator or strip to preserve inserted breaks and spaces
        text = soup.get_text()

        # Normalize whitespace but preserve paragraph breaks (double newlines)
        # First, fix any excessive spacing within lines
        text = re.sub(r"[ \t]+", " ", text)
        # Then, normalize excessive newlines but preserve paragraph breaks
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    except Exception as e:
        logger.warning(f"Error parsing HTML content: {e}. Returning original text.")
        return text


def replace_smart_quotes(text: str) -> str:
    """
    Replace smart quotes and other special Unicode characters with ASCII equivalents.

    Converts various Unicode punctuation marks to standard ASCII characters
    for better compatibility and consistent processing across systems.

    Args:
        text: Input text that may contain Unicode punctuation

    Returns:
        Text with Unicode characters replaced by ASCII equivalents
    """
    if not text:
        return ""

    # Dictionary mapping smart characters to standard ones
    smart_quotes = {
        "\u2018": "'",
        "\u2019": "'",  # Single quotes
        "\u201c": '"',
        "\u201d": '"',  # Double quotes
        "\u2032": "'",
        "\u2033": '"',  # Prime symbols
        "\u2014": "-",
        "\u2013": "-",  # Em dash, en dash
        "\u2026": "...",  # Ellipsis
        "\u2011": "-",  # Non-breaking hyphen
        "\u00a0": " ",  # Non-breaking space
        "\u00ab": '"',
        "\u00bb": '"',  # Guillemets
        "\u201a": ",",
        "\u201e": ",",  # Low single/double quotes as commas
        "\u2022": "*",  # Bullet
        "\u2010": "-",  # Hyphen
    }

    # Replace known smart characters
    for smart, standard in smart_quotes.items():
        text = text.replace(smart, standard)

    # Remove any remaining non-ASCII characters, keeping basic whitespace
    text = "".join(c for c in text if ord(c) < 128 or c in [" ", "\n", "\t"])

    return text


def clean_document_text(text: str) -> str:
    """
    Clean document text by removing table of contents dots and other artifacts.

    Specifically designed for PDF and document content that may contain
    table of contents formatting with long dot sequences, excessive whitespace,
    and other document-specific artifacts.

    Args:
        text: Input document text to clean

    Returns:
        Cleaned text with artifacts removed and whitespace normalized
    """
    if not text:
        return text

    # Remove long sequences of dots (table of contents formatting)
    # Match 4 or more dots with optional spaces between them
    text = re.sub(r"\.(\s*\.){3,}", " ", text)

    # Clean up multiple spaces (but preserve newlines)
    text = re.sub(r"[ \t]+", " ", text)

    # Clean up excessive newlines (more than 2) but preserve paragraph breaks
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def normalize_whitespace(text: str, preserve_paragraphs: bool = True) -> str:
    """
    Normalize whitespace in text with configurable paragraph preservation.

    Args:
        text: Input text to normalize
        preserve_paragraphs: If True, preserve double newlines as paragraph breaks.
                           If False, collapse all whitespace to single spaces.

    Returns:
        Text with normalized whitespace
    """
    if not text:
        return text

    if preserve_paragraphs:
        # Preserve paragraph breaks (double newlines) but normalize other whitespace
        # First, normalize spaces and tabs
        text = re.sub(r"[ \t]+", " ", text)
        # Then, normalize excessive newlines but keep paragraph breaks
        # This handles cases where we have more than 2 newlines but preserves double newlines
        text = re.sub(r"\n{3,}", "\n\n", text)
        # Also clean up any single newlines that have only spaces around them
        text = re.sub(r"\n[ \t]*\n", "\n\n", text)
    else:
        # Collapse all whitespace to single spaces
        text = re.sub(r"\s+", " ", text)

    return text.strip()


def extract_text_content(
    text: str, content_type: str = "auto", preserve_formatting: bool = True
) -> str:
    """
    Combined text cleaning pipeline that processes text based on content type.

    This is the main entry point for text processing that automatically
    applies appropriate cleaning based on the detected or specified content type.

    Args:
        text: Input text to process
        content_type: Type of content - "html", "pdf", "plain", or "auto" for detection
        preserve_formatting: If True, preserves paragraph breaks and basic formatting

    Returns:
        Processed and cleaned text ready for vectorization
    """
    if not text:
        return ""

    # Auto-detect content type if not specified
    if content_type == "auto":
        if "<" in text and ">" in text:
            # Likely contains HTML
            content_type = "html"
        elif any(pattern in text for pattern in [".....", "• ", "Chapter ", "Page "]):
            # Likely PDF with document artifacts
            content_type = "pdf"
        else:
            content_type = "plain"

    logger.debug(f"Processing text as content_type: {content_type}")

    # Apply appropriate cleaning based on content type
    if content_type == "html":
        # HTML content: remove tags first, then normalize
        text = remove_html_tags(text)
        text = replace_smart_quotes(text)
        text = normalize_whitespace(text, preserve_paragraphs=preserve_formatting)

    elif content_type == "pdf":
        # PDF content: clean document artifacts, then normalize
        text = clean_document_text(text)
        text = replace_smart_quotes(text)
        # PDF text often has good paragraph structure, so preserve it
        text = normalize_whitespace(text, preserve_paragraphs=True)

    else:  # plain text
        # Plain text: just normalize quotes and whitespace
        text = replace_smart_quotes(text)
        text = normalize_whitespace(text, preserve_paragraphs=preserve_formatting)

    return text


def is_content_meaningful(text: str, min_length: int = 10) -> bool:
    """
    Check if text content is meaningful (not just whitespace, symbols, or very short).

    Useful for filtering out empty pages, navigation elements, or other
    non-substantive content before processing.

    Args:
        text: Text to evaluate
        min_length: Minimum length for content to be considered meaningful

    Returns:
        True if content appears meaningful, False otherwise
    """
    if not text:
        return False

    # Clean and normalize for evaluation
    clean_text = text.strip()

    # Remove common non-content patterns
    clean_text = re.sub(r"[\s\.,;:!?\-_(){}[\]]+", "", clean_text)

    # Check if we have enough meaningful characters
    return len(clean_text) >= min_length


def split_into_sentences(text: str) -> list[str]:
    """
    Split text into sentences using basic punctuation rules.

    Simple sentence splitting that works reasonably well for most content.
    For more sophisticated sentence splitting, consider using spaCy or NLTK.

    Args:
        text: Input text to split

    Returns:
        List of sentences with original punctuation preserved
    """
    if not text:
        return []

    # Basic sentence splitting on common punctuation
    # Use a more precise pattern that captures the punctuation with the sentence
    sentences = re.split(r"(?<=[.!?])\s+", text)

    # Clean up and filter out empty sentences
    sentences = [s.strip() for s in sentences if s.strip()]

    return sentences


# Configuration presets for different use cases
TEXT_PROCESSING_PRESETS = {
    "pdf_document": {"content_type": "pdf", "preserve_formatting": True},
    "web_content": {"content_type": "html", "preserve_formatting": True},
    "database_field": {"content_type": "auto", "preserve_formatting": False},
    "minimal_clean": {"content_type": "plain", "preserve_formatting": True},
}


def process_with_preset(text: str, preset: str = "minimal_clean") -> str:
    """
    Process text using a predefined configuration preset.

    Args:
        text: Input text to process
        preset: Name of the preset configuration to use

    Returns:
        Processed text using the specified preset

    Raises:
        ValueError: If preset name is not recognized
    """
    if preset not in TEXT_PROCESSING_PRESETS:
        available = ", ".join(TEXT_PROCESSING_PRESETS.keys())
        raise ValueError(f"Unknown preset '{preset}'. Available presets: {available}")

    config = TEXT_PROCESSING_PRESETS[preset]
    return extract_text_content(text, **config)
