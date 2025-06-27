# Chunking Strategy Implementation

## Overview

The Ananda Library Chatbot uses a sophisticated semantic chunking strategy based on spaCy sentence detection with
historical chunk parameters optimized for retrieval quality in the RAG (Retrieval-Augmented Generation) pipeline. The
system has reverted to proven historical chunk sizes that delivered optimal performance before system changes caused
degradation.

## Historical Parameter Reversion (2025)

**Background**: Initial RAG evaluation using textual similarity matching suggested a significant performance drop,
prompting investigation of chunking parameters and evaluation methodology.

**Key Investigation Findings**:

- **Original Problem**: Evaluation using textual similarity (difflib.SequenceMatcher) suggested ~70% performance drop
- **Actual Reality**: Embedding-based semantic similarity evaluation revealed only ~4% performance difference (96% vs
  100% strict precision)
- **Root Cause**: Evaluation methodology was flawed - textual matching cannot capture semantic relevance accurately
- **Scope**: Performance differences are query-specific (affecting 1 out of 5 test queries) rather than systemic

**Resolution**: The investigation concluded that both chunking systems perform nearly equivalently:

- **Current System**: 100% strict precision (0.956 average semantic similarity)
- **New System**: 96% strict precision (0.933 average semantic similarity)

**Current Strategy**:

1. **Maintain Historical Parameters**: Continue using proven historical parameters as they provide reliable performance
2. **Updated Evaluation Methods**: All RAG evaluation now uses embedding-based semantic similarity for accuracy
3. **Performance Monitoring**: Established reliable evaluation infrastructure using proper semantic similarity metrics
4. **Preserve spaCy Advantages**: Maintain superior spaCy sentence-based chunking approach while using historical chunk
   sizes

**Historical Chunk Parameters (Empirically Validated)**:

- **Audio transcription**: 190 tokens (~95 words) with 95 token overlap (50%)
- **Text sources**: 250 tokens (~125 words) with 50 token overlap (20%)

**Key Learning**: Always use embedding-based semantic similarity for RAG evaluation. Textual matching leads to false
performance alarms and can misdirect optimization efforts.

## Current Implementation: spaCy Word-Based Token Chunking

### Strategic Decision: Word-Based Tokens Over Paragraph Boundaries

**Final Decision (May 2025)**: After comprehensive evaluation of spaCy chunking strategies, the system uses
**spaCy-based, word-based token chunking** for the following reasons:

- **Paragraph Boundary Challenge**: Finding true paragraph boundaries in diverse content types (PDFs, transcripts, web
  content) proved consistently difficult
- **Equivalent Performance**: Evaluation results show identical quality metrics (Precision@5: 72.63%, NDCG@5: 86.74%)
  across sentence-based and paragraph-based approaches
- **Processing Efficiency**: Word-based token counting provides consistent, predictable chunk sizes without the
  complexity of paragraph detection
- **Content Agnostic**: Works reliably across all content types without fallback strategi

### Key Features

- **spaCy Integration**: Uses spaCy's natural language processing for sentence detection and token counting
- **Historical Target Sizing**: Content-specific chunk sizes based on historical performance analysis
  - **Audio/Video**: 190 tokens (~95 words) with 95 token overlap (50%)
  - **Text Sources**: 250 tokens (~125 words) with 50 token overlap (20%)
- **Sentence-Based Boundaries**: Respects sentence boundaries within token limits using spaCy sentence detection
- **Smart Merging**: Post-processing to merge small chunks while maintaining content coherence
- **Comprehensive Metrics**: Detailed logging and analytics for chunk quality assessment
- **Performance-Driven**: Chunk sizes optimized based on RAG evaluation results and content type characteristics

### Technical Implementation

The chunking logic is implemented in `data_ingestion/utils/spacy_text_splitter.py`:

- **SpacyTextSplitter Class**: Core chunking utility that can be used across all data ingestion scripts
- **Language Model**: Uses spaCy's English language model for text processing
- **Chunk Overlap**: Implements 20% overlap to preserve context across chunk boundaries
- **Text Cleaning**: Includes robust text preprocessing to handle various input formats

