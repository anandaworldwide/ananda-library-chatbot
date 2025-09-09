# Python Shared Utilities Documentation

## Overview

The Ananda Library Chatbot project uses shared Python utilities to ensure consistency across all data ingestion
pipelines. These utilities are organized into two directories:

- **[data_ingestion/utils/](../data_ingestion/utils)** - Core data ingestion utilities
- **[pyutil/](../pyutil)** - General-purpose Python utilities

## Architecture Principles

All utilities follow consistent patterns for error handling, environment validation, comprehensive documentation, and
pytest-compatible testing. Key shared dependencies include spaCy, OpenAI, Pinecone, TQDM, and structured logging.

---

## Data Ingestion Utilities (`data_ingestion/utils/`)

### 1. Text Processing (`text_processing.py`)

**Purpose**: Text cleaning and normalization for optimal vectorization quality.

**Key Functions**:

- `remove_html_tags()`: HTML tag removal using BeautifulSoup
- `replace_smart_quotes()`: Unicode to ASCII conversion
- `clean_document_text()`: PDF artifact removal (table of contents dots)
- `extract_text_content()`: Main processing pipeline with auto-detection

**Usage**:

```python
from data_ingestion.utils.text_processing import extract_text_content
cleaned_text = extract_text_content(raw_text, content_type="auto")
```

### 2. Semantic Text Splitting (`text_splitter_utils.py`)

**Purpose**: spaCy-based semantic chunking with dynamic sizing and comprehensive metrics.

**Core Class**: `SpacyTextSplitter`

- Dynamic sizing: 800-1600 tokens based on document length
- Target range: 225-450 words per chunk (70% compliance goal)
- Smart merging: Post-processing to merge small chunks
- Overlap handling: 20% token-based overlap
- Fallback strategy: Sentence-based splitting when needed

**Metrics Tracking**: `ChunkingMetrics` class tracks distribution, edge cases, and anomalies.

**Usage**:

```python
from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

text_splitter = SpacyTextSplitter(chunk_size=600, chunk_overlap=120, pipeline="en_core_web_sm")
chunks = text_splitter.split_text(document_text, document_id="doc_123")
```

### 3. Pinecone Operations (`pinecone_utils.py`)

**Purpose**: Unified Pinecone client management and vector operations.

**Key Functions**:

- `get_pinecone_client()`: Client initialization with validation
- `validate_pinecone_config()`: Environment variable validation
- `create_pinecone_index_if_not_exists()`: Index creation (sync/async)
- `batch_upsert_vectors()`: Optimized batch operations
- `generate_vector_id()`: Standardized 7-part vector ID generation

**Vector ID Format**: `{site}#{source_type}#{doc_hash}#{chunk_index}#{start_word}#{end_word}#{metadata_hash}`

### 4. Document Hashing (`document_hash.py`)

**Purpose**: Pure content-based hashing for true deduplication across all metadata variations.

**Key Function**: `generate_document_hash(title, author, content_type, chunk_text) -> str`

Returns 8-character MD5 hash based purely on content (`content_type` and `chunk_text` only), enabling maximum
deduplication. Title and author parameters are ignored but kept for compatibility. Identical text content will generate
the same hash regardless of titles, authors, libraries, or source locations, ensuring true content-based deduplication.

### 5. Embeddings Management (`embeddings_utils.py`)

**Purpose**: Unified OpenAI embeddings interface with comprehensive error handling.

**Core Class**: `OpenAIEmbeddings`

- Synchronous and asynchronous operations
- Batch processing optimization
- Retry logic with exponential backoff
- Configuration validation

**Key Functions**: `validate_embedding_config()`, `get_embedding_dimension()`, `create_embeddings_client()`

### 6. Progress Tracking (`progress_utils.py`)

**Purpose**: Progress tracking with signal handling and checkpointing integration.

**Core Classes**:

- `ProgressTracker`: Context manager with checkpoint integration
- `ProgressConfig`: Configuration for progress operations
- `ProgressState`: Current state tracking

**Key Features**: Signal handling for graceful shutdown, automatic checkpointing, thread-safe operation.

**Usage**:

```python
from data_ingestion.utils.progress_utils import ProgressTracker, ProgressConfig, setup_signal_handlers

setup_signal_handlers()
config = ProgressConfig(description="Processing", total=1000, checkpoint_interval=10)

with ProgressTracker(config, checkpoint_callback=save_checkpoint) as tracker:
    for item in items:
        if tracker.update():
            process_item(item)
        else:
            break
```

### 7. Checkpoint Management (`checkpoint_utils.py`)

**Purpose**: Unified checkpoint functionality supporting different checkpointing patterns.

**Core Classes**: `CheckpointManager`, `CheckpointConfig`, and data classes for file-based, ID-based, and progress-based
checkpointing.

**Features**: Atomic operations, multiple backup retention, resume capability, backward compatibility.

### 8. Retry Logic (`retry_utils.py`)

