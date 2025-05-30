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

**Purpose**: Consistent document-level hashing for bulk operations and chunk grouping.

**Key Function**: `generate_document_hash(source, title, author, library, page_number) -> str`

Returns 8-character MD5 hash where all chunks from same document share same hash. Supports both paginated and
non-paginated content.

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
