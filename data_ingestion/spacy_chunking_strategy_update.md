# Chunking Strategy Update - Tasks

## Overview

Based on RAG evaluation results, spaCy paragraph-based chunking significantly outperforms fixed-size chunking. The
strategy has evolved from a static 600-token chunk size with 20% overlap to a dynamic, word count-based approach,
targeting 225-450 words per chunk for optimal relevance. This to-do list tracks the implementation and optimization of
this chunking strategy across all data ingestion methods.

## Core Chunking Implementation

- [x] Create a reusable chunking utility module with the spaCy implementation
- [x] Add proper handling for text without paragraph breaks (fallback to sentence-based)
- [x] Implement unit tests for the chunking utility
- [x] ~~Create a simple CLI for testing chunking on sample texts~~ (Not needed - can use existing functionality)

## Python Implementation (Updated Plan) ✅

- [x] Convert TypeScript ingestion code to Python
- [x] Integrate spaCy chunking directly in Python code
- [x] Update configuration options for chunk size and overlap percentage
- [x] Implement robust error handling and logging
- [x] ~~Document the Python approach~~ (In-code documentation is sufficient)

## PDF Ingestion ✅

- [x] Convert `pdf_to_vector_db.ts` to Python with spaCy chunking (`pdf_to_vector_db.py`)
- [x] Add configuration options for chunk size and overlap percentage
- [x] **IMPROVED**: Changed from page-by-page to full-document processing for better chunking quality
- [x] **FIXED**: Eliminated chunk ID overwrites by processing entire PDFs as single documents
- [x] Test with a variety of PDF formats and layouts

**Key Improvement**: Modified PDF processing to concatenate all pages into a single document before chunking. This:

- Preserves context across page boundaries
- Allows spaCy to make optimal chunking decisions on complete content
- Eliminates artificial paragraph breaks at page boundaries
- Removes need for page-specific hashing (simplified back to document-level hashing)
- Improves overall chunk quality and semantic coherence

**Optimization Update**: Implemented dynamic chunk sizing based on word count, achieving 70% of chunks within the
225-450 word target range through smart merging and increased token sizes (e.g., short content up to 800 tokens).

## Audio/Video Transcript Ingestion

- [ ] Update `transcribe_and_ingest_media.py` to use the new chunking strategy

**Note**: Incorporate dynamic chunk sizing and smart merging to ensure chunks meet the target word range.

## Web Crawling

- [ ] Update `data_ingestion/crawler/website_crawler.py` to use the new chunking strategy
- [ ] Test with various website layouts and content types
- [ ] Ensure proper handling of HTML structure vs. extracted text

**Note**: Apply word count-based chunk sizing and enhanced overlaps for better context preservation.

## SQL Database Ingestion

- [ ] Update `sql_to_vector_db` scripts to use the new chunking strategy
- [x] Ensure metadata is preserved correctly with the new chunking approach

**Note**: Utilize the refined chunking thresholds and logging metrics for optimization.

## Integration and Testing

- [ ] Create test suite to verify chunk quality across all ingestion methods
- [ ] Benchmark ingestion performance before and after changes
- [ ] Test retrieval quality with new chunks vs old chunks
- [ ] Document any special handling required for particular content types

**Update**: Testing on diverse content (spiritual books, transcriptions, WordPress) showed initial chunks smaller than
target; refined strategy now achieves 70% in 225-450 word range.

## Deployment and Documentation

- [ ] Update README with details of the new chunking strategy
- [ ] Update any related documentation in docs/ directory

**Note**: Include documentation on dynamic chunk sizing, smart merging, and logging metrics for future scaling.