**Purpose**: Robust retry logic with exponential backoff for API operations.

**Key Functions**: `retry_with_backoff()` (async) and `retry_with_backoff_sync()`

**Predefined Configurations**:

- `EMBEDDING_RETRY_CONFIG`: OpenAI embeddings (3 retries, 2s base delay)
- `PINECONE_RETRY_CONFIG`: Pinecone operations (5 retries, 1s base delay)
- `NETWORK_RETRY_CONFIG`: Network operations (3 retries, 1s base delay)

**Usage**:

```python
from data_ingestion.utils.retry_utils import retry_with_backoff, EMBEDDING_RETRY_CONFIG

result = await retry_with_backoff(
    embedding_operation,
    operation_name="OpenAI embedding",
    **EMBEDDING_RETRY_CONFIG
)
```

---

## General Python Utilities (`pyutil/`)

### 1. Logging Configuration (`logging_utils.py`)

**Purpose**: Standardized logging setup with color formatting.

**Key Functions**: `configure_logging(debug=False)` and `ColorFormatter` class.

**Features**: Color-coded warnings (yellow) and errors (red), configurable debug mode, noise reduction for third-party
libraries.

**Target Loggers**: `data_ingestion`, `pyutil`, `__main__`

### 2. Environment Management (`env_utils.py`)

**Purpose**: Site-specific environment variable loading with intelligent path discovery.

**Key Function**: `load_env(site_id) -> dict`

**Features**: Automatic `.env.{site}` file discovery, searches up to 3 levels up, comprehensive error reporting.

**Supported Sites**: `ananda`, `ananda-public`, `crystal`, `jairam`

---

## Integration Patterns

### Consistent Error Handling

```python
try:
    result = primary_function()
except SpecificException as e:
    logger.error(f"Specific error in {operation_name}: {e}")
    # Handle specific case
except Exception as e:
    logger.error(f"Unexpected error in {operation_name}: {e}")
    raise
```

### Environment Variable Validation

```python
def validate_config() -> dict[str, str]:
    required_vars = {"VAR_NAME": os.environ.get("VAR_NAME")}
    missing_vars = [var for var, value in required_vars.items() if not value]
    if missing_vars:
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
    return required_vars
```

### Progress Integration

```python
from data_ingestion.utils.progress_utils import setup_signal_handlers, ProgressTracker, ProgressConfig

setup_signal_handlers()
config = ProgressConfig(description="Processing", total=len(items))
with ProgressTracker(config, checkpoint_callback=save_progress) as tracker:
    for item in items:
        if not tracker.update():
            break
        process_item(item)
```

---

## Testing and Quality Assurance

### Test Coverage

All utilities have comprehensive test coverage:

- **Location**: `data_ingestion/tests/test_*.py`
- **Framework**: pytest with pytest-asyncio
- **Command**: `cd data_ingestion && python -m pytest`

### Quality Standards

- Type hints for all functions
- Comprehensive docstrings with examples
- Specific exception types and detailed logging
- Standardized patterns across utilities

---

## Migration and Troubleshooting

### From Legacy Implementations

1. **Text Processing**: Replace custom HTML cleaning with `text_processing.extract_text_content()`
2. **Chunking**: Replace TokenTextSplitter with `SpacyTextSplitter`
3. **Progress**: Replace custom progress bars with `ProgressTracker`
4. **Retry Logic**: Replace custom retry with `retry_with_backoff`
5. **Embeddings**: Replace direct OpenAI calls with `OpenAIEmbeddings`

### Common Issues

1. **spaCy Model Missing**: Install with `python -m spacy download en_core_web_sm`
2. **Environment Variables**: Verify `.env.{site}` file locations and content
3. **Pinecone Connection**: Check API key and index name configuration
4. **Memory Issues**: Use batch processing and streaming for large datasets

### Debug Mode

```python
from pyutil.logging_utils import configure_logging
configure_logging(debug=True)
```

---

## Contributing Guidelines

### Adding New Utilities

1. Follow naming conventions: descriptive names ending in `_utils.py`
2. Include comprehensive documentation with examples
3. Add unit tests in `data_ingestion/tests/`
4. Update this documentation
5. Maintain consistency with existing patterns

### Best Practices

- Single responsibility for each utility
- Environment variables for configuration
- Meaningful error messages and recovery strategies
- Consider memory usage for large datasets
- Include both success and failure scenarios in tests

This documentation serves as the definitive reference for all shared Python utilities in the Ananda Library Chatbot
project. For specific implementation details, refer to the individual utility files and their comprehensive docstrings.

---

## RAG Evaluation Utilities (`bin/`)

### RAG Evaluation Overview

The project includes comprehensive utilities for evaluating Retrieval-Augmented Generation (RAG) system performance
using embedding-based semantic similarity.

### 1. RAG System Evaluation (`bin/evaluate_rag_system_no_rechunk.py`)