#### Audio/Video Timestamp Preservation

Audio/video content uses the same paragraph-based chunking strategy with additional timestamp mapping:

- **Timestamp Preservation**: Maps spaCy text chunks back to original timestamped words for playback synchronization
- **Word-Level Metadata**: Preserves timing data during chunking process

### Integration Across Data Sources

The spaCy paragraph-based chunking strategy has been integrated into all major data ingestion methods:

#### PDF Ingestion (`pdf_to_vector_db.py`)

- **Full Document Processing**: Changed from page-by-page to complete document processing
- **Context Preservation**: Eliminates artificial paragraph breaks at page boundaries
- **Improved Quality**: Better semantic coherence across the entire document

#### Audio/Video Transcription (`transcribe_and_ingest_media.py`)

- **Unified Chunking Strategy**: Uses standard paragraph-based chunking with timestamp mapping
- **Metadata Preservation**: Maintains audio timestamps and word-level metadata

#### Web Crawling (`website_crawler.py`)

- Processes extracted HTML text content
- Handles various website layouts and content structures
- Maintains article structure and readability

#### SQL Database Content

- Applied to text content from database fields
- Preserves document structure from CMS content
- Handles mixed content types appropriately

## Document-Level Hashing Strategy

### Problem Solved

Previously, each chunk had a unique hash in its Pinecone ID, making bulk operations (like updating or deleting all
chunks from a document) difficult and inefficient.

### Solution: Centralized Document Hashing

- **Utility Module**: `data_ingestion/utils/document_hash.py` provides centralized hash generation
- **Document-Level IDs**: All chunks from the same document share the same hash
- **Bulk Operations**: Enables efficient document-level updates and deletions
- **Metadata-Based**: Hash generated from document metadata (source, title, author, library) rather than content

### ID Format

**Before**: `text||Crystal Clarity||Art_Science_of_Raja_Yoga||9353b288||chunk1` (unique per chunk) **After**:
`text||Crystal Clarity||Art_Science_of_Raja_Yoga||345345345||chunk1` (same hash for all chunks)

## Configuration Options

### Word-Based Token Chunking Strategy

All ingestion scripts now use consistent word-based token chunking parameters:

#### Historical Target Sizes (Reverted for Optimal Performance)

**Content-Specific Parameters**:

- **Audio/Video Transcription**: 190 tokens with 50% overlap (95 tokens)
  - Rationale: Speech patterns require smaller, overlapping chunks for timestamp alignment
  - Historical evidence: Best performance with ~150 words in original system
- **Text Sources (PDF, Web, SQL)**: 250 tokens with 20% overlap (50 tokens)
  - Rationale: Written content benefits from larger chunks preserving complete thoughts
  - Historical evidence: Consistent 1000-character chunks (~250 tokens) in original system

**Implementation Notes**:

- **Very short texts** (<100 tokens): Single chunk, no splitting
- **Base chunk size**: Uses 75% of target (188 tokens) to provide buffer for sentence boundaries

#### Target Token Range Achievement

**Historical Performance Targets**:

- **Audio/Video**: 95-285 tokens (50%-150% of 190 target)
- **Text Sources**: 188-313 tokens (75%-125% of 250 target)
- **Quality Metrics**: Token-based distributions aligned with content-specific targets
- **Smart Merging**: Post-processing combines small chunks to reach optimal ranges

### Environment-Specific Settings

Scripts can be configured per site/environment using the `--site` argument to load appropriate environment variables.

## Performance Benefits

### RAG Evaluation Results

Based on comprehensive evaluation testing with 19 queries, the spaCy word-based token chunking strategy provides:

#### Performance Comparison (Current System, ada-002 with 1536 dimension)

**Focused spaCy Strategy Evaluation Results (May 2025)**:

- **All spaCy strategies (sentence/paragraph, 300/600 tokens)**: Precision@5: 72.63%, NDCG@5: 86.74%
- **Speed differences only**: Paragraph-based (0.29s) vs sentence-based (0.47s)
- **Identical quality metrics**: All approaches perform equally well for retrieval

