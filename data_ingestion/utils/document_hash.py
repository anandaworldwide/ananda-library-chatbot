"""
Document hash generation utility for consistent Pinecone ID creation.

Generates deterministic hashes based on document metadata rather than chunk content,
enabling easy identification and bulk operations on all chunks from the same document.
"""

import hashlib


def generate_document_hash(
    source: str,
    title: str | None = None,
    author: str | None = None,
    library: str | None = None,
    page_number: int | None = None,
) -> str:
    """
    Generate a consistent 8-character hash for a document based on its metadata.

    For PDFs and other paginated content, includes page_number to ensure uniqueness per page.
    For non-paginated content, omit page_number for document-level consistency.

    Args:
        source: Primary identifier (file path, URL, permalink, etc.)
        title: Document title (optional)
        author: Document author (optional)
        library: Library/domain name (optional)
        page_number: Page number for paginated documents (optional)

    Returns:
        8-character hex string hash

    Examples:
        >>> generate_document_hash("/path/to/file.pdf", "My Title", "Author Name", "Library", 1)
        "a1b2c3d4"

        >>> generate_document_hash("https://example.com/page", "Page Title")
        "e5f6g7h8"
    """
    # Build document key from available metadata, stripping whitespace
    key_parts = [source.strip()]

    if title and title.strip():
        key_parts.append(title.strip())
    if author and author.strip():
        key_parts.append(author.strip())
    if library and library.strip():
        key_parts.append(library.strip())
    if page_number is not None:
        key_parts.append(f"page_{page_number}")

    # Join with consistent separator
    document_key = "||".join(key_parts)

    # Generate deterministic hash
    return hashlib.md5(document_key.encode("utf-8")).hexdigest()[:8]
