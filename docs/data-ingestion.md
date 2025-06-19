# Data Ingestion Architecture

## Overview

The Ananda Library Chatbot uses a sophisticated data ingestion pipeline that processes multiple content types into a
unified vector database for retrieval-augmented generation (RAG). This document provides a high-level overview and
references to detailed implementation documentation.

## Comprehensive Documentation

**For complete details on chunking strategy, implementation, and technical specifications, see:**

**📖 [Chunking Strategy Implementation](chunking-strategy.md)**

The chunking-strategy.md document contains the authoritative and up-to-date information on:

- **Current Implementation**: spaCy word-based token chunking strategy
- **Technical Details**: SpacyTextSplitter implementation and configuration
- **Integration Across Data Sources**: PDF, audio/video, web crawling, and database content
- **Performance Results**: RAG evaluation metrics and strategy comparisons
- **Quality Assurance**: Testing, validation, and monitoring approaches
- **Migration Status**: Completed implementations and future enhancements

## Quick Reference

### Supported Content Types

- **PDF Documents**: Native text PDFs using pdfplumber extraction
- **Audio/Video**: Transcribed content with timestamp preservation
- **Web Content**: Crawled websites with semantic content extraction
- **Database Text**: CMS content with HTML cleaning and normalization

### Core Chunking Strategy

**Validated Parameters (Post-Investigation)**:

- **Audio/Video Transcription**: 190 tokens (~95 words) with 95 token overlap (50%)
- **Text Sources (PDF, Web, SQL)**: 250 tokens (~125 words) with 50 token overlap (20%)
- **Boundary Respect**: spaCy sentence-based boundaries with token limits
- **Approach**: Using empirically validated historical parameters that provide reliable performance

**Investigation Results (2025)**:

A comprehensive evaluation investigation revealed:

- **Initial Concern**: Textual similarity evaluation suggested significant performance degradation
- **Actual Reality**: Embedding-based semantic similarity showed only ~4% performance difference between systems
- **Current System**: 100% strict precision (0.956 average semantic similarity)
- **New System**: 96% strict precision (0.933 average semantic similarity)
- **Root Cause**: Evaluation methodology limitation, not system performance issue

**Current Process**:

1. **Maintain Historical Parameters**: Continue using proven chunk sizes that provide reliable performance
2. **Enhanced Evaluation**: All RAG evaluation now uses embedding-based semantic similarity for accuracy
3. **Performance Monitoring**: Established reliable evaluation infrastructure using proper semantic similarity metrics
4. **Continuous Validation**: Regular performance monitoring against established baselines

**Content-Specific Historical Evidence**:

- **Audio/Video**: Historical system used ~150 words with high overlap optimized for speech patterns
- **Text Sources**: Historical system used 1000-character chunks (~250 tokens) optimized for written content

**Key Learning**: Always use embedding-based semantic similarity for RAG evaluation. Textual matching can produce false
performance alarms and misdirect optimization efforts.

### Key Scripts

- `pdf_to_vector_db.py` - PDF document ingestion
- `transcribe_and_ingest_media.py` - Audio/video processing
- `website_crawler.py` - Web content crawling
- `ingest_db_text.py` - Database content ingestion

### Shared Utilities

- `data_ingestion/utils/spacy_text_splitter.py` - Core chunking logic
- `data_ingestion/utils/text_processing.py` - Text cleaning utilities
- `data_ingestion/utils/pinecone_utils.py` - Vector database operations
- `data_ingestion/utils/document_hash.py` - Document-level hashing

## Environment Setup

Each site requires configuration:

```bash
# Load site-specific environment
python script_name.py --site ananda

# Configuration files
.env.ananda                           # Environment variables
crawler_config/ananda-config.json     # Crawling configuration
site-config/prompts/ananda.txt        # System prompts
```

## Quality Monitoring

```bash
# Run comprehensive tests
cd data_ingestion && python -m pytest

# Analyze chunk quality
python bin/analyze_small_chunks.py --site ananda --library "Library Name"

# Evaluate RAG performance
python bin/evaluate_spacy_chunking_strategies.py --site ananda
```

## Getting Started

1. **Review the comprehensive documentation**: [chunking-strategy.md](chunking-strategy.md)
2. **Set up environment**: Configure `.env.{site}` file with required API keys
3. **Choose ingestion method**: Select appropriate script for your content type
4. **Run with site parameter**: Use `--site {site}` to load correct configuration
5. **Monitor quality**: Use testing and analysis tools to validate results

## Support

For detailed implementation questions, troubleshooting, and technical specifications, refer to the comprehensive
documentation in [chunking-strategy.md](chunking-strategy.md).
