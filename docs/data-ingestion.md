# Data Ingestion Architecture

## Philosophy

The Ananda Library Chatbot employs a sophisticated semantic chunking strategy designed to optimize retrieval-augmented
generation (RAG) quality while preserving document context and meaning. Our approach prioritizes semantic coherence over
arbitrary size limits, leveraging natural language processing to create meaningful text segments that enhance search
relevance and answer quality.

## Core Principles

### 1. Semantic Chunking Over Fixed-Size Splitting

Traditional fixed-size chunking often splits text at arbitrary boundaries, breaking sentences and paragraphs
mid-thought. Our spaCy-based approach respects natural language boundaries:

- **Paragraph-first**: Preserve complete paragraphs when possible
- **Sentence-aware**: Split at sentence boundaries when paragraphs exceed limits
- **Token-precise**: Use spaCy tokenization for accurate text measurement
- **Context-preserving**: Maintain semantic relationships within chunks

### 2. Dynamic Sizing Based on Document Characteristics

Rather than using one-size-fits-all chunking, we adapt chunk sizes based on document length and content type:

- **Short documents** (<1000 words): 300 tokens per chunk
- **Medium documents** (1000-5000 words): 400 tokens per chunk
- **Long documents** (>5000 words): 500 tokens per chunk

This ensures optimal granularity for different content types while maintaining searchable units.

### 3. Target Token Range Optimization

All chunks aim for the **292-585 token range** (approximately 225-450 words), which provides:

- Sufficient context for meaningful search results
- Optimal input size for embedding models
- Balanced granularity for precise retrieval
- Enhanced RAG performance through focused content segments

### 4. Intelligent Overlap for Context Preservation

**20% token-based overlap** between consecutive chunks ensures:

- Seamless context flow across chunk boundaries
- Improved retrieval of concepts spanning multiple chunks
- Enhanced answer coherence by preserving narrative continuity
- Robust search coverage for queries matching transition areas

## Technical Implementation

### Core Components

#### SpacyTextSplitter

The heart of our chunking system, implementing:

```python
# Dynamic chunk sizing based on document length
def _set_dynamic_chunk_size(self, word_count: int):
    if word_count < 1000:
        self.chunk_size = 300    # tokens
        self.chunk_overlap = 60  # 20% overlap
    elif word_count < 5000:
        self.chunk_size = 400
        self.chunk_overlap = 80
    else:
        self.chunk_size = 500
        self.chunk_overlap = 100
```

#### Smart Chunk Merging

Post-processing step that combines small chunks to reach target word counts:

- Merges chunks under 150 words with adjacent chunks
- Maintains paragraph boundaries where possible
- Achieves 70% compliance with 225-450 word target range
- Preserves semantic coherence during merging

#### Comprehensive Metrics Tracking

Real-time quality monitoring with:

- Per-document word count and chunk statistics
- Target range compliance percentages
- Edge case detection (very short/long documents)
- Anomaly identification (unusually small/large chunks)
- Distribution analysis across word count ranges

### Integration Across Data Sources

#### PDF Documents (`pdf_to_vector_db.py`)

- Full-document processing to preserve context
- Table of contents artifact removal
- Punctuation preservation
- Document-level hashing for consistent chunk grouping

#### Database Text (`ingest_db_text.py`)

- HTML tag cleaning and text normalization
- Author and source metadata preservation
- Batch processing with progress tracking
- Consistent vector ID generation

#### Web Crawling (`website_crawler.py`)

- Semantic content extraction with readability fallbacks
- Menu and navigation content filtering
- Dynamic browser management for large-scale crawling
- Robust error handling and retry logic

#### Audio/Video Transcriptions (`transcription_utils.py`)

- Timestamp-aware chunking for playback synchronization
- Speaker diarization preservation
- Punctuation retention from original transcripts
- Fuzzy matching for text-to-timestamp alignment

## Quality Assurance

### Chunk Quality Metrics

Our system tracks comprehensive quality indicators:

