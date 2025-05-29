# Project.md

## Current project

See @crawler-TODO.md

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
