# Data Ingestion TODO: Revert to Historical Chunk Sizes

## Summary

Based on RAG evaluation results from `bin/evaluate_rag_system.py`, we need to revert all ingestion methods to their
historical chunk sizes while maintaining the superior **spaCy sentence-based chunking** approach.

### Background

**Evaluation Results (29 queries, K=5):**

- Current System with spaCy sentence-based chunking: **78.6% precision** (best performance)
- Current System with optimized fixed-size chunking: 75.2% precision
- Current System with current fixed-size chunking: 75.2% precision

**Key Finding:** spaCy sentence-based chunking provides **3.4% better precision** than fixed-size approaches, so we must
keep the spaCy approach but revert to historical chunk sizes that were working well before the performance collapse.

### Historical Chunk Size Analysis

From commit `6be6e15b430454fc38a5db72e160b18aae31752d` (before performance issues):

| Method              | Historical Size          | Historical Overlap          | Current Size | Current Overlap  |
| ------------------- | ------------------------ | --------------------------- | ------------ | ---------------- |
| Audio transcription | 150 words (~190 tokens)  | 75 words (~95 tokens, 50%)  | 600 tokens   | 120 tokens (20%) |
| Website crawler     | 1000 chars (~250 tokens) | 200 chars (~50 tokens, 20%) | 600 tokens   | 120 tokens (20%) |
| PDF processing      | 1000 chars (~250 tokens) | 200 chars (~50 tokens, 20%) | 600 tokens   | 120 tokens (20%) |
| SQL to vector       | 1000 chars (~250 tokens) | 200 chars (~50 tokens, 20%) | 600 tokens   | 120 tokens (20%) |

## TODO Tasks

### ✅ High Priority - Core Ingestion Methods

#### ✅ 1. Audio/Video Transcription (`data_ingestion/audio_video/transcription_utils.py`) - COMPLETED

- **File:** `data_ingestion/audio_video/transcription_utils.py`
- **Function:** `chunk_transcription()`
- **Change:** ✅ Updated `SpacyTextSplitter()` parameters:
  - `chunk_size=190` (down from 600)
  - `chunk_overlap=95` (down from 120, maintain 50% overlap)
- **Reasoning:** Audio had smallest historical chunks and highest overlap (50% vs 20%)
- **Implementation:** Updated function parameters, docstring, and logging target ranges (71-142 words)

#### ✅ 2. Website Crawler (`data_ingestion/crawler/website_crawler.py`) - COMPLETED

- **File:** `data_ingestion/crawler/website_crawler.py`
- **Function:** ✅ Updated `SpacyTextSplitter` usage in 2 locations
- **Change:** ✅ Explicitly set historical parameters:
  - `chunk_size=250` (down from 600, matches historical 1000 chars)
  - `chunk_overlap=50` (down from 120, maintains 20% overlap)
- **Note:** ✅ Default parameters in `text_splitter_utils.py` now match historical values

#### ✅ 3. PDF Processing (`data_ingestion/pdf_to_vector_db.py`) - COMPLETED

- **File:** `data_ingestion/pdf_to_vector_db.py`
- **Function:** ✅ Updated `_initialize_processing_components()` function
- **Change:** ✅ Updated `SpacyTextSplitter()` parameters:
  - `chunk_size=250` (down from 600, matches historical 1000 chars)
  - `chunk_overlap=50` (down from 120, maintains 20% overlap)
- **Implementation:** ✅ Added explicit parameters with historical context comment
- **Test:** ✅ All 5 PDF processing tests pass

#### ✅ 4. SQL to Vector DB (`data_ingestion/sql_to_vector_db/ingest_db_text.py`) - COMPLETED

- **File:** `data_ingestion/sql_to_vector_db/ingest_db_text.py`
- **Function:** ✅ Updated `SpacyTextSplitter` usage on line 1164
- **Change:** ✅ Updated parameters to historical values:
  - `chunk_size=250` (down from 600, matches historical 1000 chars)
  - `chunk_overlap=50` (down from 120, maintains 20% overlap)
- **Implementation:** ✅ Added explicit parameters with historical context comment
- **Test:** ✅ All 29 SQL ingestion tests pass
- **Verification:** ✅ Script loads successfully and shows help

### 🔧 Implementation Tasks

