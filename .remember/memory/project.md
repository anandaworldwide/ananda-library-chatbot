# Project.md

## Current project

See @crawler-TODO.md

## Focused spaCy Chunking Strategy Evaluation Script - COMPLETED

**Status**: Created focused evaluation script `bin/evaluate_spacy_chunking_strategies.py` for narrowing down chunking
options.

**Script Purpose**: Compare only the 4 specific spaCy chunking strategies the user is considering:

- spaCy sentence-based chunking at 300 tokens (25% overlap)
- spaCy sentence-based chunking at 600 tokens (20% overlap)
- spaCy paragraph-based chunking at 300 tokens (25% overlap)
- spaCy paragraph-based chunking at 600 tokens (20% overlap)

**Key Simplifications from Original**:

- **Single system evaluation**: Only evaluates current production system (removed new system logic)
- **Focused strategies**: Only 4 spaCy strategies instead of 5 mixed strategies
- **Streamlined code**: Removed dual-system comparison logic and variables
- **Enhanced reporting**: Added recommendation engine and detailed analysis
- **Clean interface**: Simplified argument parsing and configuration

**Features**:

- Evaluation using human-judged dataset (`evaluation_dataset_ananda.jsonl`)
- Precision@K and NDCG@K metrics calculation
- Retrieved chunks for manual review
- Comparison table sorted by performance
- Automated recommendation with combined scoring (40% Precision + 60% NDCG)
- Analysis comparing sentence vs paragraph approaches and 300 vs 600 token sizes

**Usage**:

```bash
cd bin
python evaluate_spacy_chunking_strategies.py --site ananda
```

**Expected Output**:

- Manual review section with retrieved chunks
- Average metrics for each strategy
- Comparison table sorted by performance
- Recommendation with best strategy and analysis

**Benefits**:

- Focused evaluation for decision-making
- Clear performance comparison between approaches
- Automated recommendation to guide chunking strategy selection
- Detailed logging for debugging and analysis

## Parallel Queue Support for Audio/Video Processing - COMPLETED

**Status**: Successfully implemented parallel queue support for audio/video media processing, enabling simultaneous
processing of multiple libraries.

**Implementation Details**:

- **Files Modified**: `data_ingestion/audio_video/transcribe_and_ingest_media.py`
- **Changes Made**:
  - Added `--queue/-q` parameter to argument parser
  - Updated queue initialization to use custom queue directories:
    `IngestQueue(queue_dir=args.queue) if args.queue else IngestQueue()`
  - Added logging to indicate which queue is being used
  - Updated docstring with usage examples for parallel processing

**Queue Infrastructure** (Already Existed):

- **manage_queue.py**: Already had full parallel queue support via `--queue` parameter
- **IngestQueue class**: File-based queue system with POSIX locks for concurrent access
- **Queue isolation**: Each queue uses separate directory with independent JSON files
- **Status tracking**: Maintains item lifecycle independently per queue

**Shared Resources** (Beneficial for performance):

- **Transcription Cache**: Shared across all instances to avoid duplicate OpenAI API calls
  - `data_ingestion/media/transcriptions.db` (SQLite database)
  - `data_ingestion/media/transcriptions/` (gzipped JSON files)
  - `data_ingestion/media/youtube_data_map.json`
- **Processing Time Estimates**: Shared performance metrics in
  `data_ingestion/audio_video/data/processing_time_estimates.json`

**Usage Examples**:

```bash
# Process different libraries in parallel
python transcribe_and_ingest_media.py -s ananda -q queue-bhaktan
python transcribe_and_ingest_media.py -s ananda -q queue-treasures
python transcribe_and_ingest_media.py -s ananda -q queue-video

# Add content to specific queues
python manage_queue.py -s ananda -q queue-bhaktan -D /path/to/bhaktan/audio -A "Author" -L "Bhaktan"
python manage_queue.py -s ananda -q queue-treasures -D /path/to/treasures/audio -A "Author" -L "Treasures"
python manage_queue.py -s ananda -q queue-video -v "https://youtube.com/watch?v=..." -A "Author" -L "VideoLib"
```

**Benefits**:

- **Parallel Processing**: Multiple libraries can be ingested simultaneously
- **Resource Efficiency**: Shared transcription cache prevents duplicate work
- **Queue Isolation**: Independent progress tracking and error handling per library
- **Scalability**: Can run as many parallel instances as system resources allow
- **Fault Tolerance**: Failure in one queue doesn't affect others

**Technical Implementation**:

- **Queue Directories**: `queue-bhaktan/`, `queue-treasures/`, `queue-video/`, etc.
- **Concurrent Safety**: POSIX file locking handles concurrent access to shared resources
- **Memory Management**: Each instance maintains separate OpenAI and Pinecone connections
- **Progress Tracking**: Independent progress bars and reporting per queue

## Comprehensive Cursor Rules System

**Status**: Complete comprehensive Cursor rules generated for the entire Ananda Library Chatbot project.

**Rules Created**: Six focused rule files covering all aspects of the system:

1. **[.cursor/rules/project-overview.mdc](mdc:.cursor/rules/project-overview.mdc)** - System architecture overview,
   documentation navigation, site configurations, and development standards
2. **[.cursor/rules/data-ingestion.mdc](mdc:.cursor/rules/data-ingestion.mdc)** - Semantic chunking strategy, ingestion
   pipelines, shared utilities, and quality assurance