**Key Finding**: Since paragraph boundary detection is challenging and all spaCy approaches yield identical quality, the
system uses **word-based token counting** for simplicity and reliability.

#### Key Benefits

- **Consistent performance** across all content types
- **Optimal retrieval quality** with fixed target sizes
- **Reliable processing** without complex boundary detection
- **Content agnostic** approach works with diverse data sources

### Architectural Benefits

- **Better Context Retrieval**: More semantically coherent chunks improve relevance
- **Reduced Information Loss**: Paragraph boundaries preserve complete thoughts
- **Improved Answer Quality**: Better context leads to more accurate and complete responses
- **Faster Processing**: Fixed-size approach reduces computational overhead

### Fallback Robustness

The implementation includes robust fallback mechanisms:

- **No Paragraphs**: Falls back to sentence-based chunking
- **Very Long Sentences**: Implements safe splitting for edge cases
- **Empty Content**: Graceful handling of edge cases

## Migration Status

### Completed ✅

- Core chunking utility implementation
- PDF ingestion conversion to Python with spaCy chunking
- Document-level hashing implementation
- Full document processing for PDFs
- Audio/video transcript ingestion with paragraph-based chunking
- RAG evaluation framework and performance testing
- Testing infrastructure for chunking validation

### In Progress 🚧

- Web crawling integration optimization
- SQL database ingestion final updates

### Recently Completed ✅

- **Fixed Word-Based Token Chunking Implementation**: Standardized all content types to use consistent 600-token targets
- **Audio/Video Transcription Updates**: Implemented fixed word-based chunking with NLTK overlap detection
- **Audio Transcription Chunking Fix**: Resolved timeout issues by implementing actual spaCy text processing
- **Improved Word Mapping**: Fixed "No words found for chunk" warnings with proportional word allocation strategy
- **Comprehensive logging and metrics tracking system**
- **Refined chunking thresholds achieving 70%+ target range compliance**
- **spaCy Strategy Evaluation**: Comprehensive comparison confirming equivalent performance across approaches

### Strategic Decisions ✅

- **Standardized on spaCy Word-Based Token Chunking**: Consistent approach across all content types prioritizing
  simplicity over complex boundary detection
- **NLTK Integration**: Added NLTK dependency for robust overlap detection and word boundary handling
- **Data-Driven Architecture**: All chunking decisions based on RAG evaluation results
- **Pragmatic Approach**: Chose reliable word-counting over challenging paragraph boundary detection

### Future Enhancements 🔮

- Content-type specific fine-tuning within paragraph-based framework
- Multi-language support for non-English content
- Advanced semantic boundary detection improvements

## Testing and Validation

### Unit Tests

Comprehensive test suite in `data_ingestion/tests/` covers:

- Text splitting with various content types
- Chunk overlap validation
- Metadata preservation
- Edge case handling
- Paragraph-based chunking validation

### Content Diversity Testing

Specialized test suite (`test_diverse_content_chunker.py`) validates chunking across:

- **Spiritual books**: PDF content from Crystal Clarity library
- **Transcriptions**: Audio/video transcript files (JSON.gz format)
- **WordPress content**: CMS-generated PDF documents
- **Performance metrics**: Word count distributions and target range achievement

### Integration Testing

- End-to-end ingestion pipeline testing
- RAG evaluation with different chunking strategies
- Performance benchmarking with real content samples
- Quality metrics comparison and threshold optimization

### RAG Evaluation Framework

Comprehensive evaluation system (`evaluation/evaluate_rag_system.py`) provides:

- **Multi-strategy comparison**: Tests paragraph-based, sentence-based, dynamic, and fixed-size chunking
- **Performance metrics**: Precision@K, NDCG@K, and retrieval time measurements
- **Cross-system testing**: Evaluation across different Pinecone indexes and embedding models
- **Data-driven decisions**: Empirical basis for architectural choices

## Best Practices

### Content-Specific Considerations

