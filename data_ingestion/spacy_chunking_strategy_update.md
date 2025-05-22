# Chunking Strategy Update - Tasks

## Overview

Based on RAG evaluation results, spaCy paragraph-based chunking (600 tokens, 20% overlap) significantly
outperforms fixed-size chunking. This to-do list tracks the implementation of this chunking strategy across
all data ingestion methods.

## Core Chunking Implementation

- [ ] Create a reusable chunking utility module with the spaCy implementation
- [ ] Add proper handling for text without paragraph breaks (fallback to sentence-based)
- [ ] Implement unit tests for the chunking utility
- [ ] Create a simple CLI for testing chunking on sample texts

## Python Implementation (Updated Plan)

- [x] Convert TypeScript ingestion code to Python
- [ ] Integrate spaCy chunking directly in Python code
- [ ] Update configuration options for chunk size and overlap percentage
- [ ] Implement robust error handling and logging
- [ ] Document the Python approach

## PDF Ingestion

- [ ] Update `db-to-pdfs.py` Python script to use the new chunking strategy
- [x] Convert `pdf_to_vector_db.ts` to Python with spaCy chunking (`pdf_to_vector_db.py`)
- [ ] Add configuration options for chunk size and overlap percentage
- [ ] Test with a variety of PDF formats and layouts

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
