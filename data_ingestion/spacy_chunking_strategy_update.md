# Chunking Strategy Update - Tasks

## Overview

Based on RAG evaluation results, spaCy paragraph-based chunking (600 tokens, 20% overlap) significantly
outperforms fixed-size chunking. This to-do list tracks the implementation of this chunking strategy across
all data ingestion methods.

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
- [ ] Test with a variety of PDF formats and layouts

**Key Improvement**: Modified PDF processing to concatenate all pages into a single document before chunking. This:

- Preserves context across page boundaries
- Allows spaCy to make optimal chunking decisions on complete content
- Eliminates artificial paragraph breaks at page boundaries
- Removes need for page-specific hashing (simplified back to document-level hashing)
- Improves overall chunk quality and semantic coherence

## Audio/Video Transcript Ingestion

- [ ] Update `transcribe_and_ingest_media.py` to use the new chunking strategy
- [ ] Test with both AssemblyAI and other transcription sources
- [ ] Handle speaker diarization properly with the new chunking approach

## Web Crawling

- [ ] Update `data_ingestion/crawler/website_crawler.py` to use the new chunking strategy
- [ ] Test with various website layouts and content types
- [ ] Ensure proper handling of HTML structure vs. extracted text
- [ ] Update crawler configuration to include chunking parameters

## SQL Database Ingestion

- [ ] Update `sql_to_vector_db` scripts to use the new chunking strategy
- [ ] Test with different column types and content formats
- [ ] Ensure metadata is preserved correctly with the new chunking approach

## Encoding strategy question

- [x] Decide whether hash in pine cone ID is helpful or if there's a better strategy. It seems like we would
      want a hash that joined together all the chunks.

**RESOLVED**: Implemented document-level hashing using a centralized utility (`data_ingestion/utils/document_hash.py`).
All chunks from the same document now share the same hash, enabling easy bulk operations:

- **Before**: `text||Crystal Clarity||Art_Science_of_Raja_Yoga||9353b288||chunk1` (unique per chunk)
- **After**: `text||Crystal Clarity||Art_Science_of_Raja_Yoga||345345345||chunk1` (same hash for all chunks)

Hash is generated from document metadata (source + title + author + library) rather than chunk content.
Updated all ingestion scripts: PDF, audio/video, SQL, and web crawler.

text||Crystal Clarity||Art**_Science_of_Raja_Yoga||9353b288||chunk1
text||Crystal Clarity||Art_**Science*of_Raja_Yoga||26198964||chunk2
text||Crystal Clarity||Art\*\*\_Science_of_Raja_Yoga||7ed8c82b||chunk3
text||Crystal Clarity||Art*\*\*Science_of_Raja_Yoga||168b146a||chunk4

## Integration and Testing

- [ ] Create test suite to verify chunk quality across all ingestion methods
- [ ] Benchmark ingestion performance before and after changes
- [ ] Test retrieval quality with new chunks vs old chunks
- [ ] Document any special handling required for particular content types

## Deployment and Documentation

- [ ] Update README with details of the new chunking strategy
- [ ] Document how to configure chunking parameters for each ingestion method
- [ ] Create examples of good configuration for different content types
- [ ] Update any related documentation in docs/ directory