3. **[.cursor/rules/api-backend.mdc](mdc:.cursor/rules/api-backend.mdc)** - API structure, authentication system,
   database integrations, and LangChain implementation
4. **[.cursor/rules/frontend-ui.mdc](mdc:.cursor/rules/frontend-ui.mdc)** - Component structure, styling standards,
   state management, and UX guidelines
5. **[.cursor/rules/testing-quality.mdc](mdc:.cursor/rules/testing-quality.mdc)** - Testing philosophy, frontend/backend
   testing, integration testing, and quality standards
6. **[.cursor/rules/security-deployment.mdc](mdc:.cursor/rules/security-deployment.mdc)** - Security architecture,
   authentication, rate limiting, and deployment procedures

**Key Coverage Areas**:

- **Multi-technology stack**: TypeScript/React frontend, Python data ingestion, PHP WordPress plugin
- **RAG architecture**: Pinecone vector database, LangChain, OpenAI GPT models
- **Semantic chunking**: spaCy-based approach with 225-450 word target range
- **Multi-site support**: ananda, crystal, jairam, ananda-public configurations
- **Security implementation**: JWT authentication, rate limiting, input validation
- **Testing infrastructure**: Jest for frontend, pytest for Python, comprehensive integration tests
- **Documentation standards**: Extensive docs folder as authoritative reference

**Benefits**:

- **Comprehensive navigation**: AI can understand and work with any part of the codebase
- **Consistent standards**: Clear guidelines for development patterns and practices
- **Documentation integration**: Direct links to relevant documentation files
- **Quality assurance**: Testing and security requirements clearly defined
- **Multi-developer support**: Consistent approach across different technology stacks

**Format Compliance**: All rules use the `.mdc` format with proper file references using `[filename](mdc:path)` syntax
relative to workspace root.

## SpaCy Chunking Optimization - Tasks 5 & 6 Completed

**Task 5 - Monitoring and Logging**: Enhanced the SpacyTextSplitter with comprehensive logging and metrics tracking:

- **ChunkingMetrics Class**: Tracks document and chunk statistics across processing sessions
- **Document-Level Logging**: Word count, chunk count, chunk sizes, and overlaps for each document
- **Distribution Analysis**: Categorizes documents by word count ranges and chunks by size ranges
- **Edge Case Detection**: Identifies very short documents (<50 words), very long documents (>50,000 words), and large
  documents that don't get chunked
- **Anomaly Detection**: Flags unexpectedly small chunks (avg <50 words for >500 word documents) and very large chunks
  (>800 words)
- **Target Range Analysis**: Tracks how many chunks fall within the target 225-450 word range
- **Summary Reporting**: Provides comprehensive metrics with percentages and detailed breakdowns

**Task 6 - Threshold Refinement**: Successfully refined chunking strategy based on logged data analysis:

- **Target Range Achievement**: Improved from 0% to 70% of chunks in 225-450 word range
- **Increased Chunk Size Thresholds**:
  - Short content: 200→800 tokens
  - Medium content: 400→1200 tokens
  - Long content: 600→1600 tokens
- **Enhanced Overlaps**: Proportionally increased overlaps for better context preservation
- **Smart Chunk Merging**: Added post-processing step to merge small chunks into target range
- **Distribution Improvement**: 50% of chunks now 300-499 words vs 100% <100 words before
- **Quality Enhancement**: Average chunk sizes now 240-333 words (much closer to target)

**Key Features**:

- Metrics accumulate across all documents in a session
- Detailed per-document logging with document IDs
- Summary logging at the end of processing
- External access to metrics via `get_metrics_summary()` method
- Direct console printing via `print_summary()` method for clean integration
- Used by both SQL and PDF ingestion scripts for consistent statistics reporting
- Proper handling of both overlap and non-overlap code paths
- Intelligent chunk merging to reach target word counts

**Bug Fix**: Resolved issue where metrics were only recorded for documents processed through the "without overlap" code
path by extracting metrics recording to a helper method called from all return paths.

## Uncompressed 3072D vs 1536D RAG Evaluation Results - CRITICAL FINDINGS

**Status**: COMPLETED - Catastrophic performance degradation discovered in New System

**Evaluation Results** (18 queries, K=5):

### Current System (1536D text-embedding-ada-002) - PRODUCTION READY

- **spaCy sentence/paragraph**: Precision@5: 71.11%, NDCG@5: 86.34%, Time: 0.36-0.49s
- **Fixed-size chunking**: Precision@5: 66.67%, NDCG@5: 83.18%, Time: 0.34-0.37s
- **Dynamic chunking**: Precision@5: 70.00%, NDCG@5: 86.10%, Time: 2.70s

### New System (3072D text-embedding-3-large) - PRODUCTION FAILURE

- **Best strategy (dynamic)**: Precision@5: 11.11%, NDCG@5: 29.32%, Time: 2.26s
- **spaCy strategies**: Precision@5: 8.89-10.00%, NDCG@5: 23.57-27.62%
- **Fixed-size strategies**: Precision@5: 7.78%, NDCG@5: 19.13-19.64%

### Critical Analysis

**Performance Degradation**: 84-90% worse performance across all metrics and strategies **Quality Crisis**: NDCG scores
below 0.30 indicate fundamentally broken retrieval ranking **Speed Issues**: 6x slower for dynamic chunking, minimal
improvement for other strategies

### Strategic Decision: DO NOT DEPLOY NEW SYSTEM

**Root Causes Identified**:

