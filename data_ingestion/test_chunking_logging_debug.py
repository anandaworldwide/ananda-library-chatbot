#!/usr/bin/env python3
"""
Debug test script to verify enhanced chunking logging functionality.
This script tests the SpacyTextSplitter with debug output to see metrics accumulation.
"""

import logging

from utils.text_splitter_utils import Document, SpacyTextSplitter

# Configure logging to see all the detailed output
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


def test_chunking_logging_debug():
    """Test the enhanced logging functionality with debug output."""

    # Create simple test documents
    test_documents = [
        Document(
            page_content="This is a very short document with only a few words.",
            metadata={"source": "short_test.txt", "type": "test"},
        ),
        Document(
            page_content="This is a medium document. " * 50,  # About 250 words
            metadata={"source": "medium_test.txt", "type": "test"},
        ),
    ]

    # Initialize the text splitter
    splitter = SpacyTextSplitter()

    print("Testing enhanced chunking logging functionality...")
    print("=" * 60)

    # Process documents one by one to see metrics accumulation
    for i, doc in enumerate(test_documents):
        print(f"\nProcessing document {i + 1}: {doc.metadata['source']}")
        print(
            f"Before processing - Total docs: {splitter.metrics.total_documents}, Total chunks: {splitter.metrics.total_chunks}"
        )

        # Process single document
        chunks = splitter.split_text(
            doc.page_content, document_id=doc.metadata["source"]
        )

        print(
            f"After processing - Total docs: {splitter.metrics.total_documents}, Total chunks: {splitter.metrics.total_chunks}"
        )
        print(f"Chunks created for this document: {len(chunks)}")

    print("\n" + "=" * 60)
    print("FINAL METRICS:")
    splitter.metrics.log_summary(splitter.logger)

    # Get and display metrics summary
    metrics = splitter.get_metrics_summary()
    print("\nFinal Summary:")
    print(f"- Total documents: {metrics['total_documents']}")
    print(f"- Total chunks: {metrics['total_chunks']}")
    print(f"- Average chunks per document: {metrics['avg_chunks_per_document']:.2f}")


if __name__ == "__main__":
    test_chunking_logging_debug()
