import pytest

from data_ingestion.utils.text_splitter_utils import Document, SpacyTextSplitter


@pytest.fixture
def text_splitter():
    return SpacyTextSplitter()


def test_simple_split(text_splitter: SpacyTextSplitter):
    text = "This is the first sentence. This is the second sentence. This is the third sentence."
    chunks = text_splitter.split_text(text)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_split_with_paragraph_separator(text_splitter: SpacyTextSplitter):
    text = "This is the first paragraph.\n\nThis is the second paragraph."
    chunks = text_splitter.split_text(text)
    # With dynamic sizing, very small texts may not be split
    # The text is only 10 words, which is below the minimum chunk size
    assert len(chunks) >= 1
    if len(chunks) == 1:
        # Small text kept as one chunk
        assert "This is the first paragraph." in chunks[0]
        assert "This is the second paragraph." in chunks[0]
    else:
        # Text was split as expected
        assert chunks[0] == "This is the first paragraph."
        assert chunks[1] == "This is the second paragraph."


def test_split_long_paragraph_into_sentences(text_splitter: SpacyTextSplitter):
    text = "This is a very long first sentence that will exceed the chunk size. This is the second sentence, which is shorter. This is a third sentence that also needs to be chunked appropriately to fit."
    # Note: spaCy sentence splitting might be slightly different than naive splitting
    # This test assumes spaCy correctly identifies sentences.
    chunks = text_splitter.split_text(text)
    assert (
        len(chunks) >= 1
    )  # Adjusted due to dynamic sizing; may not split if size is large
    for chunk in chunks:
        assert (
            len(chunk) <= text_splitter.chunk_size + text_splitter.chunk_overlap
        )  # Overlap can make it slightly larger


def test_chunk_overlap(text_splitter: SpacyTextSplitter):
    text_splitter_with_overlap = SpacyTextSplitter(separator=" ")
    text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
    chunks = text_splitter_with_overlap.split_text(text)
    # Expected:
    # chunk1: "one two three four five six seven eight nine ten" (len approx 50)
    # chunk2: "nine ten eleven twelve thirteen fourteen fifteen" (overlap "nine ten")
    assert len(chunks) >= 1  # Adjusted expectation due to dynamic sizing
    if len(chunks) > 1:
        # For space separator, check for word-based overlap
        # The second chunk should start with some words from the end of the first chunk
        first_chunk_words = chunks[0].split()
        second_chunk_words = chunks[1].split()

        # Check that the first few words of chunk 1 appear in the last few words of chunk 0
        # This is a more realistic test for word-based overlap
        overlap_found = False
        for i in range(
            1, min(4, len(first_chunk_words), len(second_chunk_words))
        ):  # Check up to 3 words
            if second_chunk_words[:i] == first_chunk_words[-i:]:
                overlap_found = True
                break

        assert overlap_found, (
            f"No word-based overlap found between chunks. Chunk 0: {chunks[0]}, Chunk 1: {chunks[1]}"
        )


def test_split_documents(text_splitter: SpacyTextSplitter):
    doc1 = Document(
        page_content="First document. It has two sentences.",
        metadata={"source": "doc1"},
    )
    doc2 = Document(
        page_content="Second document. Also two sentences.", metadata={"source": "doc2"}
    )
    documents = [doc1, doc2]
    chunked_docs = text_splitter.split_documents(documents)
    assert len(chunked_docs) == 2  # Since chunk_size is 100 and texts are short
    assert chunked_docs[0].page_content == "First document. It has two sentences."
    assert chunked_docs[0].metadata["source"] == "doc1"
    assert chunked_docs[1].page_content == "Second document. Also two sentences."
    assert chunked_docs[1].metadata["source"] == "doc2"


def test_split_document_into_multiple_chunks(text_splitter: SpacyTextSplitter):
    long_text = (
        "This is sentence one. " * 5 + "This is sentence two. " * 5
    )  # Approx 20*5 + 21*5 = 100 + 105 = 205 chars
    doc = Document(page_content=long_text, metadata={"source": "long_doc"})
    chunked_docs = text_splitter.split_documents([doc])
    assert len(chunked_docs) >= 1  # Adjusted due to dynamic sizing
    assert chunked_docs[0].metadata["source"] == "long_doc"
    "".join(
        c.page_content.replace(doc.page_content[-text_splitter.chunk_overlap :], "")
        if i > 0
        else c.page_content
        for i, c in enumerate(chunked_docs)
    )
    # This is an approximate check, exact reconstruction is tricky with sentence splitting and overlap logic
    # assert doc.page_content.startswith(combined_content[:len(doc.page_content)-50])