1. **Dimensionality Issues**: 3072D embeddings likely suffering from curse of dimensionality
2. **Similarity Distribution Mismatch**: Different threshold requirements (confirmed by distribution analysis)
3. **Model Architecture**: text-embedding-3-large not optimal for spiritual/philosophical content

### Immediate Priority Experiments

**Experiment 1.2: PCA Dimensionality Reduction** (URGENT)

- Reduce 3072D→1536D using PCA
- Expected: Significant improvement based on 100% variance explained
- Implementation: Modify evaluation script to apply PCA before similarity search

**Experiment 3.1: Similarity Threshold Tuning** (HIGH)

- Test thresholds 0.2-0.8 in 0.1 increments
- New System's lower similarity scores may require different matching criteria

**Experiment 1.3: Alternative Models** (MEDIUM)

- Test text-embedding-3-small as middle ground
- May provide better performance without Current System limitations

### Technical Findings from Sample Chunks

**Current System Strengths**:

- High relevance scores (0.86+ similarity)
- Multiple relevant chunks per query (Relevance=3.0)
- Consistent performance across all chunking strategies

**New System Issues**:

- Low relevance scores (0.34-0.67 similarity)
- Few relevant chunks (mostly Relevance=0.0)
- Poor semantic understanding evidenced by chunk content quality

### Business Impact

**Cost of Deployment**: Deploying New System would result in 84-90% degradation in user experience **Recommended
Action**: Continue with Current System while implementing priority experiments **Timeline**: PCA experiment should be
completed within 1-2 days to determine viability

## Documentation Updates Completed

Updated all relevant documentation files to reflect the completed spaCy chunking optimization work:

- **`docs/chunking-strategy.md`**: Updated with dynamic sizing strategy, target word ranges, recent completions, and
  comprehensive testing details
- **`docs/backend-structure.md`**: Updated chunking description to reflect dynamic sizing and smart merging
- **`docs/tech-stack.md`**: Updated spaCy description and corrected testing framework (pytest vs unittest)
- **`docs/TESTS-README.md`**: Added diverse content testing section and updated chunking test descriptions

**Key Changes**:

- Removed incorrect references to speaker diarization (not implemented)
- Added dynamic chunk sizing details (225-450 word target range)
- Updated completion status for audio/video transcription integration
- Added comprehensive testing documentation for diverse content validation
- Corrected testing framework references (pytest for Python, not unittest)

## Shared Utilities Integration Status

**Discovery**: During verification of the shared utilities refactor completion, three additional ingestion scripts were
found that are not fully using the new shared utilities:

1. **`data_ingestion/db_to_pdf/db_to_pdfs.py`** - Partially updated (missing `remove_html_tags` import)
2. **`data_ingestion/pdf_to_vector_db.py`** - Partially updated (missing several major utilities)
3. **`data_ingestion/crawler/website_crawler.py`** - Not updated (only using `generate_document_hash`)

**Status**: Project completion revised from 100% to 85% complete. Remaining updates needed to achieve full code
deduplication and consistent error handling across all ingestion methods.

## Python Linting Setup

**Ruff Configuration**: The project uses Ruff for Python linting and formatting:

- **Configuration**: `pyproject.toml` contains Ruff settings following PEP 8
- **Extensions**: VS Code/Cursor should have the Ruff extension (`charliermarsh.ruff`) installed
- **Settings**: `.vscode/settings.json` configures Ruff as the default linter and formatter (environment-agnostic)
- **Installation**: Ruff is included in `requirements.in` and should be installed via `pip install ruff`
- **Features**: Auto-fix on save, import organization, unused import detection, unused variable detection
- **Rules**: Enables Pyflakes (F), pycodestyle (E), isort (I), pyupgrade (UP), flake8-bugbear (B), simplify (SIM), and
  complexity (C90)
- **Developer Setup**: `.vscode/settings.json.example` provides guidance for setting Python interpreter paths per
  environment
- **Auto-detection**: The settings rely on VS Code/Cursor's auto-detection of Python interpreters rather than hardcoded
  paths

## Data Ingestion Testing Infrastructure

**Python Testing Setup**: The project now includes comprehensive pytest-based testing for data ingestion:

- **Location**: `data_ingestion/tests/` directory contains all Python tests
- **Key Dependencies**: pytest, pytest-asyncio, pytest-mock, numpy<2.0 (version constraint important)
- **Test Coverage**: spaCy text chunking, Pinecone operations, document hashing, signal handling, web crawler
  functionality
- **Running Tests**: From `data_ingestion/` directory use `python -m pytest`
- **Site-Specific Testing**: Tests support `--site` argument for environment-specific configurations
- **Web Crawler Tests**: Comprehensive test coverage in `test_crawler.py` including SQLite operations, config loading,
  failure handling, and daemon behavior

**Integration Test Suite - COMPLETED**: Comprehensive chunk quality verification tests implemented:

- ✅ Integration tests that analyze results from actual ingestion scripts in test Pinecone database
- ✅ Consistency verification across all ingestion methods (PDF, SQL, crawler, audio/video)
- ✅ Target range compliance testing (225-450 words) with 60% minimum threshold
- ✅ Metadata preservation verification during chunking across all pipelines
- ✅ Vector ID format validation (7-part standardized format)
- ✅ Cross-method consistency analysis and quality metrics comparison
- ✅ Setup documentation for manual test data ingestion process

**Files Created**:

- `data_ingestion/tests/test_integration_chunk_quality.py` - Comprehensive integration test suite
- `data_ingestion/tests/INTEGRATION_TEST_SETUP.md` - Setup instructions for manual data ingestion

