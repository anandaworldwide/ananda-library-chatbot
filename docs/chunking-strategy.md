# Chunking Strategy Implementation

## Overview

The Ananda Library Chatbot uses a sophisticated semantic chunking strategy based on spaCy paragraph detection to improve
retrieval quality in the RAG (Retrieval-Augmented Generation) pipeline. This approach significantly outperforms
traditional fixed-size chunking methods and dynamic chunking strategies.

## Current Implementation: spaCy Paragraph-Based Chunking

### Key Features

- **Semantic Awareness**: Uses spaCy's natural language processing to identify paragraph boundaries
- **Fixed Target Sizing**: Consistent chunk sizes (~600 tokens, ~300 words) with 20% overlap for optimal RAG performance
- **Context Preservation**: Maintains semantic coherence by respecting paragraph boundaries
- **Smart Merging**: Post-processing to merge small chunks into optimal word count ranges
- **Comprehensive Metrics**: Detailed logging and analytics for chunk quality assessment
- **Fallback Strategy**: Automatically falls back to sentence-based chunking for texts without clear paragraphs
- **Proven Performance**: RAG evaluation results show 60% better precision than dynamic chunking

### Technical Implementation

The chunking logic is implemented in `data_ingestion/utils/spacy_text_splitter.py`:

- **SpacyTextSplitter Class**: Core chunking utility that can be used across all data ingestion scripts
- **Language Model**: Uses spaCy's English language model for text processing
- **Chunk Overlap**: Implements 20% overlap to preserve context across chunk boundaries
- **Text Cleaning**: Includes robust text preprocessing to handle various input formats

#### Audio/Video Specific Implementation

For audio/video transcriptions in `data_ingestion/audio_video/transcription_utils.py`:

- **Two-Stage Processing**: SpacyTextSplitter creates semantic text chunks, then maps back to timestamped words
- **Proportional Word Mapping**: Uses word count ratios to allocate timestamped words to spaCy chunks
- **Timestamp Preservation**: Maintains perfect audio/video timestamp accuracy for playback synchronization
- **Robust Error Handling**: Includes emergency fallbacks and comprehensive logging
- **Legacy Fallback**: Falls back to original word-based chunking if spaCy processing fails

### Integration Across Data Sources

The spaCy paragraph-based chunking strategy has been integrated into all major data ingestion methods:

#### PDF Ingestion (`pdf_to_vector_db.py`)

- **Full Document Processing**: Changed from page-by-page to complete document processing
- **Context Preservation**: Eliminates artificial paragraph breaks at page boundaries
- **Improved Quality**: Better semantic coherence across the entire document

#### Audio/Video Transcription (`transcribe_and_ingest_media.py`)

- **Paragraph-Based Chunking**: Uses fixed ~600 token target with spaCy paragraph detection
- **Semantic Chunking**: Maintains natural speech flow and semantic boundaries
- **Metadata Preservation**: Maintains audio timestamps and word-level metadata
- **Quality Metrics**: Enhanced logging for chunk quality and target range achievement
- **Consistent Performance**: Achieves 87.5%+ target range compliance (225-450 words)
- **Timestamp Accuracy**: Perfect preservation of audio timestamps for playback synchronization
- **Robust Word Mapping**: Uses proportional allocation strategy to map spaCy text chunks back to timestamped words
- **Fallback Strategy**: Legacy word-based chunking available if spaCy processing fails

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

### Paragraph-Based Chunking Strategy

All ingestion scripts now use consistent paragraph-based chunking parameters:

#### Unified Target Sizes

- **Standard Configuration**: ~600 tokens with 20% overlap (120 tokens)
- **Audio/Video Content**: ~300 words per chunk (converted from 600 tokens using 2:1 ratio)
- **Target Word Range**: 225-450 words per chunk across all content types
- **Very short texts** (<200 words): Single chunk, no splitting

#### Target Word Range Achievement

- **Primary Goal**: 225-450 words per chunk
- **Current Achievement**: 70%+ of chunks within target range
- **Audio Content**: 87.5%+ target range compliance
- **Smart Merging**: Post-processing combines small chunks to reach target

### Environment-Specific Settings

Scripts can be configured per site/environment using the `--site` argument to load appropriate environment variables.

## Performance Benefits

### RAG Evaluation Results

Based on comprehensive evaluation testing with 18 queries, the spaCy paragraph-based chunking strategy provides:

#### Performance Comparison (Current System, ada-002 with 1536 dimension)

- **Paragraph-based chunking**: Precision@5: 0.4444, NDCG@5: 0.7252, Time: 0.39s
- **Dynamic chunking**: Precision@5: 0.2778, NDCG@5: 0.5670, Time: 3.10s
- **Fixed-size chunking (256 tokens)**: Precision@5: 0.1889, NDCG@5: 0.4262, Time: 0.39s

#### Key Benefits

- **60% better precision** compared to dynamic chunking
- **28% better NDCG scores** for retrieval quality
- **7.8x faster retrieval time** than dynamic chunking
- **Consistent performance** across all content types

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

- **Dynamic Chunking Evaluation and Abandonment**: Comprehensive testing showed paragraph-based chunking significantly
  outperforms dynamic chunking
- **Audio/Video Transcription Updates**: Converted from dynamic to paragraph-based chunking with fixed 600-token targets
- **Audio Transcription Chunking Fix**: Resolved timeout issues by implementing actual spaCy text processing instead of
  manual word-based chunking
- **Improved Word Mapping**: Fixed "No words found for chunk" warnings with proportional word allocation strategy
- **Comprehensive logging and metrics tracking system**
- **Refined chunking thresholds achieving 70%+ target range compliance**

### Strategic Decisions ✅

- **Abandoned Dynamic Chunking**: Based on empirical evaluation data showing poor performance
- **Standardized on Paragraph-Based**: Consistent approach across all content types
- **Data-Driven Architecture**: All chunking decisions based on RAG evaluation results

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

Comprehensive evaluation system (`data_ingestion/bin/evaluate_rag_system.py`) provides:

- **Multi-strategy comparison**: Tests paragraph-based, sentence-based, dynamic, and fixed-size chunking
- **Performance metrics**: Precision@K, NDCG@K, and retrieval time measurements
- **Cross-system testing**: Evaluation across different Pinecone indexes and embedding models
- **Data-driven decisions**: Empirical basis for architectural choices

## Best Practices

### Content-Specific Considerations

- **Academic Papers**: Paragraph-based chunking preserves argument structure
- **Conversational Content**: Maintains natural dialogue flow and semantic boundaries
- **Technical Documentation**: Preserves procedural steps and logical flow
- **Creative Content**: Maintains narrative and stylistic coherence
- **Audio/Video Transcriptions**: Preserves spoken language patterns and timing accuracy using two-stage processing
  approach

### Configuration Guidelines

- **All Content Types**: Use standard 600-token target with 20% overlap
- **Short Form Content**: Single chunk for content <200 words
- **Mixed Content**: Paragraph-based approach handles most content types optimally
- **Performance Priority**: Fixed-size approach ensures consistent retrieval speeds