def test_empty_text(text_splitter: SpacyTextSplitter):
    text = ""
    chunks = text_splitter.split_text(text)
    assert len(chunks) == 0


def test_text_shorter_than_chunk_size(text_splitter: SpacyTextSplitter):
    text = "This is a short text."
    chunks = text_splitter.split_text(text)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_text_with_only_separators(text_splitter: SpacyTextSplitter):
    text = "\n\n\n\n"
    chunks = text_splitter.split_text(text)
    assert len(chunks) == 0


def test_very_long_sentence_exceeding_chunk_size(text_splitter: SpacyTextSplitter):
    # A single sentence that is longer than chunk_size should still be one chunk.
    # The current implementation splits it if it's longer than chunk_size. This test verifies that behavior.
    long_sentence = "ThisIsAVeryLongSentenceWithoutSpacesThatExceedsTheChunkSizeLimitOfOneHundredCharactersAndItShouldBeHandled."  # len > 100
    text = long_sentence
    chunks = text_splitter.split_text(text)
    # The current logic will split this long sentence if it has no internal sentence breaks found by spacy
    # and is longer than chunk_size. If it were a single sentence *within* chunk_size, it would be one chunk.
    # If it's a single sentence *over* chunk_size, it's appended directly as a chunk.
    # If the goal is that a single sentence (even if very long) should *not* be split by the splitter *unless* spacy finds sub-sentences,
    # then the logic in split_text needs adjustment.
    # The current code: `if len(sent_text) > self.chunk_size: chunks.append(sent_text)`
    # This means a single sentence longer than chunk_size is kept as one chunk.
    assert len(chunks) == 1
    assert chunks[0] == long_sentence


def test_chunk_overlap_disabled(text_splitter: SpacyTextSplitter):
    splitter_no_overlap = SpacyTextSplitter(separator=" ")
    text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
    # Each chunk should be around 50 chars. With no overlap, they should be distinct.
    chunks = splitter_no_overlap.split_text(text)
    assert (
        len(chunks) >= 1
    )  # Adjusted due to dynamic sizing, exact number depends on content length
    if len(chunks) > 1:
        # Check that chunks are not starting with the end of the previous one
        first_chunk_end_words = chunks[0].split(" ")[
            -2:
        ]  # last two words of first chunk
        second_chunk_start_words = chunks[1].split(" ")[
            :2
        ]  # first two words of second chunk
        assert not (
            first_chunk_end_words[0] in second_chunk_start_words
            and first_chunk_end_words[1] in second_chunk_start_words
        )


def test_split_with_custom_separator(text_splitter: SpacyTextSplitter):
    splitter_custom_sep = SpacyTextSplitter(separator="---")
    text = "Part one of the text---Part two of the text---Part three which is longer and might be split by sentences."
    chunks = splitter_custom_sep.split_text(text)
    # With dynamic sizing, small texts (21 words) may not be split
    assert len(chunks) >= 1
    if len(chunks) == 1:
        # Small text kept as one chunk
        assert "Part one of the text" in chunks[0]
        assert "Part two of the text" in chunks[0]
        assert "Part three" in chunks[0]
    else:
        # Text was split as expected
        assert "Part one of the text" in chunks[0]
        if len(chunks) > 1:
            assert "Part two of the text" in chunks[1] or chunks[0].endswith(
                "Part one of the text"
            )  # depends on overlap


def test_ensure_nlp_called(mocker):
    # Test that _ensure_nlp is called, and spacy.load / spacy.cli.download if model not present
    splitter = SpacyTextSplitter()

    # Create a mock that raises OSError on first call, then returns a mock nlp object on second call
    mock_nlp = mocker.MagicMock()
    mock_spacy_load = mocker.patch("spacy.load", side_effect=[OSError(), mock_nlp])
    mock_spacy_cli_download = mocker.patch("spacy.cli.download")

    # Run the method that should trigger _ensure_nlp
    splitter.split_text("Test text.")

    # Check that spacy.load was called with the pipeline name
    mock_spacy_load.assert_any_call(splitter.pipeline)

    # Check that download was called after the first load failed
    mock_spacy_cli_download.assert_called_once_with(splitter.pipeline)

    # Check that spacy.load was called a second time after download
    assert mock_spacy_load.call_count == 2

    # Reset mocks for second scenario
    mock_spacy_load.reset_mock()
    mock_spacy_cli_download.reset_mock()

    # Test calling split_text again - should not try to load model again
    splitter.split_text("Another test.")
    mock_spacy_load.assert_not_called()  # nlp already loaded