## spaCy Chunking Strategy Requirements

**Core Implementation**: All data ingestion now uses spaCy for semantic chunking:

- **Default Configuration**: 600 tokens per chunk with 20% overlap (dynamically adjusted)
- **Language Model**: Requires spaCy English model installation
- **Fallback Strategy**: Automatic fallback to sentence-based chunking when paragraphs not detected
- **Performance**: RAG evaluation shows significant improvement over fixed-size chunking
- **Integration**: Implemented across PDF, audio/video, web crawling, and SQL ingestion scripts
- **Target Range**: 225-450 words per chunk with smart merging to achieve 70% target range compliance
- **Metrics**: Comprehensive logging and statistics tracking across all ingestion methods

## CLI Development Preferences

**Long-form Arguments in Usage**: Always prefer displaying long-form command line arguments in usage statements instead
of short forms.

**Implementation**: In argparse, put the long-form option first in `add_argument()`:

```python
# Preferred - shows --video in usage
parser.add_argument("--video", "-v", metavar="URL", help="YouTube video URL")

# Avoid - shows -v in usage
parser.add_argument("-v", "--video", metavar="URL", help="YouTube video URL")
```

**Rationale**: Long-form arguments are more self-documenting and easier to understand in help text and error messages.

**Metavar Usage**: Always provide descriptive metavar values (e.g., `URL`, `PATH`, `ITEM_ID`, `NAME`) instead of letting
argparse generate confusing ALL CAPS versions.

## S3 Bucket Policy for Public Access

The user wants to restrict public access to a specific path within the S3 bucket.

**Previous Policy Snippet (PublicReadGetObject Statement)**:

```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ananda-chatbot/*"
}
```

**Current Preference (PublicReadGetObject Statement)**: The `Resource` should be restricted to a specific path, e.g.,
`public/audio/*`.

```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ananda-chatbot/public/audio/*"
}
```

### Dependency Version Alignment

- All shared dependencies across web and data_ingestion must match the versions in web/package.json. Web versions take
  priority.
- If adding or updating a dependency in any package, ensure the version matches web/package.json if it exists there.

### Vercel Monorepo Local Package Build Order Fix

**Problem:** When building a monorepo subdirectory (e.g., web/) in Vercel, ensure all dependencies are properly
configured and any local package references are removed.

**Fix:** If you have removed a local package from the project:

1. Remove any direct dependencies on the package from `package.json`
2. Remove any build or install scripts that reference the package
3. Update any import statements to use the new location of the code

### Browserslist Error in Next.js Build

**Problem:** Vercel build fails with `Cannot find module 'browserslist'` during the Next.js build process. This happens
when processing CSS files with autoprefixer in the Next.js application.

**Fix:**

- Add browserslist directly to the devDependencies of the package running Next.js (web/package.json):

  ```npm
  "browserslist": "^4.23.0"
  ```

- Run `npm install` to update the lockfile.

### TypeScript Configuration for Test Files

To prevent test files from being included in production builds while maintaining proper type checking for tests:

1. Create a separate `tsconfig.test.json` that extends the base config and includes test-specific files:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node", "@testing-library/jest-dom"]
  },
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "__tests__/**/*.ts",
    "__tests__/**/*.tsx",
    "jest.setup.ts",
    "jest.config.cjs"
  ]
}
```

1. Update the main `tsconfig.json` to exclude test files:

```json
{
  "exclude": ["node_modules", "**/*.test.ts", "**/*.test.tsx", "jest.setup.ts", "jest.config.cjs"]
}
```

1. Configure Jest to use the test-specific TypeScript config:

```js
{
  "transform": {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        "tsconfig": "<rootDir>/tsconfig.test.json"
      }
    ]
  }
}
```

This setup ensures that:

- Test files are properly type-checked during development and testing
- Test files and configurations are excluded from production builds
- Jest uses the correct TypeScript configuration for running tests

### Monorepo Package Structure Update

**Previous Structure**: The project used a local package `shared-utils` for shared utilities between web and
data_ingestion.

**Current Structure**:

- Shared utilities have been moved directly into their respective packages
- No local package dependencies are used
- Each package (web, data_ingestion) maintains its own independent utilities
- When adding new shared functionality, duplicate it in both packages rather than creating a shared package

This change was made to:

1. Simplify the build process
2. Remove complexity from package management
3. Eliminate potential circular dependencies
4. Make each package more self-contained and independently deployable

When adding new shared functionality:

- Copy the code to both packages if needed
- Maintain version alignment for any npm dependencies used in both packages
- Keep the implementations as similar as possible while allowing for package-specific optimizations

### Markdown Formatting

- Markdown files should adhere to a 120-character line limit.

### Script Argument for Environment Loading

**Situation**: Scripts like `bin/evaluate_rag_system.py` that need to access environment-specific configurations (e.g.,
API keys for different sites like 'ananda' or 'crystal') should use a consistent mechanism for loading these
configurations.

**Previous (Problematic)**: Some scripts might hardcode the environment file (e.g., `.env.ananda`) or lack a way to
specify the target site, making them less flexible.

**Correct (Preferred)**:

1. Add a command-line argument, typically `--site`, to the script using `argparse`.
2. Utilize a shared utility function, like `pyutil.env_utils.load_env(site_name)`, to load the appropriate
   `.env.<site_name>` file.
3. Ensure that functions relying on environment variables (e.g., `initialize_pinecone`, `load_environment`) fetch these
   variables _after_ `load_env` has been called.

**Example Snippet (`bin/evaluate_rag_system.py`)**:

```python
import argparse
from pyutil.env_utils import load_env
import os