- **Target Range Achievement**: 70% of chunks fall within 292-585 token range (225-450 words)
- **Average Chunk Size**: 240-333 words across different content types
- **Overlap Accuracy**: Consistent 20% token-based overlap
- **Semantic Coherence**: Paragraph and sentence boundary preservation

### Validation Testing

Comprehensive test suite ensures:

- **Integration Tests**: Verify chunk quality across all ingestion methods
- **Punctuation Preservation**: Ensure formatting integrity
- **Metadata Consistency**: Validate standardized metadata fields
- **Edge Case Handling**: Test with diverse content types and sizes
- **Performance Monitoring**: Track processing speed and memory usage

### Error Handling and Fallbacks

Robust fallback mechanisms provide reliability:

- **spaCy Processing Failures**: Automatic fallback to sentence-based splitting
- **Network Issues**: Retry logic with exponential backoff
- **Memory Constraints**: Streaming processing for large documents
- **Content Type Variations**: Adaptive handling for different media types

## Benefits and Impact

### RAG Performance Improvements

The semantic chunking strategy delivers measurable improvements:

- **Enhanced Search Relevance**: Natural language boundaries improve query matching
- **Better Context Preservation**: Overlap ensures continuity across related concepts
- **Improved Answer Quality**: Coherent chunks provide better foundation for responses
- **Reduced Hallucination**: Precise chunk boundaries minimize context confusion

### Scalability and Maintainability

Our architecture supports growing content needs:

- **Consistent Processing**: Unified chunking across all content types
- **Efficient Storage**: Document-level hashing enables bulk operations
- **Monitoring Integration**: Real-time metrics for quality assurance
- **Modular Design**: Shared utilities reduce code duplication

### Content Quality Standards

Rigorous standards ensure high-quality knowledge base:

- **Semantic Integrity**: Respect for natural language structure
- **Metadata Completeness**: Consistent field naming and population
- **Version Control**: Document-level hashing for change detection
- **Quality Metrics**: Continuous monitoring and improvement

## Configuration and Usage

### Environment Setup

Each site requires configuration in `crawler_config/{site}-config.json`:

```json
{
  "domain": "example.org",
  "skip_patterns": ["pattern1", "pattern2"],
  "crawl_frequency_days": 14
}
```

### Command Line Usage

```bash
# PDF ingestion with force refresh
python pdf_to_vector_db.py --site ananda --force

# Web crawling with debug output
python website_crawler.py --site ananda-public --debug

# Audio processing with dry run
python process_media_files.py --site ananda --dryrun
```

### Quality Monitoring

Regular quality assessments using:

```bash
# Analyze chunk word count distribution
python bin/analyze_text_field_words.py

# Run integration quality tests
python -m pytest tests/test_integration_chunk_quality.py

# Check vector ID consistency
python bin/verify_vector_ids.py
```

## Future Enhancements

### Planned Improvements

- **Multi-language Support**: Extend spaCy processing to additional languages
- **Content-Type Optimization**: Specialized chunking for technical documentation
- **Advanced Overlap Strategies**: Context-aware overlap based on semantic similarity
- **Performance Optimization**: GPU acceleration for large-scale processing

### Monitoring and Analytics

- **Quality Dashboards**: Real-time visualization of chunk quality metrics
- **Performance Tracking**: Processing speed and resource utilization monitoring
- **Content Analysis**: Automated detection of content quality issues
- **Usage Analytics**: Understanding of search patterns and chunk effectiveness

## Conclusion

The spaCy-based semantic chunking strategy represents a significant advancement in knowledge base construction for RAG
applications. By prioritizing semantic coherence over arbitrary size limits, maintaining intelligent overlap, and
implementing comprehensive quality monitoring, we've created a robust foundation for high-quality question answering.

This approach ensures that the Ananda Library Chatbot can provide accurate, contextual responses while maintaining the
integrity and meaning of the original spiritual and philosophical teachings it serves to share.