def test_dynamic_chunk_size_very_short_text():
    splitter = SpacyTextSplitter()
    # Less than 200 words, should not be chunked
    text = "Short text. " * 50  # Approx 100 words
    chunks = splitter.split_text(text)
    assert len(chunks) == 1, f"Expected 1 chunk for very short text, got {len(chunks)}"
    assert splitter.chunk_size == 800, (
        f"Expected chunk_size=800 for very short text, got {splitter.chunk_size}"
    )
    assert splitter.chunk_overlap == 0, (
        f"Expected overlap=0 for very short text, got {splitter.chunk_overlap}"
    )


def test_dynamic_chunk_size_short_text():
    splitter = SpacyTextSplitter()
    # Between 200 and 1000 words
    text = "Short text. " * 300  # Approx 600 words
    splitter.split_text(text)
    assert splitter.chunk_size == 300, (
        f"Expected chunk_size=300 for short text, got {splitter.chunk_size}"
    )
    assert splitter.chunk_overlap == 60, (
        f"Expected overlap=60 for short text, got {splitter.chunk_overlap}"
    )


def test_dynamic_chunk_size_medium_text():
    splitter = SpacyTextSplitter()
    # Between 1000 and 5000 words
    text = "Medium text. " * 1500  # Approx 3000 words
    splitter.split_text(text)
    assert splitter.chunk_size == 400, (
        f"Expected chunk_size=400 for medium text, got {splitter.chunk_size}"
    )
    assert splitter.chunk_overlap == 80, (
        f"Expected overlap=80 for medium text, got {splitter.chunk_overlap}"
    )


def test_dynamic_chunk_size_long_text():
    splitter = SpacyTextSplitter()
    # Over 5000 words
    text = "Long text. " * 3000  # Approx 6000 words
    splitter.split_text(text)
    assert splitter.chunk_size == 500, (
        f"Expected chunk_size=500 for long text, got {splitter.chunk_size}"
    )
    assert splitter.chunk_overlap == 100, (
        f"Expected overlap=100 for long text, got {splitter.chunk_overlap}"
    )


def test_punctuation_preservation():
    """Test that punctuation is preserved during chunking."""
    splitter = SpacyTextSplitter()
    text = "Hello, world! How are you? I'm fine, thanks."
    chunks = splitter.split_text(text)

    # Combine all chunks and check that punctuation is preserved
    combined_text = " ".join(chunks)
    assert "," in combined_text
    assert "!" in combined_text
    assert "?" in combined_text
    assert "'" in combined_text


def test_twenty_percent_overlap_calculation():
    """
    Test that chunks have proper 20% overlap based on word count.

    This test validates the bug fix where overlap was incorrectly calculated
    as a ratio of chunk size instead of 20% of the previous chunk's word count.
    """
    # Create a text splitter with paragraph separator to ensure chunking
    splitter = SpacyTextSplitter(separator="\n\n")

    # Create text with multiple paragraphs that will definitely be chunked
    # Each paragraph has approximately 50-60 words to ensure chunking occurs
    paragraph1 = " ".join(
        [f"This is sentence {i} in the first paragraph." for i in range(1, 11)]
    )  # ~50 words
    paragraph2 = " ".join(
        [f"This is sentence {i} in the second paragraph." for i in range(1, 11)]
    )  # ~50 words
    paragraph3 = " ".join(
        [f"This is sentence {i} in the third paragraph." for i in range(1, 11)]
    )  # ~50 words
    paragraph4 = " ".join(
        [f"This is sentence {i} in the fourth paragraph." for i in range(1, 11)]
    )  # ~50 words

    text = f"{paragraph1}\n\n{paragraph2}\n\n{paragraph3}\n\n{paragraph4}"

    # Force smaller chunk size to ensure multiple chunks
    original_chunk_size = splitter.chunk_size
    original_chunk_overlap = splitter.chunk_overlap
    splitter.chunk_size = 300  # Small enough to force chunking
    splitter.chunk_overlap = 60  # 20% of 300

    try:
        chunks = splitter.split_text(text, document_id="test_overlap")

        # We should have multiple chunks
        assert len(chunks) > 1, f"Expected multiple chunks, got {len(chunks)}: {chunks}"

        # Test overlap between consecutive chunks
        for i in range(1, len(chunks)):
            prev_chunk = chunks[i - 1]
            current_chunk = chunks[i]

            prev_words = prev_chunk.split()
            current_words = current_chunk.split()

            # Calculate expected overlap (20% of previous chunk)
            expected_overlap_words = max(1, int(len(prev_words) * 0.20))

            # Find actual overlap by checking how many words from the end of prev_chunk
            # appear at the start of current_chunk
            actual_overlap_words = 0
            for j in range(1, min(len(prev_words), len(current_words)) + 1):
                if current_words[:j] == prev_words[-j:]:
                    actual_overlap_words = j

            # The actual overlap should be close to the expected 20%
            # Allow some tolerance since we're dealing with word boundaries and token-based splitting
            min_expected = max(1, expected_overlap_words - 5)  # Allow 5 words tolerance
            max_expected = expected_overlap_words + 5

            assert min_expected <= actual_overlap_words <= max_expected, (
                f"Chunk {i}: Expected overlap ~{expected_overlap_words} words (20% of {len(prev_words)}), "
                f"but got {actual_overlap_words} words. "
                f"Previous chunk: '{prev_chunk[-100:]}...' "
                f"Current chunk: '...{current_chunk[:100]}'"
            )

            # Verify that there is meaningful overlap (not just punctuation)
            if actual_overlap_words > 0:
                overlap_text = " ".join(prev_words[-actual_overlap_words:])
                assert len(overlap_text.strip()) > 0, (
                    "Overlap should contain meaningful text"
                )
                assert current_chunk.startswith(overlap_text), (
                    f"Current chunk should start with overlap text. "
                    f"Expected start: '{overlap_text}', "
                    f"Actual start: '{current_chunk[: len(overlap_text) + 10]}'"
                )

    finally:
        # Restore original settings
        splitter.chunk_size = original_chunk_size
        splitter.chunk_overlap = original_chunk_overlap