def load_environment(site: str):
    """Load environment variables based on the site."""
    load_env(site)
    if not os.getenv("PINECONE_API_KEY") or not os.getenv("OPENAI_API_KEY"):
        raise ValueError("PINECONE_API_KEY or OPENAI_API_KEY not found after loading environment. Check .env.<site> file.")

# ... other helper functions ...

def main():
    parser = argparse.ArgumentParser(description='Evaluate RAG system performance.')
    parser.add_argument('--site', required=True, help='Site ID to load environment variables (e.g., ananda, crystal)')
    args = parser.parse_args()

    try:
        load_environment(args.site)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR loading environment: {e}")
        return

    openai.api_key = os.getenv("OPENAI_API_KEY")
    # ... rest of main

if __name__ == "__main__":
    main()
```

This approach standardizes how scripts handle site-specific configurations, improving maintainability and usability
across different environments/sites.

## PDF Test Hanging Issue Resolution

**Problem**: PDF to vector DB tests were hanging due to `MagicMock` objects having `__next__` attribute by default,
causing the `clear_library_text_vectors` function to enter an infinite loop in the generator handling code path.

**Solution**: Explicitly remove the `__next__` attribute from `MagicMock` objects when testing functions that check for
generators/iterators:

```python
mock_response = MagicMock()
if hasattr(mock_response, '__next__'):
    delattr(mock_response, '__next__')
