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

- [x] Update `transcribe_and_ingest_media.py` to use the new chunking strategy
- [x] Test it.
- [x] Make sure punctuation is not being stripped out.

**Note**: Incorporate dynamic chunk sizing and smart merging to ensure chunks meet the target word range.

**Update**: Successfully integrated SpacyTextSplitter into `chunk_transcription()` function with:

- Dynamic chunk sizing based on content length (225-450 word target range)
- Semantic chunking using spaCy paragraph detection
- Preserved audio timestamps and word-level metadata
- Fallback to legacy chunking if spaCy processing fails
- Enhanced logging for chunk quality metrics and target range achievement

## Web Crawling ✅

- [x] Update `data_ingestion/crawler/website_crawler.py` to use the new chunking strategy
- [x] Test with various website layouts and content types
- [x] Ensure proper handling of HTML structure vs. extracted text
- [x] **NEW**: Update chunk ID generation to use central utility for standardized vector database entries

**Note**: Applied word count-based chunk sizing and enhanced overlaps for better context preservation.

**Implementation Details**:

- Updated `WebsiteCrawler` class to initialize shared `SpacyTextSplitter` instance
- Modified `create_chunks_from_page()` to accept text splitter parameter for consistency
- Added chunking metrics tracking and reporting at end of crawl sessions
- Integrated comprehensive test suite covering short, medium, and long content scenarios
- Verified document ID tracking for metrics and proper chunk quality measurement
- **UPDATED**: Replaced custom chunk ID generation with central `generate_vector_id()` utility from `pinecone_utils.py`
- **STANDARDIZED**: Chunk IDs now follow the 7-part format:
  `content_type||library||source_location||title||source_id||content_hash||chunk_index`
- **IMPROVED**: Consistent vector ID format across all ingestion methods for better database operations

## SQL Database Ingestion ✅

- [x] Update `sql_to_vector_db` scripts to use the new chunking strategy
- [x] Ensure metadata is preserved correctly with the new chunking approach

**Implementation Details**:

- Updated `ingest_db_text.py` to use `SpacyTextSplitter()` with dynamic chunk sizing
- Integrated comprehensive metrics tracking and reporting
- Applied word count-based chunk sizing (225-450 word target range)
- Preserved all metadata fields during chunking process
- Added chunking statistics summary at end of ingestion sessions
- Verified compatibility with existing checkpoint and progress tracking systems

**Note**: Successfully utilizing the refined chunking thresholds and logging metrics for optimization.

## Get back on track with original strategy

- [x] **Switch to Token-Based Splitting**: Update \_split_by_words and_split_by_sentences to accumulate token counts
      (using the pre-tokenized SpaCy doc) instead of character lengths. For example, track the number of tokens per
      chunk and split when it exceeds self.chunk_size.

- [x] **Adjust Chunk Sizes**

  : Scale back the `chunk_size` values to match the 225-450 word range—roughly 292-585 tokens. Suggested starting
  points:

  - <1000 words: chunk_size=300 tokens
  - 1000-5000 words: chunk_size=400 tokens
  - > 5000 words: chunk_size=500 tokens

- [x] **Keep Overlap Proportional**: Set chunk_overlap to 20-30% of chunk_size (e.g., 60-150 tokens) to maintain
      context.

Once these adjustments are made, the implementation should produce chunks that align with the planned strategy,
leveraging SpaCy's tokenization for precision and staying within the target word range.

## Integration and Testing

- [x] Create test suite to verify chunk quality across all ingestion methods
  - [x] Create integration tests that run actual ingestion scripts and verify chunk quality
  - [x] Test consistency verification across all ingestion methods (PDF, SQL, crawler, audio/video)
  - [x] Verify target range compliance testing (225-450 words) for all methods
  - [x] Test metadata preservation verification during chunking across all pipelines
- [ ] ~~Benchmark ingestion performance before and after changes~~ (Not needed)
- [ ] Test retrieval quality with new chunks vs old chunks
- [ ] Document any special handling required for particular content types

Test Data for integration tests spans four sites.

- Ananda (sql to vector content, audio Transcriptions, video transcriptions)
- Ananda public (Web crawl content, books PDFs)
- Crystal clarity (Books PDFs)
- Jairam (PDFs)

It should be sufficient to put together one suite of content that spans the different types listed in parentheses.

Automating it is challenging since there are 4 different scripts that operate differently based on the types. Perhaps
there is a manual step that is where the developer runs the ingestion of the different data manually to get it into a
test Pinecone database, and then integration tests can check for consistency etc.

**Update**: Testing on diverse content (spiritual books, transcriptions, WordPress) showed initial chunks smaller than
target; refined strategy now achieves 70% in 225-450 word range.

## Deployment and Documentation

- [ ] Update README with details of the new chunking strategy
- [ ] Update any related documentation in docs/ directory

**Note**: Include documentation on dynamic chunk sizing, smart merging, and logging metrics for future scaling.
