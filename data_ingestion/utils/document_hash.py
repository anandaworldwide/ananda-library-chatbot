"""
Document hash generation utility for consistent Pinecone ID creation.

Generates deterministic hashes based purely on content text, enabling true content-based
deduplication across different libraries, source locations, titles, and authors.
"""

import hashlib


def generate_document_hash(
    title: str | None = None,
    author: str | None = None,
    content_type: str = "text",
    chunk_text: str | None = None,
) -> str:
    """
    Generate a consistent 8-character hash based purely on content.

    This hash is based only on the actual content (content_type and chunk_text) to enable
    true content-based deduplication. Identical text content will generate the same hash
    regardless of title, author, library, or source location differences.

    Args:
        title: Document title (ignored - kept for compatibility)
        author: Document author (ignored - kept for compatibility)
        content_type: Type of content (text, audio, video, pdf)
        chunk_text: The actual text content of the chunk

    Returns:
        8-character hex string hash based purely on content

    Examples:
        >>> generate_document_hash(content_type="text", chunk_text="Some content")
        "a1b2c3d4"

        >>> generate_document_hash(title="Ignored", author="Ignored", content_type="audio", chunk_text="Same content")
        "e5f6g7h8"
    """
    # Build content key from content properties only
    key_parts = []

    # Always include content type first for consistency
    key_parts.append(content_type.strip() if content_type else "text")

    if chunk_text and chunk_text.strip():
        # Use the full chunk text for maximum content specificity
        key_parts.append(chunk_text.strip())
    else:
        # If no chunk text, use a fallback to avoid empty hashes
        key_parts.append("empty_content")

    # Join with consistent separator
    content_key = "||".join(key_parts)

    # Generate deterministic hash
    return hashlib.md5(content_key.encode("utf-8")).hexdigest()[:8]
