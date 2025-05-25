# Chunking Strategy Implementation

## Overview

The Ananda Library Chatbot uses a sophisticated semantic chunking strategy based on spaCy paragraph detection to improve
retrieval quality in the RAG (Retrieval-Augmented Generation) pipeline. This approach significantly outperforms
traditional fixed-size chunking methods.

## Current Implementation: spaCy Paragraph-Based Chunking

### Key Features

- **Semantic Awareness**: Uses spaCy's natural language processing to identify paragraph boundaries
- **Dynamic Sizing**: Adaptive chunk sizes based on content length (225-450 word target range)
- **Context Preservation**: Maintains semantic coherence by respecting paragraph boundaries
- **Smart Merging**: Post-processing to merge small chunks into optimal word count ranges
- **Comprehensive Metrics**: Detailed logging and analytics for chunk quality assessment
- **Fallback Strategy**: Automatically falls back to sentence-based chunking for texts without clear paragraphs
- **Performance**: RAG evaluation results show significant improvement over fixed-size chunking

### Technical Implementation

The chunking logic is implemented in `data_ingestion/utils/spacy_text_splitter.py`:

- **SpacyTextSplitter Class**: Core chunking utility that can be used across all data ingestion scripts
- **Language Model**: Uses spaCy's English language model for text processing
- **Chunk Overlap**: Implements configurable overlap to preserve context across chunk boundaries
- **Text Cleaning**: Includes robust text preprocessing to handle various input formats

### Integration Across Data Sources

The spaCy chunking strategy has been integrated into all major data ingestion methods:

#### PDF Ingestion (`pdf_to_vector_db.py`)

- **Full Document Processing**: Changed from page-by-page to complete document processing
- **Context Preservation**: Eliminates artificial paragraph breaks at page boundaries
- **Improved Quality**: Better semantic coherence across the entire document

#### Audio/Video Transcription (`transcribe_and_ingest_media.py`)

- **Dynamic Chunk Sizing**: Adaptive token sizes based on content length for optimal word count
- **Semantic Chunking**: Uses spaCy paragraph detection with fallback to legacy chunking
- **Metadata Preservation**: Maintains audio timestamps and word-level metadata
- **Quality Metrics**: Enhanced logging for chunk quality and target range achievement
- **Conversational Context**: Maintains natural speech flow and semantic boundaries

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

### Dynamic Chunk Sizing Strategy

All ingestion scripts now use adaptive chunking parameters based on content length:

#### Content-Based Thresholds

- **Short content** (<1,000 words): 800 tokens, 200-token overlap
- **Medium content** (1,000-5,000 words): 1200 tokens, 300-token overlap
- **Long content** (>5,000 words): 1600 tokens, 400-token overlap
- **Very short texts** (<200 words): Single chunk, no splitting

#### Target Word Range

- **Primary Goal**: 225-450 words per chunk
- **Current Achievement**: 70% of chunks within target range
- **Smart Merging**: Post-processing combines small chunks to reach target

### Environment-Specific Settings

Scripts can be configured per site/environment using the `--site` argument to load appropriate environment variables.

## Performance Benefits

### RAG Evaluation Results

Based on comprehensive evaluation testing, the spaCy paragraph-based chunking strategy provides:

- **Better Context Retrieval**: More semantically coherent chunks improve relevance
- **Reduced Information Loss**: Paragraph boundaries preserve complete thoughts
- **Improved Answer Quality**: Better context leads to more accurate and complete responses
- **Faster Processing**: Document-level hashing reduces database operations

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
- Testing infrastructure for chunking validation

### In Progress 🚧

- Web crawling integration
- SQL database ingestion updates

### Recently Completed ✅

- Audio/video transcript ingestion updates with dynamic chunk sizing
- Comprehensive logging and metrics tracking system
- Refined chunking thresholds achieving 70% target range compliance

### Future Enhancements 🔮

- Content-type specific chunking strategies
- Dynamic chunk size optimization
- Multi-language support for non-English content
- Advanced semantic boundary detection

## Testing and Validation

### Unit Tests

Comprehensive test suite in `data_ingestion/tests/` covers:

- Text splitting with various content types
- Chunk overlap validation
- Metadata preservation
- Edge case handling
- Dynamic chunk sizing validation

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

## Best Practices

### Content-Specific Considerations

- **Academic Papers**: Paragraph-based chunking preserves argument structure
- **Conversational Content**: Maintains natural dialogue flow and semantic boundaries
- **Technical Documentation**: Preserves procedural steps and logical flow
- **Creative Content**: Maintains narrative and stylistic coherence

### Configuration Guidelines

- **Large Documents**: Consider slightly larger chunk sizes for complex content
- **Short Form Content**: May benefit from reduced overlap percentages
- **Mixed Content**: Use default settings as they handle most content types well