- **Academic Papers**: Word-based token chunking with sentence preservation maintains readability
- **Conversational Content**: Maintains natural dialogue flow through sentence-aware boundaries
- **Technical Documentation**: Preserves procedural steps within consistent word count targets
- **Creative Content**: Maintains narrative coherence through sentence-based splitting
- **Audio/Video Transcriptions**: Preserves spoken language patterns with timestamp mapping for playback synchronization

### Configuration Guidelines

- **All Content Types**: Use standard 600-token target with 20% overlap
- **Short Form Content**: Single chunk for content <200 words
- **Mixed Content**: Paragraph-based approach handles most content types optimally
- **Performance Priority**: Fixed-size approach ensures consistent retrieval speeds

## Docling Investigation - Concluded

### Investigation Overview

An investigation was conducted to evaluate Docling (sophisticated document conversion library) as a potential
replacement or enhancement to the current PDF ingestion pipeline. The goal was to determine if Docling could capture
additional content that the current production method (pdfplumber + text_processing) might miss.

### Testing Methodology

- **Comparison Script**: `data_ingestion/docling_content_comparison.py`
- **Test Scope**: First 20 pages of PDFs for fair comparison
- **Content Analysis**: Focus on unique content blocks, word counts, and missing content detection
- **PDF Samples**: Tested on Crystal Clarity collection PDFs

### Key Findings

#### Content Quality Comparison

**Test 1 - "Fight for Religious Freedom":**

- **Docling**: 221 words, 34 paragraphs, 5 unique content blocks
- **Production**: 190 words, 4 paragraphs, 1 unique content block
- **Docling captured more structured content** (headers, subtitles, formatted text)
- **Production captured table of contents structure** better

**Test 2 - "Autobiography of a Yogi":**

- **Docling**: 1,041 words, 37 paragraphs
- **Production**: 1,057 words, 6 paragraphs
- **98.4% content overlap** - nearly identical content extraction
- **No significant missing content blocks** in either method

#### Performance Comparison

- **Docling Processing**: 15-22 seconds per 10 pages
- **Production Processing**: 0.19-0.78 seconds per 10 pages
- **Performance Gap**: Docling is **20-114x slower** than current production method

### Decision: Continue with Current Production Method

Based on the investigation findings, the decision was made to **not pursue Docling integration** for the following
reasons:

#### Primary Concerns

1. **Performance Impact**: 20-114x slower processing time is unacceptable for production workloads
2. **Minimal Content Gain**: Content improvements are inconsistent and document-dependent
3. **Engineering Priority**: Paragraph detection optimization is not critical for current system performance
4. **Complexity vs Benefit**: Added complexity doesn't justify the marginal content improvements
5. **Technical Complexity**: Finding paragraph boundaries in PDF books is an inherently difficult problem that should
   not be built manually from scratch

#### Current System Strengths

- **Proven Performance**: Production method delivers consistent, fast results
- **Adequate Content Extraction**: Captures the essential content needed for RAG pipeline
- **Reliability**: Well-tested and stable in production environment
- **Resource Efficiency**: Minimal computational overhead

### Alternative Approach

Instead of pursuing advanced PDF extraction methods, focus remains on:

- **spaCy paragraph-based chunking optimization**: Continue improving semantic boundary detection
- **Content preprocessing**: Enhance text cleaning and normalization
- **RAG evaluation**: Data-driven improvements to retrieval quality
- **Performance optimization**: Maintain fast processing speeds for production workloads

**Note on PDF Paragraph Detection**: Paragraph boundary detection in PDF books is a complex computer science problem
involving layout analysis, font detection, spacing heuristics, and document structure understanding. Rather than
attempting to build custom solutions from scratch, the current approach leverages proven libraries (pdfplumber + spaCy)
that provide adequate results for the RAG pipeline requirements.

### Investigation Artifacts

- **Comparison Script**: `data_ingestion/docling_content_comparison.py` - Available for future reference
- **Test Results**: Documented content and performance comparisons
- **Decision Rationale**: Performance vs benefit analysis completed

**Status**: ✅ **CONCLUDED** - Docling investigation completed with decision to maintain current production method.