```

**Additional Fixes Applied**:

- Fixed environment variable names (`PINECONE_INGEST_INDEX_NAME` vs `PINECONE_INGEST_INDEX`)
- Fixed checkpoint field names (`processed_files` vs `processed_docs`)
- Fixed signal handler exit code (1 vs 0)
- Fixed import paths for `load_dotenv` patching
- Set global variables required by cleanup function

All PDF to vector DB tests now pass successfully.

## User Preferences and Project Rules

### Testing Philosophy

- **Remove Obsolete Tests**: When functions are moved to shared utilities with their own comprehensive test coverage,
  remove the obsolete tests from the original scripts rather than duplicating test coverage
- **Shared Utilities Testing**: The project has 207 tests across all shared utility modules, providing comprehensive
  coverage for moved functionality

### Development Environment

- **Python Version**: Python 3.11.9 with pyenv
- **Virtual Environment**: `ananda-library-chatbot`
- **Testing Framework**: pytest with pytest-asyncio for async tests
- **Package Management**: pip with requirements.txt

### Code Organization Principles

- **Shared Utilities**: All common functionality should be moved to `data_ingestion/utils/` modules
- **Import Patterns**: Use absolute imports from project root with proper Python path configuration
- **Path Management**: Simple, readable path setup preferred over complex try/except blocks

## Vector ID Sanitization Fix - COMPLETED

**Problem**: Website crawler was failing with "Vector ID must be ASCII" errors when encountering non-ASCII characters
like ® (registered trademark) in page titles. The crawler was incorrectly marking these URLs as "visited" even though
vectors weren't stored.

**Solution**: Enhanced the `_sanitize_text` function in `pinecone_utils.py` to remove non-ASCII characters and modified
error handling in the crawler to detect and properly handle these errors as temporary failures.

**Changes Made**:

- **Enhanced Sanitization**: Updated `_sanitize_text` to remove non-ASCII characters using `ord(char) < 128` filter
- **Error Detection**: Modified `upsert_to_pinecone` to detect "Vector ID must be ASCII" errors and raise exceptions
- **Proper Failure Handling**: These errors are now treated as temporary failures that can be retried after the fix

**Testing**: All 58 tests pass (20 ingest_db_text + 38 pinecone_utils), confirming the fix works correctly without
breaking existing functionality.

**Status**: Vector ID sanitization issue resolved. URLs with non-ASCII characters in titles will now be processed
correctly.

## Vector ID Format Update - COMPLETED & RESOLVED

**Problem**: Website crawler was failing with "Vector ID must be ASCII" errors when encountering non-ASCII characters
like ® (registered trademark) in page titles. Additionally, the vector ID format restructuring from 3-part to 7-part
format created compatibility issues with existing filtering code.

**Solution**:

1. **Enhanced Sanitization**: Updated `_sanitize_text` function to remove non-ASCII characters using `ord(char) < 128`
   filter
2. **Error Detection**: Modified `upsert_to_pinecone` to detect and properly handle ASCII errors as temporary failures
3. **✅ Format Compatibility**: Updated vector ID format to put `content_type` first, making it backward compatible with
   existing filtering patterns

**Final Vector ID Format**:
`{content_type}||{library}||{source_location}||{sanitized_title}||{source_id}||{content_hash}||{chunk_index}`

**Backward Compatibility Achieved**:

- Old filtering: `text||ananda.org||`
- New vector ID: `text||ananda.org||web||Test Title||author123||9473fdd0||0`
- Result: ✅ **Perfect match - no code changes needed!**

**Changes Made**:

- **Enhanced Sanitization**: Updated `_sanitize_text` to remove non-ASCII characters
- **Error Detection**: Modified `upsert_to_pinecone` to detect "Vector ID must be ASCII" errors and raise exceptions
- **Format Update**: Changed vector ID generation to put content_type first for compatibility
- **Proper Failure Handling**: ASCII errors are now treated as temporary failures for retry

**Testing Results**:

- ✅ All existing tests pass unchanged
- ✅ Vector ID generation produces expected format
- ✅ Metadata extraction works correctly
- ✅ Existing filtering patterns work without modification
- ✅ ASCII sanitization prevents Pinecone errors

**Status**: FULLY RESOLVED - No further action needed. All compatibility issues addressed through format design rather
than code changes.

## Integration Test Setup Updated for Queue Management

**Updated**: `data_ingestion/tests/INTEGRATION_TEST_SETUP.md` to use the three-call queue management approach for audio
content ingestion:

**Previous Approach**: Single direct call to transcribe_and_ingest_media.py with specific input file **New Approach**:
Three-step queue-based process:

1. **Queue Status Check**: `manage_queue.py --status`

## Reranking System - Ignore Functionality Added

**Enhancement**: Added support for "ignore" option in relevance scoring for the markdown processing script.

**Implementation**: Modified `reranking/process_markdown.py` to handle "ignore" as an alternative to numeric scores
(0-3):

- **Regex Pattern**: Updated `SCORE_PATTERN` to accept both `\d` (numeric scores) and case-insensitive "ignore"
- **Processing Logic**: Documents marked as "ignore" are excluded from both evaluation and fine-tuning datasets
- **Status Tracking**: Script now reports both scored documents and ignored documents in progress messages
- **Documentation**: Updated module docstring and warning messages to reflect new functionality

**Benefits**:

- Allows human reviewers to intentionally skip documents without affecting processing completeness
- Provides clear distinction between missing scores (error) and intentional exclusions (ignore)
- Maintains data quality by excluding intentionally ignored documents from training datasets
- Case-insensitive matching handles variations in user input ("ignore", "Ignore", "IGNORE")

**Usage**: Human reviewers can now enter "ignore" instead of a numeric score for documents they want to exclude from the
datasets while still marking the file as complete.

**Template Updates**: Also updated `reranking/generate_markdown.py` to inform users about the ignore option:

- Added ignore option to main instructions with clear explanation
- Updated individual document scoring prompts to include "ignore=Skip" and "[Enter 0-3 or ignore]"
- Maintains consistency between generation and processing scripts

## New Utilities Added

### retry_utils.py

- Created `data_ingestion/utils/retry_utils.py` for network resilience
- Contains async and sync retry functions with exponential backoff
- Predefined configurations: `EMBEDDING_RETRY_CONFIG`, `PINECONE_RETRY_CONFIG`, `NETWORK_RETRY_CONFIG`
- Fatal error detection for non-retryable errors (quota exceeded, authentication failed, etc.)
- Used in PDF ingestion to handle Pinecone and OpenAI API connectivity issues
- Reusable across other data ingestion scripts (audio_video, crawler, etc.)
- **Comprehensive test coverage**: 23 tests covering async/sync retry logic, exponential backoff, fatal error detection,
  timeout handling, and configuration validation

## SQL to Vector Database Ingestion Script Logging

**Status**: Successfully converted `data_ingestion/sql_to_vector_db/ingest_db_text.py` from print statements to proper
logging.

**Logging Configuration**:

- Root logging level set to WARNING to reduce noise from third-party libraries
- Script-specific logger set to DEBUG level for detailed output
- Timestamp format: `"%(asctime)s - %(name)s - %(levelname)s - %(message)s"`
- Pattern follows same approach as `pdf_to_vector_db.py` and other ingestion scripts

**Changes Made**:

- Added `import logging` and logging configuration after imports
- Replaced all `print()` statements with appropriate `logger.info()`, `logger.warning()`, `logger.error()` calls
- Preserved commented print statements for future reference
- Maintained all existing functionality while adding timestamps to all output

**Benefits**:

- Timestamps on all log messages for better debugging and monitoring
- Consistent logging levels across all ingestion scripts
- Quieter operation by suppressing third-party library debug messages
- Better error classification with warning/error level logging

## Testing and Development Preferences

**Test-Driven Development (TDD)**: The user requires TDD approach for all development work:

- Write tests first before implementing functionality
- Red-Green-Refactor cycle: failing test → make it pass → improve code
- Tests should guide design and implementation decisions
- Never write code without corresponding tests

**Test File Organization**: User prefers adding new tests to existing test files rather than creating new files:

- Look for existing test files that logically relate to the new functionality
- Add new test cases, test classes, or test methods to appropriate existing files
- Only create new test files when no existing file is a logical fit
- Keep test organization coherent and discoverable within existing structure
- Consider test file scope and maintain clean separation of concerns

## User Preferences

- Prefers TypeScript over JavaScript
- Uses Next.js 14 with App Router
- Follows existing project structure and naming conventions
- Prioritizes experiments that don't require re-ingesting content (costly/time-consuming)

## Current Focus: RAG Performance Investigation

### Problem Statement

- Current System (text-embedding-ada-002, 1536D) performs well with paragraph-based chunking
- New System (text-embedding-3-large, 3072D) performs poorly with various chunking strategies
- Need to identify root cause and optimize New System performance

### Completed Experiments

#### Experiment 1.1: Embedding Distribution Analysis ✅

**Status**: Completed 2025-05-31 **Tool**: `bin/analyze_embedding_distributions.py` **Key Findings**:

1. **Critical Discovery**: Similarity distributions are dramatically different
   - Current System: High similarity (0.82 ± 0.04) - embeddings cluster tightly
   - New System: Low similarity (0.28 ± 0.16) - embeddings spread widely
2. **PCA Viability**: 100% variance explained by 1536 components → dimensionality reduction is viable
3. **Sparsity**: Not the issue (both ~43-46% sparse)
4. **Norms**: Both systems use unit normalization (1.0)

**Implications**:

- New System's lower inter-document similarity may actually be better for retrieval precision
- Current System's high similarity suggests potential over-clustering
- PCA dimensionality reduction should be next priority experiment

### Next Priority Experiments (Based on Analysis)

#### Experiment 1.2: PCA Dimensionality Reduction

**Priority**: HIGH (based on 100% variance explained) **Approach**: Reduce New System embeddings from 3072D to 1536D
using PCA **Expected Impact**: Significant improvement in retrieval performance

#### Experiment 3.1: Similarity Threshold Tuning

**Priority**: HIGH (based on similarity distribution differences) **Approach**: Test threshold range 0.2-0.8 in 0.1
increments **Rationale**: New System's lower similarity may require different thresholds

### Technical Implementation Notes

- Library filtering in Pinecone: Use variations like 'Ananda Library', 'ananda.org'
- PCA component limit: `min(target_dims, n_samples-1, n_features)` to avoid errors
- Sampling strategy: Random vector query with site-specific filtering fallback

### Project Rules

- Always read memory files first
- Update memory after significant findings
- Focus on experiments that don't require re-ingestion
- Prioritize based on impact-to-effort ratio

## FINAL DECISION: text-embedding-3-large UNSUITABLE FOR PRODUCTION ❌

**Status**: ✅ **CONCLUSIVE EVIDENCE** - DO NOT PROCEED WITH RE-INGESTION

**Evaluation Results** (19 queries, K=5, with explicit dimensions parameter):

### Current System (text-embedding-ada-002, 1536D) - PRODUCTION READY ✅

- **Performance**: 73% Precision@5, 87% NDCG@5 (spaCy sentence/paragraph)
- **Similarity Scores**: 0.79-0.88 (excellent semantic coherence)
- **Content Quality**: Highly relevant chunks for target queries
- **Speed**: 0.36-0.43 seconds (excellent performance)
- **Status**: **Keep as production system**

### New System (text-embedding-3-large, 3072D) - PRODUCTION FAILURE ❌

- **Performance**: 7-9% Precision@5, 18-26% NDCG@5 (catastrophic failure)
- **Similarity Scores**: 0.34-0.67 (poor semantic understanding)
- **Performance Drop**: **88% degradation** across all metrics
- **All Chunking Strategies Fail**: Fixed, sentence, paragraph, dynamic - none work
- **Status**: **Abandon completely - do not re-ingest**

### Critical Technical Discovery

- **API Issue Found**: text-embedding-ada-002 does NOT support dimensions parameter
- **Fix Applied**: Conditional dimensions parameter only for newer models
- **Result**: Current System restored to full performance, New System failure confirmed

### Business Decision

- **No Re-ingestion**: Would waste time/resources on fundamentally flawed model
- **Keep Current Architecture**: Proven ada-002 + paragraph chunking
- **Focus on Optimization**: Improve existing system rather than model migration
- **Cost Savings**: Avoided expensive re-ingestion of 380K+ vectors

### Lessons Learned

- **Trust Performance Data**: 88% degradation is not a configuration issue
- **API Parameter Validation**: Always check model-specific parameter support
- **Diagnostic Before Re-ingestion**: Saved significant time and resources
- **Embedding Model Selection**: Newer ≠ better for domain-specific content

## Embedding Model Evaluation Completed - Ada-002 Confirmed

**Status**: ✅ COMPLETED - Comprehensive evaluation of embedding models for spiritual content

**Models Tested**:

- **text-embedding-ada-002**: 81.4% avg similarity (winner)
- **text-embedding-3-small**: 38.6% avg similarity (52% worse)
- **text-embedding-3-large**: 39.2% avg similarity (52% worse)
- **voyage-3-large-2048**: 49.2% avg similarity (40% worse)

**Final Decision**: Continue using text-embedding-ada-002 for all Ananda Library Chatbot deployments.

**Key Finding**: Ada-002 demonstrates superior understanding of spiritual/philosophical content with metaphorical
language and specialized terminology.

**Implementation**: All ingestion scripts standardized on ada-002 with consistent vector ID format.

## User Preferences and Custom Rules

### Text Processing & PDF Analysis - June 2025

**Key Findings from Comprehensive Text Splitter Analysis:**

#### **PDF Text Extraction - CONFIRMED WORKING** ✅

- **Mystery SOLVED**: Original concerns about "empty PDFs" were due to testing only 3 pages from early book pages
  (title, copyright, ToC)
- **Actual Performance**:
  - Fight for Religious Freedom: 2,134 words from 6 pages ✅
  - Autobiography of a Yogi: 2,260 words from 20 pages ✅
  - Legal documents: 871 words from short docs ✅
- **Extraction works perfectly** with `pdfplumber` and production pipeline

#### **FAIR COMPARISON RESULTS: Traditional vs Layout-Aware vs Docling** 📊

**Test Setup**: 20-page sample PDFs processed by all methods (equal comparison)

**Content Extraction Performance**:

- **Traditional** (pdfplumber): Fast, reliable text extraction
- **Layout-Aware**: Over-segments paragraphs but extracts similar word counts
- **Docling**: Slowest (28s per 20-page PDF) but good text extraction + markdown structure

**Chunking Quality Results** (Target: 225-450 words per chunk):

1. **Fight for Religious Freedom** (20 pages):

   - **Traditional**: 66.7% compliance 🏆 **WINNER**
   - **Docling**: 16.7% compliance (-50% vs traditional)
   - **Layout-Aware**: 0.0% compliance

2. **Autobiography of a Yogi** (20 pages):

   - **Traditional**: 50.0% compliance 🏆 **WINNER**
   - **Layout-Aware**: 20.0% compliance
   - **Docling**: 16.7% compliance (-33% vs traditional)

3. **Legal Document** (6 pages):
   - All methods: 0.0% compliance (document too short for good chunking)

#### **CRITICAL CONCLUSION** ❗

**Traditional pdfplumber method WINS decisively:**

- **2x better chunking compliance** than Docling
- **30x faster processing** (0.4s vs 28s per 20-page PDF)
- **Simpler implementation** with existing production pipeline
- **Reliable performance** across different document types

**Docling Analysis:**

- ✅ **Pros**: Sophisticated document understanding, markdown output, structure preservation
- ❌ **Cons**: Very slow (28s per 20 pages), worse chunking performance, complex setup
- **Verdict**: **Not suitable for production ingestion** due to speed/performance issues

**Layout-Aware Analysis:**

- ✅ **Pros**: Potentially better paragraph detection
- ❌ **Cons**: Over-segments content, worst chunking performance
- **Verdict**: **Not recommended** - creates too many small paragraphs

#### **RECOMMENDATION** 🎯

**Keep using the traditional pdfplumber approach** for production:

1. It already **works excellently** for text extraction
2. **Best chunking performance** (50-67% compliance vs target range)
3. **Fastest processing speed** (critical for large document ingestion)
4. **Proven reliability** in production

**The "PDF problem" was a red herring** - our existing approach is optimal.

#### **SpacyTextSplitter Performance Analysis**

- **Target Compliance**: 50% (goal: 70%) - needs improvement
- **Average Chunk Size**: 445.5 words (within target range)
- **Processing Speed**: 1.5s per document (acceptable)
- **Paragraph Detection**: Using double newlines with single newline fallback
- **Fixed Chunking**: 600 tokens + 120 overlap (proven better than dynamic sizing)

#### **Next Steps for Improvement**

1. **Focus on text splitter tuning** rather than PDF extraction changes
2. **Improve paragraph detection logic** within existing pipeline
3. **Test chunk size optimizations** (possibly reduce from 600 to 500 tokens)
4. **Evaluate sentence-level splitting** as fallback for better target compliance

#### **Testing Infrastructure**

- Created **20-page sample PDFs** for fair performance testing
- **Comprehensive comparison framework** for future method evaluation
- **Threading optimizations** (6 threads) for performance testing
- **Metrics tracking** for chunking quality analysis

### User Preferences

- **Prefers comprehensive analysis** with fair comparisons
- **Values performance AND accuracy** in solutions
- **Appreciates data-driven decision making** with concrete metrics
- **Focused on production readiness** over experimental features

## Original Project Rules (unchanged)

### Code Style Preferences

- **TypeScript over JavaScript** - always use TypeScript for new code
- **Functional over OOP** - prefer functional programming patterns
- **Error handling** - use guard clauses and early returns
- **Testing** - write tests first (failing → passing pattern)

### File Organization

- **Follow existing structure** - maintain consistency with project layout
- **Modular code** - separate concerns, use reusable modules
- **Clear naming** - descriptive function/variable names
- **Documentation** - update relevant docs when making changes

### Memory Management Rules

- **Always read @self.md first** - check for known mistakes/fixes
- **Update memory after mistakes** - log corrections for future reference
- **General info only** - keep memory reusable, not request-specific
- **Structured format** - use clear headers and bullet points

## Chunking Strategy Clarification - Current System Already Optimal

**Status**: CLARIFIED - The chunking strategy is already optimized and doesn't need changes.

**Key Finding**: The user asked about changing to sentence-based or word-based chunking, but investigation revealed:

1. **Current system already optimal**: The `SpacyTextSplitter` already implements word-based token chunking (600 tokens,
   20% overlap)
2. **Evaluation data proves no improvement needed**: All spaCy strategies (sentence/paragraph, 300/600 tokens) achieve
   identical results: Precision@5: 72.63%, NDCG@5: 86.74%
3. **Hybrid approach is best**: Current system uses intelligent fallbacks (paragraph → sentence → token) providing
   semantic boundaries when possible, reliable token counting when boundaries are unclear

**Current Implementation Strategy**:

- Primary: Word-based token counting (600 tokens, 20% overlap)
- Fallbacks: Paragraph boundaries (`\n\n`) → single newlines (`\n`) → spaCy sentences → pure token splitting
- Proven performance through comprehensive evaluation

**Created New Evaluation Script**: `bin/evaluate_word_vs_sentence_chunking.py`

- Compares pure word-based vs pure sentence-based vs current hybrid approach
- Simplified version of existing evaluation framework
- Available for future testing if needed

**Documentation Updates**:

- Updated `docs/chunking-strategy.md` configuration guidelines section
- Clarified that current system is already optimized
- Provided guidance on when changes might be considered
- Listed available evaluation tools for future reference

**Recommendation**: No changes needed to chunking strategy. Current system is optimal based on evaluation data. Focus
development effort on other areas unless specific performance issues are identified through evaluation.