#### ✅ 5. Update Shared Text Splitter Utils - COMPLETED

- **File:** `data_ingestion/utils/text_splitter_utils.py`
- **Action:** ✅ Updated default parameters to historical values (250 tokens/50 overlap)
- **Implementation:** ✅ Fixed token/word count inconsistencies, updated chunk merging logic to use token counts
- **Result:** ✅ All 27 text splitter tests pass, audio transcription uses method-specific 190/95 parameters

#### ✅ 6. Update Tests - COMPLETED

- **Files:** ✅ Updated `data_ingestion/tests/test_text_splitter_utils.py`
- **Action:** ✅ Updated test expectations for new chunk sizes (250 tokens/50 overlap)
- **Result:** ✅ All 27 text splitter tests pass, all 9 transcription tests pass

#### ✅ 7. Update Documentation - COMPLETED

- **File:** `docs/data-ingestion.md`
- **Action:** ✅ Updated chunking strategy documentation with historical parameters
- **Include:** ✅ Added rationale for different chunk sizes per method type
- **Implementation:** ✅ Updated both `data-ingestion.md` and `chunking-strategy.md` with:
  - Content-specific historical parameters (190 tokens for audio, 250 tokens for text)
  - Rationale for different chunk sizes based on content characteristics
  - Historical context explaining performance-driven reversion
  - Updated target ranges and quality metrics

### 📊 Validation Tasks

#### 🥚 8. Run Ingestion Scripts with Historical Parameters

- **Action:** Run ingestion scripts with historical parameters to regenerate vector database
- **Priority:** Must be completed before RAG evaluation
- **Important Note:** Root causes of performance degradation unknown - taking empirical approach to restore proven
  performance
- **Database Strategy:** Create new Pinecone index with historical chunk parameters
- **Scripts to run:**
  - `data_ingestion/audio_video/transcribe_and_ingest_media.py` (with 190 tokens, 95 overlap)
  - `data_ingestion/crawler/website_crawler.py` (with 250 tokens, 50 overlap)
  - `data_ingestion/pdf_to_vector_db.py` (with 250 tokens, 50 overlap)
  - `data_ingestion/sql_to_vector_db/ingest_db_text.py` (with 250 tokens, 50 overlap)
- **Goal:** Generate new vector database content using historically proven chunk sizes

#### 🥚 9. Re-run RAG Evaluation

- **Script:** `bin/evaluate_rag_system.py`
- **Goal:** Validate that new Pinecone index with historical parameters performs same or better than current production
- **Success Criteria:** Performance equal to or better than current production system
- **Baseline:** Current best recorded performance is 78.6% precision with spaCy sentence-based chunking
- **Unknown Factors:** Exact reasons for performance degradation unclear - focusing on empirical validation

#### 🥚 10. Chunk Quality Analysis

- **Action:** Analyze chunk size distributions from the new ingestion runs
- **Monitor:** Chunk size distributions and target range compliance
- **Files:** Check chunk statistics output from each ingestion method

#### 🥚 11. Integration Testing

- **Action:** Test each ingestion method with new parameters
- **Verify:**
  - No errors during processing
  - Chunks are within expected size ranges
  - Vector storage works correctly
  - End-to-end search functionality

### 🎯 Success Criteria

- 🥚 All 4 ingestion methods use spaCy sentence-based chunking with historical chunk sizes
- 🥚 New Pinecone index with historical parameters performs same or better than current production
- 🥚 All existing tests pass with updated expectations
- 🥚 Chunk size distributions match historical patterns
- 🥚 Empirical validation confirms performance recovery without requiring root cause investigation

### 📝 Notes

**Why These Specific Sizes:**

- **Audio (190 tokens):** Historically had smallest chunks due to speech patterns and timestamp alignment needs
- **Text sources (250 tokens):** Used consistent 1000-character chunks across web, PDF, and database sources
- **Overlap patterns:** Audio used 50% overlap for better context, others used 20%

**Token Conversion:** Based on ~4 characters per token average for English text.

**Next Steps After Completion:**

1. Deploy new Pinecone index to production environment
2. Monitor system performance with historical parameters
3. Run comprehensive RAG evaluation on larger query set
4. Compare performance metrics against current production baseline
5. Document empirical results and lessons learned
6. Consider future investigation of root causes if performance issues recur