**Purpose**: Evaluates and compares RAG systems using original Pinecone chunks with embedding-based semantic similarity.

**Key Features**:

- **Embedding-Based Evaluation**: Uses OpenAI embeddings and cosine similarity for accurate semantic matching
- **Performance Caching**: Pre-computes embeddings to avoid redundant API calls (reduces runtime from 4+ hours to ~15
  minutes)
- **Multi-System Comparison**: Compares current vs new RAG systems simultaneously
- **Comprehensive Metrics**: Calculates Precision@K and NDCG@K with detailed reporting

**Critical Implementation Details**:

- **Caching Strategy**: Global `EMBEDDING_CACHE` with MD5 hash keys prevents API call explosion
- **Similarity Thresholds**: 0.85 strict, 0.7 lenient for semantic similarity matching
- **Progress Tracking**: TQDM progress bars for embedding pre-computation phase

**Usage**:

```bash
python bin/evaluate_rag_system_no_rechunk.py --site ananda
```

**Key Learning**: When switching from textual similarity to embedding-based evaluation, implement caching to prevent
massive API overhead. Without caching: ~12,800 API calls (4+ hours). With caching: ~1,300 unique API calls (15 minutes).

### 2. Multi-Query Analysis (`evaluation/compare_multiple_queries.py`)

**Purpose**: Analyzes multiple representative queries simultaneously to understand performance patterns.

**Key Features**:

- **Representative Query Selection**: Tests diverse query types across different content domains
- **Semantic Similarity Analysis**: Uses embedding-based matching for accurate evaluation
- **Performance Pattern Detection**: Identifies whether issues are query-specific or systemic
- **Detailed Reporting**: Per-query analysis with similarity scores and match types

**Critical Findings**:

- **Overall Performance**: Current system 100% strict precision (0.956 avg), New system 96% strict precision (0.933 avg)
- **Query-Specific Issues**: Only 1 out of 5 queries showed degradation, confirming issue is not systemic
- **Evaluation Methodology**: Embedding-based similarity provides much more accurate results than textual matching

### 3. Representative Query Comparison (`data_ingestion/compare_representative_query.py`)

**Purpose**: Deep analysis of a single representative query to understand retrieval differences between systems.

**Key Features**:

- **Top-K Chunk Analysis**: Retrieves and compares top-5 chunks from both Pinecone systems
- **Detailed Similarity Scoring**: Analyzes chunk text, Pinecone scores, and semantic similarity to judged documents
- **Match Type Classification**: Categorizes matches as strict, lenient, or no match based on similarity thresholds
- **Chunk-Level Debugging**: Provides detailed analysis for understanding retrieval behavior

### Key Evaluation Principles

#### 1. Always Use Embedding-Based Similarity

- **Problem**: Textual similarity (difflib.SequenceMatcher) fails to capture semantic relevance
- **Solution**: OpenAI embeddings with cosine similarity for accurate semantic matching
- **Impact**: Prevents false performance alarms and misdirected optimization efforts

#### 2. Implement Embedding Caching

- **Problem**: Embedding API calls create massive overhead (12,800+ calls = 4+ hours)
- **Solution**: Pre-compute and cache all unique text embeddings at startup
- **Implementation**: Global cache with MD5 hash keys based on text+model combination

#### 3. Use Representative Query Sets

- **Purpose**: Understand whether performance issues are query-specific or systemic
- **Method**: Test diverse queries across different content domains and complexity levels
- **Benefit**: Prevents over-optimization for specific edge cases

### Dependencies

**Required Packages**:

- `openai` - For embedding generation and semantic similarity
- `pinecone-client` - For vector database operations
- `scikit-learn` - For NDCG calculation and similarity metrics
- `numpy` - For vector operations and cosine similarity
- `tqdm` - For progress tracking during embedding pre-computation

**Environment Variables**:

- `OPENAI_API_KEY` - OpenAI API access for embeddings
- `PINECONE_API_KEY` - Pinecone vector database access
- Site-specific index and model configurations

### Performance Optimization

**Embedding Caching Strategy**:

```python
# Global cache prevents redundant API calls
EMBEDDING_CACHE = {}

def get_embedding(text, model_name, openai_client):
    cache_key = get_text_hash(text, model_name)
    if cache_key in EMBEDDING_CACHE:
        return EMBEDDING_CACHE[cache_key]
    # ... API call and caching logic
```

**Pre-computation Pattern**:

```python
def precompute_embeddings(eval_data, embedding_models, openai_client):
    # Collect all unique texts from queries and judged documents
    unique_texts = set()
    for query, judged_docs in eval_data.items():
        unique_texts.add(query)
        for doc in judged_docs:
            unique_texts.add(doc["document"])

    # Pre-compute with progress tracking
    with tqdm(total=len(unique_texts), desc=f"Embedding {model_name}") as pbar:
        for text in unique_texts:
            embedding = get_embedding(text, model_name, openai_client)
            pbar.update(1)
```
