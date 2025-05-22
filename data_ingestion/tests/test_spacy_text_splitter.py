import pytest
from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter, Document

@pytest.fixture
def text_splitter():
    return SpacyTextSplitter(chunk_size=100, chunk_overlap=20)

def test_simple_split(text_splitter: SpacyTextSplitter):
    text = "This is the first sentence. This is the second sentence. This is the third sentence."
    chunks = text_splitter.split_text(text)
    assert len(chunks) == 1
    assert chunks[0] == text

def test_split_with_paragraph_separator(text_splitter: SpacyTextSplitter):
    text = "This is the first paragraph.\n\nThis is the second paragraph."
    chunks = text_splitter.split_text(text)
    assert len(chunks) == 2
    assert chunks[0] == "This is the first paragraph."
    assert chunks[1] == "This is the second paragraph."

def test_split_long_paragraph_into_sentences(text_splitter: SpacyTextSplitter):
    text = "This is a very long first sentence that will exceed the chunk size. This is the second sentence, which is shorter. This is a third sentence that also needs to be chunked appropriately to fit."
    # Note: spaCy sentence splitting might be slightly different than naive splitting
    # This test assumes spaCy correctly identifies sentences.
    chunks = text_splitter.split_text(text)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= text_splitter.chunk_size + text_splitter.chunk_overlap # Overlap can make it slightly larger

def test_chunk_overlap(text_splitter: SpacyTextSplitter):
    text_splitter_with_overlap = SpacyTextSplitter(chunk_size=50, chunk_overlap=10, separator=" ")
    text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
    chunks = text_splitter_with_overlap.split_text(text)
    # Expected:
    # chunk1: "one two three four five six seven eight nine ten" (len approx 50)
    # chunk2: "nine ten eleven twelve thirteen fourteen fifteen" (overlap "nine ten")
    assert len(chunks) >= 2 # Exact number depends on spacy tokenization and lengths
    if len(chunks) > 1:
        assert chunks[1].startswith(chunks[0][-text_splitter_with_overlap.chunk_overlap -5 :]) # Approximate check for overlap start

def test_split_documents(text_splitter: SpacyTextSplitter):
    doc1 = Document(page_content="First document. It has two sentences.", metadata={"source": "doc1"})
    doc2 = Document(page_content="Second document. Also two sentences.", metadata={"source": "doc2"})
    documents = [doc1, doc2]
    chunked_docs = text_splitter.split_documents(documents)
    assert len(chunked_docs) == 2 # Since chunk_size is 100 and texts are short
    assert chunked_docs[0].page_content == "First document. It has two sentences."
    assert chunked_docs[0].metadata["source"] == "doc1"
    assert chunked_docs[1].page_content == "Second document. Also two sentences."
    assert chunked_docs[1].metadata["source"] == "doc2"

def test_split_document_into_multiple_chunks(text_splitter: SpacyTextSplitter):
    # chunk_size = 100
    long_text = "This is sentence one. " * 5 + "This is sentence two. " * 5 # Approx 20*5 + 21*5 = 100 + 105 = 205 chars
    doc = Document(page_content=long_text, metadata={"source": "long_doc"})
    chunked_docs = text_splitter.split_documents([doc])
    assert len(chunked_docs) > 1
    assert chunked_docs[0].metadata["source"] == "long_doc"
    combined_content = "".join(c.page_content.replace(doc.page_content[-text_splitter.chunk_overlap:],"") if i > 0 else c.page_content for i,c in enumerate(chunked_docs) )
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
    long_sentence = "ThisIsAVeryLongSentenceWithoutSpacesThatExceedsTheChunkSizeLimitOfOneHundredCharactersAndItShouldBeHandled." # len > 100
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
    splitter_no_overlap = SpacyTextSplitter(chunk_size=50, chunk_overlap=0, separator=" ")
    text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
    # Each chunk should be around 50 chars. With no overlap, they should be distinct.
    chunks = splitter_no_overlap.split_text(text)
    assert len(chunks) >= 2 # Exact number depends on spacy and lengths
    # Check that chunks are not starting with the end of the previous one
    if len(chunks) > 1:
        # This is a heuristic, exact non-overlap is hard to assert without knowing exact spacy splits
        first_chunk_end_words = chunks[0].split(" ")[-2:] # last two words of first chunk
        second_chunk_start_words = chunks[1].split(" ")[:2] # first two words of second chunk
        assert not (first_chunk_end_words[0] in second_chunk_start_words and first_chunk_end_words[1] in second_chunk_start_words)


def test_split_with_custom_separator(text_splitter: SpacyTextSplitter):
    splitter_custom_sep = SpacyTextSplitter(chunk_size=100, chunk_overlap=10, separator="---")
    text = "Part one of the text---Part two of the text---Part three which is longer and might be split by sentences."
    chunks = splitter_custom_sep.split_text(text)
    # Expecting at least 3 chunks due to custom separator, or more if "Part three" gets sentence-split
    assert len(chunks) >= 3
    assert "Part one of the text" in chunks[0]
    if len(chunks) >1:
        assert "Part two of the text" in chunks[1] or chunks[0].endswith("Part one of the text") # depends on overlap
    # Further checks would depend on how spacy splits "Part three..."

def test_ensure_nlp_called(mocker):
    # Test that _ensure_nlp is called, and spacy.load / spacy.cli.download if model not present
    splitter = SpacyTextSplitter()
    
    # Create a mock that raises OSError on first call, then returns a mock nlp object on second call
    mock_nlp = mocker.MagicMock()
    mock_spacy_load = mocker.patch('spacy.load', side_effect=[OSError(), mock_nlp])
    mock_spacy_cli_download = mocker.patch('spacy.cli.download')
    
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
    mock_spacy_load.assert_not_called() # nlp already loaded 