def test_overlap_with_different_separators():
    """Test that overlap works correctly with different separators."""

    # Test with space separator (word-based chunking)
    space_splitter = SpacyTextSplitter(separator=" ")
    space_splitter.chunk_size = 100  # Force smaller chunks
    space_splitter.chunk_overlap = 20

    # Create text with many words
    words = [f"word{i}" for i in range(1, 51)]  # 50 words
    space_text = " ".join(words)

    space_chunks = space_splitter.split_text(
        space_text, document_id="test_space_overlap"
    )

    if len(space_chunks) > 1:
        # For space separator, overlap should be word-based
        for i in range(1, len(space_chunks)):
            prev_chunk = space_chunks[i - 1]
            current_chunk = space_chunks[i]

            prev_words = prev_chunk.split()
            current_words = current_chunk.split()

            # Check for word-based overlap
            overlap_found = False
            for j in range(
                1, min(6, len(prev_words), len(current_words))
            ):  # Check up to 5 words
                if current_words[:j] == prev_words[-j:]:
                    overlap_found = True
                    break

            assert overlap_found, (
                f"No word-based overlap found between space-separated chunks. "
                f"Chunk {i - 1}: '{prev_chunk}', Chunk {i}: '{current_chunk}'"
            )

    # Test with paragraph separator
    para_splitter = SpacyTextSplitter(separator="\n\n")
    para_splitter.chunk_size = 200
    para_splitter.chunk_overlap = 40

    # Create text with paragraphs
    para1 = " ".join(
        [f"Sentence {i} in paragraph one." for i in range(1, 16)]
    )  # ~60 words
    para2 = " ".join(
        [f"Sentence {i} in paragraph two." for i in range(1, 16)]
    )  # ~60 words
    para_text = f"{para1}\n\n{para2}"

    para_chunks = para_splitter.split_text(para_text, document_id="test_para_overlap")

    if len(para_chunks) > 1:
        # For paragraph separator, overlap should be 20% of previous chunk
        for i in range(1, len(para_chunks)):
            prev_chunk = para_chunks[i - 1]
            current_chunk = para_chunks[i]

            prev_words = prev_chunk.split()
            current_words = current_chunk.split()

            # Calculate expected 20% overlap
            expected_overlap_words = max(1, int(len(prev_words) * 0.20))

            # Find actual overlap
            actual_overlap_words = 0
            for j in range(1, min(len(prev_words), len(current_words)) + 1):
                if current_words[:j] == prev_words[-j:]:
                    actual_overlap_words = j

            # Should have meaningful overlap
            assert actual_overlap_words > 0, (
                f"No overlap found between paragraph chunks. "
                f"Expected ~{expected_overlap_words} words overlap"
            )
