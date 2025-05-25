#!/usr/bin/env python3
"""
Test script to verify enhanced chunking logging functionality.
This script tests the SpacyTextSplitter with various document types to ensure
comprehensive logging and metrics collection is working properly.
"""

import logging
import sys
from pathlib import Path

# Add the data_ingestion directory to the path
sys.path.insert(0, str(Path(__file__).parent))

from utils.text_splitter_utils import Document, SpacyTextSplitter

# Configure logging to see all the detailed output
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler("chunking_test.log")],
)


def test_chunking_logging():
    """Test the enhanced logging functionality of SpacyTextSplitter."""

    # Create test documents with different characteristics
    test_documents = [
        # Very short document (edge case)
        Document(
            page_content="This is a very short document with only a few words.",
            metadata={"source": "short_test.txt", "type": "test"},
        ),
        # Medium document
        Document(
            page_content="""
            This is a medium-length document that should be chunked appropriately.
            It contains multiple sentences and paragraphs to test the chunking logic.
            
            The second paragraph continues with more content to ensure we have enough
            text to trigger the medium content chunking strategy. This should result
            in chunks of around 400 tokens with 100-token overlap.
            
            The third paragraph adds even more content to make sure we cross the
            threshold for medium-length documents. This will help us test the
            dynamic chunk sizing functionality.
            """
            * 3,  # Repeat to make it longer
            metadata={"source": "medium_test.txt", "type": "test"},
        ),
        # Long document
        Document(
            page_content="""
            This is a very long document that should trigger the large content
            chunking strategy. It contains many paragraphs and sentences to
            thoroughly test the chunking behavior with longer texts.
            
            """
            + "This is sentence number {}. " * 200
            + """
            
            The document continues with more content to ensure we have a substantial
            amount of text that will definitely be categorized as long content,
            triggering the 600-token chunks with 150-token overlap.
            
            Additional paragraphs are included to make this document comprehensive
            for testing purposes. We want to see how the chunker handles very
            long documents and whether it properly applies the dynamic sizing.
            """,
            metadata={"source": "long_test.txt", "type": "test"},
        ),
        # Document with unusual formatting (potential anomaly)
        Document(
            page_content="Word. " * 1000,  # Many short sentences
            metadata={"source": "repetitive_test.txt", "type": "test"},
        ),
    ]

    # Initialize the text splitter
    splitter = SpacyTextSplitter()

    print("Testing enhanced chunking logging functionality...")
    print("=" * 60)

    # Process the documents
    chunked_docs = splitter.split_documents(test_documents)

    print("\n" + "=" * 60)
    print("FINAL RESULTS:")
    print(f"Original documents: {len(test_documents)}")
    print(f"Total chunks created: {len(chunked_docs)}")

    # Get and display metrics summary
    metrics = splitter.get_metrics_summary()
    print("\nMetrics Summary:")
    print(f"- Average chunks per document: {metrics['avg_chunks_per_document']:.2f}")
    print(f"- Edge cases detected: {metrics['edge_cases_count']}")
    print(f"- Anomalies detected: {metrics['anomalies_count']}")

    print("\nWord count distribution:")
    for range_key, count in metrics["word_count_distribution"].items():
        print(f"- {range_key} words: {count} documents")

    print("\nChunk size distribution:")
    for range_key, count in metrics["chunk_size_distribution"].items():
        print(f"- {range_key} words: {count} chunks")

    if metrics["edge_cases"]:
        print("\nEdge cases:")
        for case in metrics["edge_cases"][:5]:  # Show first 5
            print(f"- {case}")

    if metrics["anomalies"]:
        print("\nAnomalies:")
        for anomaly in metrics["anomalies"][:5]:  # Show first 5
            print(f"- {anomaly}")

    print("\nTest completed! Check 'chunking_test.log' for detailed logs.")


if __name__ == "__main__":
    test_chunking_logging()
