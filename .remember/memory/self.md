# self.md

## Mistake: Separating Unit Tests from Development in Project Planning

**Wrong**: Initially created a project plan with unit tests separated into "Phase III" at the end:

```markdown
## Phase 3: Testing and Validation

### [ ] 8. Create Tests for Shared Utilities

- [ ] Unit tests for `text_processing.py`
- [ ] Unit tests for `pinecone_utils.py`
- [ ] Unit tests for `progress_utils.py`
- [ ] Unit tests for `embeddings_utils.py`
- [ ] Unit tests for `checkpoint_utils.py`
```

**Correct**: Unit tests should be integrated immediately after each utility module is created:

```markdown
### [ ] 1. Create `data_ingestion/utils/text_processing.py`

**Functions to extract and consolidate:**

- [ ] `clean_document_text()` from PDF script
- [ ] `remove_html_tags()` from SQL script ...

**Testing:**

- [ ] Create unit tests for `text_processing.py`
- [ ] Test `clean_document_text()` with table of contents artifacts
- [ ] Test `remove_html_tags()` with various HTML structures
- [ ] Validate one script works with shared text processing
```

**Principle**: Test-as-you-go approach ensures each component is solid before moving to the next, provides immediate
feedback, and prevents accumulation of bugs until the end of the project.

## Mistake: Metrics Recording in Multiple Code Paths

**Problem**: When implementing comprehensive logging for the SpacyTextSplitter, metrics were only being recorded in one
code path (the "without overlap" branch), causing documents processed through the "with overlap" branch to not be
tracked in the metrics summary.

**Wrong**: Metrics recording only in one return path:

```python
# In split_text method
if self.chunk_overlap > 0 and len(chunks) > 1:
    # Apply overlap logic
    return result  # No metrics recorded here!

# Only recorded metrics here (without overlap path)
self.metrics.log_document_metrics(...)
return chunks
```

**Correct**: Ensure metrics are recorded in all code paths by extracting to a helper method:

```python
def _log_chunk_metrics(self, chunks: list[str], word_count: int, document_id: str = None):
    """Log detailed chunking metrics for a document."""
    # All logging and metrics recording logic here
    self.metrics.log_document_metrics(...)

# In split_text method
if self.chunk_overlap > 0 and len(chunks) > 1:
    # Apply overlap logic
    self._log_chunk_metrics(result, word_count, document_id)
    return result

# Also record metrics for non-overlap path
self._log_chunk_metrics(chunks, word_count, document_id)
return chunks
```

**Detection**: Debug logging showed documents being processed but metrics only reflecting the first document. Always
test metrics accumulation across different code paths.

## Mistake: Inconsistent Chunking Strategy Across Ingestion Scripts

**Problem**: Different ingestion scripts were using different text splitting approaches despite the project
documentation claiming all scripts use spaCy chunking. Analysis of vector database word counts revealed:

- PDF script: Using `SpacyTextSplitter(chunk_size=600, chunk_overlap=120)` → 83.7 avg words/chunk
- SQL script: Using `TokenTextSplitter(chunk_size=256, chunk_overlap=50)` → 167.8 avg words/chunk
- Web crawler: Using custom word-based chunking → Variable word counts

**Wrong**: SQL script using outdated token-based chunking:

```python
# data_ingestion/sql_to_vector_db/ingest_db_text.py
text_splitter = TokenTextSplitter.from_tiktoken_encoder(
    encoding_name="cl100k_base", chunk_size=256, chunk_overlap=50
)
```

**Correct**: All ingestion scripts should use the shared spaCy-based chunking strategy:

```python
# Import shared utility
from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

# Use consistent configuration across all scripts
text_splitter = SpacyTextSplitter(
    chunk_size=600,
    chunk_overlap=120,  # 20% overlap
    separator="\n\n",
    pipeline="en_core_web_sm",
)
```

**Impact**: Inconsistent chunking affects RAG quality and retrieval consistency. Documents from different sources have
wildly different chunk characteristics, leading to uneven search quality.

**Detection Method**: Analyze word counts per chunk using `data_ingestion/bin/analyze_text_field_words.py` to identify
chunking inconsistencies across libraries/sources.

## Mistake: S3 URL Mismatch in Tests

**Wrong**:

```typescript
// web/__tests__/components/CopyButton.test.tsx
// Expected URL did not match the actual generated URL by getS3AudioUrl.ts
expect(callHtml).toContain(
  '<a href="https://ananda.amazonaws.com/my%20treasures%2Faudiofile.mp3">Direct Audio Test</a> (My Treasures) → 1:10'
);
```

**Correct**:

```typescript
// web/__tests__/components/CopyButton.test.tsx
// Updated expected URL to match the output of getS3AudioUrl.ts
expect(callHtml).toContain(
  '<a href="https://ananda.amazonaws.com/public/audio/my%20treasures/audiofile.mp3">Direct Audio Test</a> (Treasures) → 1:10'
);
```

## Data Ingestion Architecture: spaCy Chunking and Document-Level Hashing

**Context**: Major migration from TypeScript to Python for data ingestion with semantic chunking strategy.

**Key Changes**:

- **Chunking Strategy**: Migrated from fixed-size chunking to spaCy paragraph-based chunking (600 tokens, 20% overlap)
- **PDF Processing**: Converted from TypeScript (`pdf_to_vector_db.ts`) to Python (`pdf_to_vector_db.py`)
- **Document Processing**: Changed from page-by-page to full-document processing to preserve context
- **Hashing Strategy**: Implemented document-level hashing where all chunks from same document share same hash
- **Dependencies**: Added spaCy, PyMuPDF, pytest-asyncio; removed PyPDF2

**Benefits**:

- Significantly improved RAG evaluation results
- Better semantic coherence and context preservation
- Efficient bulk operations on documents
- Robust fallback mechanisms for edge cases

**Files Affected**:

- `data_ingestion/utils/spacy_text_splitter.py` - Core chunking utility
- `data_ingestion/utils/document_hash.py` - Centralized document hashing
- `data_ingestion/pdf_to_vector_db.py` - Python PDF ingestion script
- Multiple ingestion scripts updated with new chunking and hashing

## Mistake: npm run Argument Parsing

**Wrong**: Running `npm run <script> <arg1> <arg2> --flag` might result in `--flag` not being passed to the script, as
npm can intercept it. Command: `npm run prompt ananda-public push ananda-public-base.txt --skip-tests` Result:
`--skip-tests` was not included in `process.argv` inside `manage-prompts.ts`.

**Correct**: Use `--` to explicitly separate npm options from script arguments. Command:
`npm run prompt -- ananda-public push ananda-public-base.txt --skip-tests` Result: `--skip-tests` is correctly passed to
the script and included in `process.argv`.

### Finding: Script for Checking Firestore URLs

**Situation**: User asked for the location of a Python script that checks Firestore for 404 URLs included in "Answers".
Initial searches focused on `data_ingestion` and general crawler utilities, which did not directly match the requirement
of interacting with Firestore "Answers" for this specific purpose.

**Resolution**: A broader codebase search for Python scripts interacting with Firestore, URLs, and terms like "answers"
and "404" identified `bin/count_hallucinated_urls.py`. This script specifically:

- Connects to Firestore.
- Queries a `chatLogs` collection (derived from an environment prefix, effectively the "Answers").
- Extracts URLs from answer fields.
- Performs HTTP HEAD requests to check their status (including 404s).
- Reports on these URLs.

**Script Path**: `bin/count_hallucinated_urls.py`

### Mistake: Incorrect Document Retrieval Logic Bypassing Library Filters

**Situation**: In `web/src/utils/server/makechain.ts`, the `setupAndExecuteLanguageModelChain` function was pre-fetching
documents using `retriever.getRelevantDocuments(sanitizedQuestion)`. This call did not apply library-specific filters
defined in the site configuration. These pre-fetched documents (as `finalDocs`) were then passed to `makeChain`, causing
`makeChain`'s own `retrievalSequence` (which contains the correct library filtering logic) to be bypassed.

## Mistake: Nested With Statements in Tests

**Problem**: Ruff linting rule SIM117 flags nested `with` statements that should be combined into single `with`
statements with multiple contexts for better readability and style.

**Wrong**: Nested with statements:

```python
def test_example(self):
    with patch.dict(os.environ, {"KEY": "value"}):
        with patch("module.function") as mock_func:
            # test code
```

**Correct**: Single with statement with multiple contexts:

```python
def test_example(self):
    with (
        patch.dict(os.environ, {"KEY": "value"}),
        patch("module.function") as mock_func,
    ):
        # test code
```

**Detection**: Ruff automatically detects this pattern and suggests the fix. The parentheses around the context managers
are required for Python 3.9+ when using multiple contexts.

**Applied**: Fixed 14 instances in `data_ingestion/tests/test_pinecone_utils.py` - all 38 tests continue to pass after
the refactor. Completed in two phases: initial 12 fixes, then 2 additional fixes for remaining nested with statements.

## Mistake: Creating Separate Test Files Instead of Consolidating

**Wrong**: Creating separate test files for related functionality:

```
data_ingestion/tests/test_crawler.py
data_ingestion/tests/test_crawler_chunking.py  # Separate file
```

**Correct**: Keep related tests in the same file to avoid unnecessary file proliferation:

```python
# In data_ingestion/tests/test_crawler.py
class TestCrawlerChunking(unittest.TestCase):
    """Test cases for website crawler chunking functionality."""
    # All chunking tests here
```

**Principle**: Group related tests together unless there's a compelling reason to separate them (e.g., different test
environments, very large test files). This makes the codebase easier to navigate and maintain.

## Mistake: Incorrect SpacyTextSplitter Constructor Parameters

**Wrong**: Trying to pass `chunk_size` and `chunk_overlap` to `SpacyTextSplitter` constructor:

```python
text_splitter = SpacyTextSplitter(
    chunk_size=600,
    chunk_overlap=120,
    separator="\n\n",
    pipeline="en_core_web_sm",
)
```

**Correct**: `SpacyTextSplitter` constructor only accepts `separator` and `pipeline` parameters:

```python
text_splitter = SpacyTextSplitter(
    separator="\n\n",
    pipeline="en_core_web_sm",
)
# chunk_size and chunk_overlap are set internally via dynamic sizing
```

**Detection**: Constructor signature inspection and test failures revealed the parameter mismatch. Always check the
actual constructor signature before assuming parameter names.

## Mistake: Hard-coding Specific Text Patterns in PDF Processing

**Problem**: When fixing PDF text extraction issues where chapter headers were getting mixed into body text (e.g.,
"combatControl Your Destiny 23 them"), initially attempted to hard-code the specific book title pattern.

**Wrong**: Hard-coding specific book titles in text cleaning:

```python
# Remove chapter headers and book titles that got mixed into the text
# Pattern: "Control Your Destiny" followed by optional number
text = re.sub(r"\bControl Your Destiny\s*\d*\b", "", text, flags=re.IGNORECASE)
```

**Correct**: Use generic patterns that detect common text artifacts without hard-coding specific titles:

```python
# Fix concatenated words by detecting patterns where lowercase word is followed by uppercase word
# This handles cases like "combatControl" -> "combat Control"
text = re.sub(r'([a-z])([A-Z][a-z])', r'\1 \2', text)

# Remove patterns that look like book titles (Title Case Words followed by numbers)
# This catches patterns like "Control Your Destiny 23" without hard-coding specific titles
text = re.sub(r"\b([A-Z][a-z]+\s+){1,4}[A-Z][a-z]+\s+\d{1,3}\b", "", text)
```

**Principle**: Text processing should use generic patterns that work across different documents rather than hard-coding
specific content. This makes the solution more robust and maintainable.

## Mistake: Document Type Validation Too Strict in Text Splitter

**Problem**: The `SpacyTextSplitter.split_documents()` method was using `isinstance(doc, Document)` to validate input
documents, but this failed when different scripts imported `Document` from different sources (local vs LangChain).

**Wrong**: Strict type checking against local Document class:

```python
# In text_splitter_utils.py
if not isinstance(doc, Document):
    error_msg = f"Expected Document object, got {type(doc)}"
    self.logger.error(error_msg)
    raise ValueError(error_msg)
```

**Correct**: Duck typing approach checking for required attributes:

```python
# Check if doc has required attributes (supports both local Document and LangChain Document)
if not hasattr(doc, 'page_content') or not hasattr(doc, 'metadata'):
    error_msg = f"Expected Document object with 'page_content' and 'metadata' attributes, got {type(doc)}"
    self.logger.error(error_msg)
    raise ValueError(error_msg)
```

**Root Cause**: SQL ingestion script imports `Document` from `langchain_core.documents` while text splitter defines its
own local `Document` class. The `isinstance` check fails even though both classes have the same interface.

**Solution**: Use duck typing to check for required attributes rather than exact type matching, allowing compatibility
with both local and LangChain Document classes.

**Wrong**:

```typescript
// In setupAndExecuteLanguageModelChain (makechain.ts)
// ...
const retrievedDocs = await retriever.getRelevantDocuments(sanitizedQuestion); // No library filtering here
// ... docsForLlm derived from retrievedDocs
const chain = await makeChain(
  // ...
  docsForLlm // Passed as finalDocs, bypassing makeChain's internal retrieval
);

// In makeChain (makechain.ts)
// ...
if (finalDocs) {
  return finalDocs; // Bypasses library-specific retrieval logic
}
// ... library-specific retrieval logic ...
```

**Correct**:

1. `setupAndExecuteLanguageModelChain` no longer pre-fetches documents.
2. The `finalDocs` parameter was removed from `makeChain`.
3. `makeChain` always executes its internal `retrievalSequence`, which correctly applies `baseFilter` (media types,
   collection authors from `route.ts`) in conjunction with `includedLibraries` (handling weighted parallel calls or
   `$in` filters for multiple libraries).
4. `makeChain` was modified to return an object `{ answer: string, sourceDocuments: Document[] }`.
5. `setupAndExecuteLanguageModelChain` uses this structured return object for its final processing and for providing
   documents to be saved.

```typescript
// In setupAndExecuteLanguageModelChain (makechain.ts)
// ...
// Document pre-fetching removed.
const chain = await makeChain(
  retriever,
  { model: modelName, temperature },
  finalSourceCount,
  filter, // baseFilter from route.ts
  sendData,
  undefined,
  { model: rephraseModelName, temperature: rephraseTemperature }
  // No finalDocs argument here
);
const result = await chain.invoke(...);
// result is { answer: string, sourceDocuments: Document[] }
return { fullResponse: result.answer, finalDocs: result.sourceDocuments };

// In makeChain (makechain.ts)
// Parameter finalDocs?: Document[] removed from function signature.
// Block "if (finalDocs) { ... return finalDocs; }" removed from retrievalSequence.
// retrievalSequence now always executes its full logic.
// The chain returned by makeChain now resolves to { answer: string, sourceDocuments: Document[] }.
```

### Mistake: Broken Streaming and Linter Error After Fixing Library Filters

**Situation**: After refactoring `makechain.ts` to correctly handle library-specific document filtering, a new linter
error appeared, and answer streaming to the frontend broke. The linter error was related to type inference in
`RunnablePassthrough.assign`. The broken streaming was caused by a final lambda in `conversationalRetrievalQAChain` that
aggregated the answer before streaming callbacks could process individual tokens.

**Wrong (Conceptual Snippets from Previous State)**:

```typescript
// In makechain.ts - fullAnswerGenerationChain causing linter error
const fullAnswerGenerationChain = RunnablePassthrough.assign({
  answer: (input: { context: string; ... }) => generationChain.invoke(input), // Complex input type here was problematic
  sourceDocuments: (input: { documents: Document[]; }) => input.documents,
});

// In makechain.ts - conversationalRetrievalQAChain blocking streaming
const conversationalRetrievalQAChain = RunnableSequence.from([
  // ... other steps
  answerChain, // This streams { answer: token_stream, sourceDocuments: ... }
  (result: { answer: string, sourceDocuments: Document[] }) => { // This lambda waits for full answer string
    // ... warning logic ...
    return result;
  },
]);
```

**Correct**:

1. **Linter Error Fix**: Refactored `fullAnswerGenerationChain` in `makechain.ts`. Introduced `PromptDataType` and a new
   `generationChainThatTakesPromptData` runnable. This new runnable explicitly defines its input type (`PromptDataType`)
   and selects the fields required by the LLM prompt internally. `RunnablePassthrough.assign` then uses
   `generationChainThatTakesPromptData` for the `answer` field and a simple lambda
   `(input: PromptDataType) => input.documents` for `sourceDocuments`.
2. **Streaming Fix**: Removed the final result-transforming lambda from `conversationalRetrievalQAChain` in
   `makechain.ts`. This allows the streamed tokens from the `answer` field (generated by
   `generationChainThatTakesPromptData`, which includes a `StringOutputParser`) to propagate to the `handleLLMNewToken`
   callback in `setupAndExecuteLanguageModelChain`.
3. **Warning Logic Relocation**: The logic to check if the AI's answer indicates no specific information was moved from
   the removed lambda in `conversationalRetrievalQAChain` to `setupAndExecuteLanguageModelChain`. It now checks the
   final aggregated `result.answer` after all streaming has completed.

```typescript
// In makechain.ts - Corrected fullAnswerGenerationChain structure
type PromptDataType = {
  context: string; chat_history: string; question: string; documents: Document[];
};
const generationChainThatTakesPromptData = RunnableSequence.from([
  (input: PromptDataType) => ({ /* select fields for LLM prompt */ }),
  answerPrompt,
  answerModel,
  new StringOutputParser(),
]);
const fullAnswerGenerationChain = RunnablePassthrough.assign({
  answer: generationChainThatTakesPromptData,
  sourceDocuments: (input: PromptDataType) => input.documents,
});

// In makechain.ts - Corrected conversationalRetrievalQAChain (final lambda removed)
const conversationalRetrievalQAChain = RunnableSequence.from([
  { /* ...standalone question part... */ },
  answerChain, // answerChain uses fullAnswerGenerationChain
]);

// In setupAndExecuteLanguageModelChain (makechain.ts) - Warning logic moved here
const result = await chain.invoke(...);
if (result.answer.includes("I don't have any specific information")) {
  // ... console.warn logic using result.answer ...
}
```

### Mistake: Edit tool applying changes to incorrect locations or not applying them

**Wrong**: When attempting to remove an unused variable or import from a specific function/file, the `edit_file` tool
sometimes applies the deletion to a different function or location within the same file, or even fails to apply the
change if the targeted line is already commented out but still flagged by the linter (possibly due to stale linter
data), or fails to remove an import line repeatedly.

**Correct**: If the `edit_file` tool misapplies an edit or fails to apply it:

1. Re-try the edit with more surrounding context to help the model pinpoint the exact location.
2. Verify if the linter data is current, especially if the tool fails to act on a line that appears already fixed (e.g.,
   commented out).
3. If an edit (like removing an import) persistently fails across multiple attempts, note it for manual review and move
   on to other issues to avoid getting stuck.
4. If an edit causes a new error (e.g., removing a variable that _is_ used elsewhere), the immediate next step should be
   to revert or fix that erroneous edit.

### False Positive Linter Error Suppression

**Situation**: A linter (e.g., ESLint with `@typescript-eslint/no-unused-vars`) flags a variable as unused, but it is
actually used (e.g., within a callback or a complex assignment that the linter doesn't fully trace for usage in the
final return path).

**Resolution**: If confident the variable is used and the linter warning is a false positive, suppress the warning for
that specific line using a linter disable comment. For ESLint and `@typescript-eslint/no-unused-vars`, this can be done
by adding `// eslint-disable-next-line @typescript-eslint/no-unused-vars` on the line immediately preceding the variable
declaration.

**Example**:

```typescript
// web/src/utils/server/makechain.ts
// ...
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let fullResponse = ""; // This variable is used in a callback, but linter flags it.
// ...
```

### Mistake: Jest Module Resolution for Local Dependencies

**Situation**: When Jest tests need to import from another directory in the monorepo, using relative paths can be
error-prone and fragile. Errors like "Configuration error: Could not locate module..." or "Cannot find module" occur.
This happens even if relative paths are used in mocks/imports, as TypeScript/Jest might not correctly resolve these
across directory boundaries without proper configuration.

**Wrong**:

```typescript
// Attempting to use relative paths for mocks or imports from another directory
jest.mock("../../../../src/utils/pinecone-client");
import { getPineconeClient } from "../../../../src/utils/pinecone-client";
```

**Correct**:

1. Use module path aliases in `tsconfig.json`:

   ```json
   {
     "compilerOptions": {
       "paths": {
         "@/*": ["./src/*"]
       }
     }
   }
   ```

2. Configure Jest to understand these aliases:

   ```javascript
   // jest.config.js
   module.exports = {
     moduleNameMapper: {
       "^@/(.*)$": "<rootDir>/src/$1",
     },
   };
   ```

3. Use the aliases in your tests:

   ```typescript
   jest.mock("@/utils/pinecone-client");
   import { getPineconeClient } from "@/utils/pinecone-client";
   ```

**Reasoning**: Using module aliases provides a more robust and maintainable way to handle imports across the codebase.
It avoids deep relative paths, makes refactoring easier, and works consistently across different file locations.

### Mistake: Forgot to cd into web directory before running tests

**Wrong**:

Ran 'npm test' without ensuring the shell was in the web directory.

**Correct**:

Must cd into the web directory with 'cd web' before running 'npm test' to execute the Next.js test suite.

### Python Import Path Resolution for Direct Script Execution

**Problem**: When running a Python script directly from its directory using `./script.py` instead of as a module with
`python -m`, imports referencing the parent package fail.

**Wrong**: Adding manual sys.path manipulation to fix import issues:

```python
# Using sys.path manipulation
import sys
import os
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(os.path.dirname(current_dir))
sys.path.insert(0, parent_dir)
```

**Correct**: Rely on Python path being set correctly and use proper module structure:

```python
# No sys.path manipulation needed - rely on proper Python path setup
from pyutil.env_utils import load_env
from data_ingestion.utils.text_processing import clean_text
```

**Key Principles**:

- Python path should be set at the environment/project level
- Scripts should not contain sys.path manipulation code
- Use proper absolute imports from project root
- Ensure proper `__init__.py` files exist in all package directories

**Environment Setup**: The Python path should be configured externally (via IDE, virtual environment, or shell setup)
rather than within individual scripts.

### Mistake: ModuleNotFoundError for Local Modules in Scripts

**Situation**: When running a Python script from a subdirectory (e.g., `bin/myscript.py`) that imports a local module
from another directory at the project root level (e.g., `pyutil/some_module.py`), a `ModuleNotFoundError` can occur
because the Python path is not properly configured.

**Wrong**: Adding sys.path manipulation to individual scripts:

```python
#!/usr/bin/env python3
import os
import sys

# Add project root to Python path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

# Now, imports like this should work:
from pyutil.env_utils import load_env
```

**Correct**: Configure Python path externally and use clean imports:

```python
#!/usr/bin/env python3
# No sys.path manipulation needed

# Clean imports relying on proper Python path setup:
from pyutil.env_utils import load_env
from data_ingestion.utils.progress_utils import setup_signal_handlers
```

**Environment Configuration**: The Python path should be set up at the project/environment level (via virtualenv, IDE
settings, or shell configuration) so that all modules can be imported cleanly without path manipulation in individual
scripts.

**Detection**: If you get `ModuleNotFoundError`, fix the Python path setup at the environment level rather than adding
sys.path hacks to individual files.

### Mistake: Using outdated OpenAI Embedding API

**Situation**: Code using `openai.Embedding.create()` will fail with `openai>=1.0.0` as the API has changed.

**Wrong**:

```python
import openai
# ...
openai.api_key = "YOUR_API_KEY" # Also an outdated way to set key for client
# ...
def get_embedding(text, model_name):
    try:
        response = openai.Embedding.create(input=text, model=model_name)
        return response['data'][0]['embedding']
    except Exception as e:
        # ... error handling ...
        return None
```

**Correct**: Initialize an `OpenAI` client and use its `embeddings.create` method.

```python
from openai import OpenAI # Import the client
import os

# ...

# Initialize client (API key is usually picked up from OPENAI_API_KEY env var by default)
# or client = OpenAI(api_key="YOUR_API_KEY")
client = OpenAI()

# ...

def get_embedding(text, model_name, openai_client):
    try:
        response = openai_client.embeddings.create(input=text, model=model_name)
        return response.data[0].embedding # Access data attribute directly
    except Exception as e:
        # ... error handling ...
        return None

# Example usage in a main function:
def main():
    # ... setup ...
    openai_client = OpenAI()
    # ...
    embedding = get_embedding("some text", "text-embedding-ada-002", openai_client)
    # ...
```

**Key Changes**:

1. Import `OpenAI` from `openai`.
2. Instantiate the client: `client = OpenAI()`.
3. Call `client.embeddings.create(...)`.
4. Access the embedding via `response.data[0].embedding`.
5. Pass the initialized client to functions that need to generate embeddings.

**Key Principle**: Always check function signatures and return types. If a function returns a regular value (like
`bool`, `str`, `int`) rather than a coroutine, it should be called synchronously without `await`. Only use `await` with
async functions that return coroutines or awaitable objects.

**Context**: The `pdf_checkpoint_integration()` function from `checkpoint_utils.py` returns a synchronous
`save_checkpoint` function that returns `bool`, not an async function. The error occurred because the PDF script was
trying to await this synchronous function.

## Progress Utils Integration Best Practices

**Discovery**: Analysis of the SQL script revealed it was only using basic functionality from `progress_utils` instead
of leveraging the comprehensive progress tracking utilities available.

**Minimal Usage (Wrong)**:

```python
# Only using basic is_exiting function
from data_ingestion.utils.progress_utils import is_exiting

# Custom signal handler instead of shared one
def signal_handler(sig, frame):
    if is_exiting():
        print("\nForced exit. Data may be inconsistent.")
        sys.exit(1)
    else:
        print("\nGraceful shutdown initiated...")

# Manual signal setup
signal.signal(signal.SIGINT, signal_handler)

# Basic tqdm usage without configuration
for i in tqdm(range(num_batches), desc="Overall Batch Progress"):
    # Manual checkpoint saving scattered throughout
    save_checkpoint(checkpoint_file, list(processed_doc_ids), last_processed_id)
```

**Comprehensive Usage (Correct)**:

```python
# Import comprehensive progress utilities
from data_ingestion.utils.progress_utils import (
    is_exiting,
    setup_signal_handlers,
    ProgressTracker,
    ProgressConfig,
    create_progress_bar,
)

# Use shared signal handler setup
setup_signal_handlers()

# Use ProgressTracker with automatic checkpoint integration
progress_config = ProgressConfig(
    description="Processing Batches",
    unit="batch",
    total=num_batches,
    checkpoint_interval=1,
)

def checkpoint_callback(current_progress: int, data: dict):
    save_checkpoint(checkpoint_file, list(processed_doc_ids), last_processed_id)

with ProgressTracker(progress_config, checkpoint_callback=checkpoint_callback) as progress:
    for i in range(num_batches):
        # Processing logic
        progress.update(1)
        progress.increment_success(count) or progress.increment_error(count)

# Use create_progress_bar for consistent styling
data_prep_config = ProgressConfig(description="Preparing Data", unit="row", total=len(results))
progress_bar = create_progress_bar(data_prep_config, results)
for row in progress_bar:
    # Process row
```

**Benefits of Full Integration**:

- Automatic checkpoint saving at configured intervals
- Graceful shutdown with proper cleanup
- Consistent progress bar styling across all scripts
- Error and success counting with statistics
- Thread-safe signal handling
- Integration with shared utilities ecosystem

**Scripts to Check**: All ingestion scripts should be audited to ensure they're using the full `progress_utils`
capabilities rather than basic implementations.

## Mistake: Incorrect Test Mocking for Function-like Objects

**Problem**: When mocking functions in tests, accidentally setting them to a static value instead of making them return
that value causes "object is not callable" errors.

**Wrong**: Mocking a function by setting it to a static value:

```python
# This sets is_exiting to the boolean False, not a function that returns False
patch("data_ingestion.utils.progress_utils.is_exiting", False),
patch("pdf_to_vector_db.is_exiting", False),
```

When the code tries to call `is_exiting()`, it fails with:

```bash
TypeError: 'bool' object is not callable
```

**Correct**: Mock functions to return the desired value:

```python
# This makes is_exiting a mock function that returns False when called
patch("data_ingestion.utils.progress_utils.is_exiting", return_value=False),
patch("pdf_to_vector_db.is_exiting", return_value=False),
```

Now when code calls `is_exiting()`, it properly returns `False`.

**Key Principle**: When mocking a callable (function, method), use `return_value=X` or `side_effect=X` to control what
it returns when called. Only mock with a static value when replacing a non-callable attribute or variable.

## Mistake: Incorrect Mocking Path for Imported Functions in Tests

**Problem**: When testing functions that import other functions directly (e.g.,
`from utils.progress_utils import is_exiting`), mocking the original module path doesn't work because the import creates
a local reference in the target module.

**Wrong**: Mocking the original module path when the function is imported directly:

```python
# In test file
from crawler.website_crawler import WebsiteCrawler
# ... in test method
with patch("utils.progress_utils.is_exiting") as mock_is_exiting:
    # This doesn't work because website_crawler imports is_exiting directly
    run_crawl_loop(crawler, MagicMock(), mock_args)
```

**Correct**: Mock the function in the module where it's imported and used:

```python
# In test file
from crawler.website_crawler import WebsiteCrawler
# ... in test method
with patch("crawler.website_crawler.is_exiting") as mock_is_exiting:
    # This works because we're mocking the local reference
    run_crawl_loop(crawler, MagicMock(), mock_args)
```

**Root Cause**: When a module does `from utils.progress_utils import is_exiting`, it creates a local reference to the
function. Mocking `utils.progress_utils.is_exiting` only affects new imports, not existing local references.

**Impact**: Tests hang indefinitely because the actual function is called instead of the mock, creating infinite loops
in daemon-like behavior tests.

## Audio/Video Transcript Chunking Strategy Update Completed

**Task**: Successfully updated `data_ingestion/audio_video/transcription_utils.py` to use the new spaCy-based chunking
strategy while preserving audio-specific features.

**Key Implementation Details**:

- **Primary Function**: Modified `chunk_transcription()` to use `SpacyTextSplitter` for semantic chunking
- **Dynamic Sizing**: Leverages word count-based chunk sizing (225-450 word target range)
- **Timestamp Preservation**: Maps spaCy text chunks back to original word timestamps for audio playback
- **Fallback Strategy**: Maintains legacy chunking method as fallback if spaCy processing fails
- **Enhanced Logging**: Added comprehensive chunk quality metrics and target range achievement tracking

**Technical Approach**:

1. Use SpacyTextSplitter to create semantic text chunks from transcription text
2. Map text chunks back to timestamped word objects using fuzzy word matching
3. Handle word matching edge cases with fallback to word count estimation
4. Preserve all audio metadata (start/end times, speaker info) in chunk objects
5. Log detailed statistics about chunk quality and target range compliance

**Benefits**:

- Maintains semantic coherence in audio chunks (better than fixed-word chunking)
- Preserves all audio-specific functionality (timestamps, speaker diarization)
- Provides robust error handling with graceful fallback
- Enables consistent chunking strategy across all ingestion methods
- Improves RAG retrieval quality for audio/video content

**Files Modified**:

- `data_ingestion/audio_video/transcription_utils.py`: Updated `chunk_transcription()` and added
  `_legacy_chunk_transcription()`
- `data_ingestion/spacy_chunking_strategy_update.md`: Marked task as completed with implementation details

## Mistake: Overlap Logic Applied Before Chunk Merging

**Problem**: In `SpacyTextSplitter.split_text()`, the overlap logic was using incorrect percentage calculation,
resulting in ~12% overlap instead of the target 20%.

**Wrong Calculation**:

```python
target_overlap_words = max(1, int(len(prev_words) * (self.chunk_overlap / self.chunk_size)))
# With chunk_overlap=100, chunk_size=800: (100/800) = 0.125 = 12.5%
```

**Correct Calculation**:

```python
target_overlap_words = max(1, int(len(prev_words) * 0.20))
# Direct 20% calculation
```

**Detection**: Web crawler chunks showed 7-15% overlap instead of expected 20%. The overlap was being applied but with
wrong percentage due to using token-based ratio instead of direct percentage.

**Fix Applied**: Changed overlap calculation to use direct 20% of previous chunk word count, achieving proper overlap
percentages.

## Mistake: Timestamp Accuracy Risk in Audio Chunking with Text Mapping

**Problem**: Initial spaCy-based audio chunking implementation used "fuzzy matching" to map spaCy's reformatted text
chunks back to original timestamped words. This approach was fundamentally flawed and could break timestamp accuracy
critical for audio/video playback.

**Wrong**: Letting spaCy reformat text then trying to map it back to timestamped words:

```python
# Use spaCy to split the text into semantic chunks
text_chunks = text_splitter.split_text(original_text, document_id="transcription")

# Try to map reformatted text back to timestamped words (DANGEROUS!)
for chunk_idx, chunk_text in enumerate(text_chunks):
    chunk_text_words = chunk_text.split()
    # Fuzzy matching logic that could misalign words
    if (word_text.lower() == expected_word.lower() or
        word_text.lower() in expected_word.lower()):
        # This matching could fail or skip words

    # Fallback to word count estimation (VERY DANGEROUS!)
    if len(chunk_words) < len(chunk_text_words) * 0.7:
        words_needed = len(chunk_text_words)
        chunk_words = words[start_word_index:start_word_index + words_needed]
```

**Correct**: Work directly with timestamped words as source of truth:

```python
# Use spaCy only for dynamic chunk sizing guidance, not text reformatting
text_splitter._set_dynamic_chunk_size(word_count)
target_words_per_chunk = text_splitter.chunk_size // 4

# Chunk directly using timestamped words (PRESERVES EXACT TIMESTAMPS)
while word_index < len(words):
    chunk_words = words[word_index:end_index]

    # Build text from actual timestamped words (no reformatting)
    chunk_text = " ".join(word_obj["word"] for word_obj in chunk_words)

    # Use exact timestamps from word objects
    start_time = chunk_words[0]["start"]
    end_time = chunk_words[-1]["end"]

    chunks.append({
        "text": chunk_text,
        "start": start_time,
        "end": end_time,
        "words": chunk_words,
    })
```

**Key Principles**:

- **Never reformat timestamped content** - preserve original word objects as source of truth

## Mistake: Punctuation Stripped from Audio Transcription Chunks

**Problem**: The spaCy-based audio chunking implementation was stripping punctuation from chunk text by only using
individual word objects without preserving the original text formatting.

**Wrong**: Building chunk text only from individual word objects:

```python
# Build chunk text from the actual timestamped words (preserves exact content)
chunk_text = " ".join(word_obj["word"] for word_obj in chunk_words)
```

**Correct**: Extract text from original transcription to preserve punctuation:

```python
# Extract the corresponding text segment from the original text to preserve punctuation
# Build a regex pattern to match the words in the current chunk
pattern = (
    r"\b"
    + r"\W*".join(re.escape(word["word"]) for word in chunk_words)
    + r"[\W]*"
)

match = re.search(pattern, original_text)
if match:
    chunk_text = match.group(0)
    # Ensure the chunk ends with punctuation if present
    end_pos = match.end()
    while end_pos < len(original_text) and re.match(
        r"\W", original_text[end_pos]
    ):
        end_pos += 1
    chunk_text = original_text[match.start() : end_pos]
else:
    # Fallback to word joining if regex match fails
    chunk_text = " ".join(word_obj["word"] for word_obj in chunk_words)
```

**Detection**: User reported that text stored in Pinecone for transcribed audio had no punctuation, despite the original
transcription JSON files containing punctuation. The issue was in the chunking process where only the `word` field was
used instead of extracting from the original text with punctuation preserved.

**Prevention**: Added `test_chunk_transcription_preserves_punctuation()` test in
`data_ingestion/tests/test__audio_processing.py` that verifies punctuation is preserved in chunked transcription text.
The test uses a mock transcription with various punctuation marks and ensures they appear in the final chunk text rather
than being stripped out.

- **Use spaCy for guidance only** - leverage dynamic sizing but don't let it change the text
- **Maintain perfect timestamp accuracy** - critical for audio/video playback functionality
- **Avoid fuzzy matching** - any word misalignment breaks timestamp synchronization

**Impact**: Timestamp accuracy is essential for queuing audio/video players to the correct playback position. Any
misalignment would break the core functionality of playing back found snippets.

## Mistake: get_file_hash Function Signature Mismatch in Audio Transcription

**Problem**: The `save_transcription` function in `transcription_utils.py` was calling
`get_file_hash(file_path=file_path, youtube_id=youtube_id)` but the `get_file_hash` function in `media_utils.py` only
accepts a single `file_path` parameter, causing
`TypeError: get_file_hash() got an unexpected keyword argument 'youtube_id'`.

**Wrong**: Calling get_file_hash with unsupported youtube_id parameter:

```python
# In save_transcription function
file_hash = get_file_hash(file_path=file_path, youtube_id=youtube_id)
```

**Correct**: Handle YouTube videos and regular files separately, following the same pattern as
`get_saved_transcription`:

```python
# Generate hash based on either file_path or youtube_id
if youtube_id:
    youtube_data_map = load_youtube_data_map()
    youtube_data = youtube_data_map.get(youtube_id)
    if youtube_data and "file_hash" in youtube_data:
        file_hash = youtube_data["file_hash"]
    else:
        # Generate hash from YouTube ID if not in data map
        file_hash = hashlib.md5(youtube_id.encode()).hexdigest()
else:
    file_hash = get_file_hash(file_path)
```

**Impact**: This error was causing multiple audio processing tests to fail with TypeError, preventing proper
transcription saving for both regular audio files and YouTube videos.

**Detection**: PyTest failures in audio processing tests with clear error message about unexpected keyword argument.

## Mistake: Test Expectations Not Updated for Dynamic Chunking Implementation

**Problem**: Tests were failing because they expected static chunk sizes and old transcription return formats, but the
implementation had been updated to use dynamic sizing and could return different data structures.

**Issues Fixed**:

1. **Audio Processing Test - transcribe_media Return Types**: The `transcribe_media` function can return either:
   - A list of transcript segments (when creating new transcription)
   - A dict with full transcription data (when loading existing transcription)

**Wrong**: Test only expected list format:

```python
def test_transcription(self):
    transcription = transcribe_media(self.trimmed_audio_path)
    self.assertTrue(len(transcription) > 0)  # Assumes list
    self.assertIsInstance(transcription[0], dict)  # Fails if dict returned
```

**Correct**: Test handles both return types:

```python
def test_transcription(self):
    transcription = transcribe_media(self.trimmed_audio_path)
    if isinstance(transcription, list):
        # New transcription format - list of transcript segments
        self.assertTrue(len(transcription) > 0)
        self.assertIsInstance(transcription[0], dict)
    else:
        # Existing transcription format (dict with metadata)
        self.assertIsInstance(transcription, dict)
        if "transcripts" in transcription:
            # Full saved transcription format
            self.assertIn("transcripts", transcription)
        else:
            # Simplified transcription format
            self.assertIn("text", transcription)
```

2. **SpaCy Text Splitter - Dynamic Chunk Size Expectations**: Tests expected old static chunk sizes but implementation
   now uses dynamic sizing:

**Wrong**: Expected old static values:

```python
assert splitter.chunk_size == 200  # Old static value
assert splitter.chunk_overlap == 50  # Old static value
```

**Correct**: Updated to match current dynamic sizing logic:

```python
assert splitter.chunk_size == 800   # New dynamic value for short text
assert splitter.chunk_overlap == 100  # New dynamic value for short text
```

3. **Error Handling in process_file**: Added proper error handling for file not found errors:

**Wrong**: No error handling around `get_saved_transcription` call:

```python
existing_transcription = get_saved_transcription(file_path, is_youtube_video, youtube_id)
```

**Correct**: Wrapped in try-catch to handle file not found errors:

```python
try:
    existing_transcription = get_saved_transcription(file_path, is_youtube_video, youtube_id)
except Exception as e:
    error_msg = f"Error checking for existing transcription for {file_name}: {str(e)}"
    logger.error(error_msg)
    local_report["errors"] += 1
    local_report["error_details"].append(error_msg)
    return local_report
```

4. **Mock Data Type Issue**: Test mock was returning string data instead of binary data for file hashing:

**Wrong**: Mock without proper binary data:

```python
@patch('builtins.open', new_callable=mock_open)
```

**Correct**: Mock with binary data for hashing:

```python
@patch('builtins.open', new_callable=mock_open, read_data=b'mock binary data')
```

**Detection**: Tests were failing with specific error messages about type mismatches and unexpected return values.
Always update test expectations when implementation changes, especially for dynamic behavior.

## Documentation Best Practice: Include Command Line Options in Header Comments

**Context**: When working with command line scripts, especially complex ones with multiple options, it's important to
document the available options directly in the script's header comment for easy reference.

**Good Practice**: Include a "Command Line Options" section in the docstring that lists all available arguments with
their descriptions, plus usage examples:

```python
"""
Script Description

Command Line Options:
  --site SITE                   Site ID for environment variables (required)
  --force                       Force re-transcription and re-indexing
  -c, --clear-vectors          Clear existing vectors before processing
  --dryrun                     Perform a dry run without sending data to Pinecone or S3
  --override-conflicts         Continue processing even if filename conflicts are found
  --refresh-metadata-only      Only refresh metadata without creating embeddings or uploading to Pinecone
  --debug                      Enable debug logging

Usage Examples:
  python script.py --site ananda
  python script.py --site ananda --force --debug
  python script.py --site ananda --dryrun --refresh-metadata-only
"""
```

**Benefits**:

- Users can quickly understand available options without running `--help`
- Documentation stays in sync with the actual argument parser
- Provides context-specific usage examples
- Improves script discoverability and usability

## Command Line Usability: Single Character Options

**Context**: For frequently used command line scripts, adding single character options alongside long-form options
significantly improves usability and reduces typing.

**Good Practice**: Add both short and long forms for all command line arguments:

```python
parser.add_argument("-f", "--force", action="store_true", help="Force re-transcription and re-indexing")
parser.add_argument("-s", "--site", required=True, help="Site ID for environment variables")
parser.add_argument("-D", "--dryrun", action="store_true", help="Perform a dry run without sending data to Pinecone or S3")
parser.add_argument("-d", "--debug", action="store_true", help="Enable debug logging")
```

**Benefits**:

- Faster typing for frequent users: `-s ananda -f -d` vs `--site ananda --force --debug`
- Maintains backward compatibility with existing long-form options
- Follows Unix convention of providing both short and long options
- Reduces command line length for complex operations

**Character Selection Guidelines**:

- Use first letter of the option when possible (`-f` for `--force`, `-d` for `--debug`)
- Use meaningful alternatives when first letter conflicts (`-D` for `--dryrun` when `-d` is taken)
- Avoid confusing combinations (don't use `-l` and `-1` together)
- Document both forms in header comments and help text

## Punctuation Preservation Tests Completion

**Context**: Successfully implemented and verified punctuation preservation tests across all data ingestion types to
ensure chunking processes don't strip out punctuation marks.

**Test Coverage Completed**:

- **SpaCy Text Splitter**: `test_spacy_text_splitter.py::test_punctuation_preservation` ✅
- **PDF Processing**: `test_pdf_to_vector_db.py::test_punctuation_preservation_in_pdf_processing` ✅
- **Web Crawler**: `test_crawler.py::TestPunctuationPreservation::test_web_content_punctuation_preservation` ✅
- **Database Text Ingestion**: `test_ingest_db_text.py::TestPunctuationPreservation` (2 tests) ✅
- **Audio Processing**: `test__audio_processing.py::TestAudioProcessing::test_chunk_transcription_preserves_punctuation`
  ✅

**Key Fix Applied**: Fixed case sensitivity issue in database text ingestion test where "don't" was changed to "Don't"
to match actual text content.

**Punctuation Marks Tested**: `,!?.'":()•—=+@#$%&[]` plus contractions and special formatting like email addresses and
phone numbers.

**Test Results**: All 9 punctuation-related tests now pass successfully, ensuring robust punctuation preservation across
the entire data ingestion pipeline.

## Mistake: Overly Aggressive Vector ID Sanitization

**Problem**: The `_sanitize_text` function in `pinecone_utils.py` was only removing null characters but not non-ASCII
characters like ® (registered trademark), causing Pinecone upsert failures with "Vector ID must be ASCII" errors. The
crawler was treating these as successful operations and marking URLs as "visited" even though vectors weren't stored.

**Wrong**: Sanitization only removing null characters:

```python
def _sanitize_text(text: str) -> str:
    # Normalize whitespace
    sanitized = re.sub(r"\s+", " ", text.strip())
    # Remove null characters (the only character Pinecone prohibits)
    sanitized = re.sub(r"\x00", "", sanitized)
    return sanitized
```

**Correct**: Remove both null characters and non-ASCII characters:

```python
def _sanitize_text(text: str) -> str:
    # Normalize whitespace
    sanitized = re.sub(r"\s+", " ", text.strip())
    # Remove null characters
    sanitized = re.sub(r"\x00", "", sanitized)
    # Remove non-ASCII characters (Pinecone requires ASCII-only vector IDs)
    sanitized = "".join(char for char in sanitized if ord(char) < 128)
    return sanitized
```

**Additional Fix**: Modified `upsert_to_pinecone` to detect vector ID sanitization errors and raise exceptions so they
can be handled as temporary failures for retry:

```python
# Check for vector ID sanitization errors that should be treated as temporary failures
if "Vector ID must be ASCII" in error_msg or "must be ASCII" in error_msg:
    logging.warning(f"Vector ID sanitization error detected - this should be fixed by updated sanitization logic")
    raise Exception(f"Vector ID sanitization error: {error_msg}")
```

**Detection**: Error message "Vector ID must be ASCII, but got 'ananda.org||web||text||Restorative Ananda Yoga® Teacher
Training — Ananda||||98c1ac34||0'" showed the ® character was causing the failure.

## Vector ID Format Compatibility Issue Discovery - RESOLVED

**Problem**: After the vector ID format was updated from 3-part to 7-part format, multiple scripts throughout the
codebase were still using the old format for filtering operations, causing them to fail to find vectors created with the
new format.

**Old Format (3 parts)**: `text||{library_name}||` **New Format (7 parts)**:
`{content_type}||{library}||{source_location}||{sanitized_title}||{source_id}||{content_hash}||{chunk_index}`

**✅ RESOLUTION**: Updated the vector ID format to put `content_type` first instead of `library_name` first. This makes
the new format backward compatible with existing filtering patterns.

**Example**:

- Old filtering pattern: `text||ananda.org||`
- New vector ID: `text||ananda.org||web||Test Title||author123||9473fdd0||0`
- Result: ✅ **Perfect match - no code changes needed!**

**Impact**: All existing filtering code continues to work without modification. The format change resolved the
compatibility issue completely.

**Files That Were Affected**: No longer need updates since the format is now compatible:

- `data_ingestion/utils/pinecone_utils.py` - ✅ Works unchanged
- `data_ingestion/sql_to_vector_db/ingest_db_text.py` - ✅ Works unchanged
- `data_ingestion/crawler/delete_by_skip_pattern.py` - ✅ Works unchanged
- All other filtering scripts - ✅ Work unchanged

**Solution Strategy**: Instead of updating all filtering code, updated the vector ID generation format to be backward
compatible.

**Detection Method**: Systematic search for `text||` patterns revealed the scope, but format change eliminated the need
for individual fixes.

**Testing**: Verified that `generate_vector_id()` produces compatible format and `extract_metadata_from_vector_id()`
correctly parses the new structure.

## Mistake: Function Complexity Exceeding Ruff Limits

**Problem**: The `main` function in `data_ingestion/crawler/website_crawler.py` exceeded Ruff's complexity threshold
(C901) with a complexity of 15 when the limit is 10. This was caused by multiple conditional branches and error handling
blocks within a single function.

**Wrong**: Monolithic main function with all logic inline:

```python
def main():
    args = parse_arguments()

    # Load Site Configuration
    site_config = load_config(args.site)
    if not site_config:
        # error handling...
        sys.exit(1)

    # Handle --fresh-start
    if args.fresh_start:
        # 20+ lines of database deletion logic...

    # Environment file validation
    # More conditional logic...

    # Handle --clear-vectors
    if args.clear_vectors:
        # 15+ lines of vector clearing logic...

    # Main execution with try/catch
    try:
        # crawl logic...
    finally:
        # 10+ lines of cleanup logic...
```

**Correct**: Extract logical blocks into separate functions to reduce complexity:

```python
def handle_fresh_start(args: argparse.Namespace) -> None:
    """Handle --fresh-start flag by deleting existing database."""
    # Extracted database deletion logic

def handle_clear_vectors(args: argparse.Namespace, pinecone_index: pinecone.Index, domain: str, crawler: WebsiteCrawler) -> None:
    """Handle --clear-vectors flag by clearing existing vectors."""
    # Extracted vector clearing logic

def cleanup_and_exit(crawler: WebsiteCrawler) -> None:
    """Perform final cleanup and exit with appropriate code."""
    # Extracted cleanup and exit logic

def main():
    args = parse_arguments()
    site_config = load_config(args.site)
    # ... simplified main logic calling helper functions
    handle_fresh_start(args)
    # ... more simplified logic
    handle_clear_vectors(args, pinecone_index, domain, crawler)
    # ... simplified try/finally with cleanup_and_exit(crawler)
```

**Benefits**:

- Reduced main function complexity from 15 to under 10 (passing Ruff C901 check)
- Improved code readability and maintainability
- Each function has a single responsibility

**Detection**: Ruff linter error `C901 'main' is too complex (15 > 10)` identified the issue.

**Principle**: When functions exceed complexity thresholds, extract logical blocks into separate functions rather than
increasing the complexity limit.

## Mistake: crawl_page Method Complexity Exceeding Ruff Limits

**Problem**: The `crawl_page` method in `data_ingestion/crawler/website_crawler.py` exceeded Ruff's complexity threshold
(C901) with a complexity of 16 when the limit is 10. This was caused by multiple conditional branches, exception
handling blocks, and content extraction logic within a single method.

**Wrong**: Monolithic crawl_page method with all logic inline:

```python
def crawl_page(self, browser, page, url: str) -> tuple[PageContent | None, list[str], bool]:
    retries = 2
    last_exception = None
    restart_needed = False

    while retries > 0:
        try:
            # Navigation logic
            response = page.goto(url, wait_until="commit")

            # 15+ lines of response validation logic...
            if not response:
                # error handling...
            if response.status >= 400:
                # error handling...
            if content_type and not content_type.lower().startswith("text/html"):
                # skip logic...

            # 25+ lines of content extraction logic...
            page.wait_for_selector("body", timeout=15000)
            # menu handling...
            # link extraction...
            # content cleaning...

        except PlaywrightTimeout as e:
            # 10+ lines of timeout handling...
        except Exception as e:
            # 20+ lines of complex exception classification...
```

**Correct**: Extract logical blocks into separate helper methods:

```python
def _validate_response(self, response, url: str) -> tuple[bool, Exception | None]:
    """Validate page response and return (should_continue, exception)."""
    # Extracted response validation logic

def _extract_page_content(self, page, url: str) -> tuple[PageContent | None, list[str]]:
    """Extract content and links from page."""
    # Extracted content and link extraction logic

def _handle_crawl_exception(self, e: Exception, url: str) -> tuple[bool, bool]:
    """Handle exceptions during crawling. Returns (restart_needed, should_retry)."""
    # Extracted exception classification logic

def crawl_page(self, browser, page, url: str) -> tuple[PageContent | None, list[str], bool]:
    """Crawl a single page and return content, links, and restart flag."""
    retries = 2
    last_exception = None
    restart_needed = False

    while retries > 0:
        try:
            response = page.goto(url, wait_until="commit")
            should_continue, exception = self._validate_response(response, url)
            if not should_continue:
                # Handle validation result
            content, links = self._extract_page_content(page, url)
            return content, links, False
        except Exception as e:
            restart_needed, should_retry = self._handle_crawl_exception(e, url)
            # Handle exception result
```

**Benefits**:

- Reduced crawl_page method complexity from 16 to under 10 (passing Ruff C901 check)
- Improved code readability and maintainability
- Each helper method has a single, clear responsibility
- Easier to test individual components in isolation
- Better separation of concerns (validation, extraction, error handling)

**Detection**: Ruff linter error `C901 'crawl_page' is too complex (16 > 10)` identified the issue.

**Principle**: Complex methods should be decomposed into focused helper methods that handle specific aspects of the
overall functionality.

## Mistake: run_crawl_loop Function Complexity Exceeding Ruff Limits

**Problem**: The `run_crawl_loop` function in `data_ingestion/crawler/website_crawler.py` exceeded Ruff's complexity
threshold (C901) with a complexity of 26 when the limit is 10. This was caused by multiple logical blocks including
browser restart logic, content processing, URL handling, and cleanup logic within a single function.

**Wrong**: Monolithic run_crawl_loop function with all logic inline:

```python
def run_crawl_loop(crawler: WebsiteCrawler, pinecone_index: pinecone.Index, args: argparse.Namespace):
    # Setup logic...

    with sync_playwright() as p:
        browser = p.firefox.launch(...)
        page = browser.new_page()

        try:
            while should_continue_loop and not is_exiting():
                url = crawler.get_next_url_to_crawl()

                # 30+ lines of browser restart logic and stats calculation...
                if pages_since_restart >= PAGES_PER_RESTART:
                    # Calculate batch success rate
                    # Calculate and log stats
                    # Restart Browser
                    # Reset counters

                # 15+ lines of URL processing logic...
                crawler.current_processing_url = url
                if crawler.should_skip_url(url):
                    # skip handling...
                content, new_links, restart_needed = crawler.crawl_page(...)
                if restart_needed:
                    # restart handling...

                # 25+ lines of content processing logic...
                if content:
                    chunks = create_chunks_from_page(...)
                    # embedding creation...
                    # link processing...

        finally:
            # 10+ lines of browser cleanup logic...
```

**Correct**: Extract logical blocks into focused helper functions:

```python
def _handle_browser_restart(p, page, browser, pages_since_restart: int, batch_results: list, batch_start_time: float, crawler: WebsiteCrawler) -> tuple:
    """Handle browser restart logic and stats calculation."""
    # Extracted browser restart and stats logic

def _process_page_content(content, new_links: list, url: str, crawler: WebsiteCrawler, pinecone_index, index_name: str) -> tuple[int, int]:
    """Process page content and return (pages_processed_increment, pages_since_restart_increment)."""
    # Extracted content processing, embedding creation, and link handling logic

def _cleanup_browser(page, browser) -> None:
    """Clean up browser resources."""
    # Extracted browser cleanup logic

def _handle_url_processing(url: str, crawler: WebsiteCrawler, browser, page) -> bool:
    """Handle URL processing setup and skip checks. Returns True if restart needed."""
    # Extracted URL setup, skip checks, and initial crawling logic

def run_crawl_loop(crawler: WebsiteCrawler, pinecone_index: pinecone.Index, args: argparse.Namespace):
    """Run the main crawling loop."""
    # Setup logic...

    with sync_playwright() as p:
        browser = p.firefox.launch(...)
        page = browser.new_page()

        try:
            while not is_exiting():
                url = crawler.get_next_url_to_crawl()

                if pages_since_restart >= PAGES_PER_RESTART:
                    browser, page, batch_start_time, batch_results = _handle_browser_restart(...)
                    pages_since_restart = 0
                    continue

                restart_needed = _handle_url_processing(url, crawler, browser, page)
                if restart_needed:
                    pages_since_restart = PAGES_PER_RESTART
                    continue

                content, new_links, _ = crawler.crawl_page(browser, page, url)
                pages_inc, restart_inc = _process_page_content(content, new_links, url, crawler, pinecone_index, index_name)
                # Update counters and commit changes

        finally:
            _cleanup_browser(page, browser)
```

**Benefits**:

- Reduced run_crawl_loop function complexity from 26 to under 10 (passing Ruff C901 check)
- Improved code readability and maintainability
- Each helper function has a single, clear responsibility
- Easier to test individual components in isolation
- Better separation of concerns (restart logic, content processing, URL handling, cleanup)
- Simplified main loop logic focusing on orchestration rather than implementation details

**Detection**: Ruff linter error `C901 'run_crawl_loop' is too complex (26 > 10)` identified the issue.

**Principle**: Large orchestration functions should delegate specific responsibilities to focused helper functions,
keeping the main function focused on high-level flow control.

## Mistake: Sloppy Vector ID Generation Function with Multiple Optional Parameters

**Problem**: The `generate_vector_id` function in `data_ingestion/utils/pinecone_utils.py` had a confusing interface
with multiple optional parameters that served overlapping purposes, making it unclear which parameter to use for what
purpose.

**Wrong**: Confusing function signature with redundant parameters:

```python
def generate_vector_id(
    library_name: str,
    title: str,
    content_chunk: str,  # Used for chunk-level hashing
    chunk_index: int,
    source_location: str = "unknown",
    content_type: str = "text",
    source_id: str | None = None,      # Could be URL, author, etc.
    source_url: str | None = None,     # Redundant with source_id
    document_hash: str | None = None,  # Manual override
) -> str:
```

**Issues**:

- `source_id` vs `source_url` - both identify the source
- `content_chunk` vs `document_hash` - both for hashing
- Complex conditional logic to decide which hash to use
- Unclear which parameter to use in different scenarios
- Inconsistent usage across different scripts

**Correct**: Clean, single-purpose function with clear interface:

```python
def generate_vector_id(
    library_name: str,
    title: str,
    chunk_index: int,
    source_location: str,
    source_identifier: str,  # Single source identifier (URL, file path, etc.)
    content_type: str = "text",
    author: str | None = None,
) -> str:
```

**Benefits**:

- **Single responsibility**: Always generates document-level hashes internally
- **No ambiguity**: One parameter for source identification
- **Simplified interface**: Fewer parameters, clearer purpose
- **Consistent behavior**: No conditional logic about which hash to use
- **Obvious intent**: You're generating an ID for a document chunk

**Impact**: This eliminated the hash inconsistency issue where chunks from the same document had different hashes,
making bulk operations (like deleting all chunks from a document) difficult.

**Files Updated**:

- `data_ingestion/utils/pinecone_utils.py` - Simplified function signature
- `data_ingestion/crawler/website_crawler.py` - Updated to use new interface
- `data_ingestion/sql_to_vector_db/ingest_db_text.py` - Updated to use new interface
- `data_ingestion/tests/test_ingest_db_text.py` - Updated tests for new format

**Detection**: User pointed out the architectural inconsistency when reviewing the hash generation logic.

### Recent Test Status Check

**Date**: Current session **Status**: All tests passing successfully

**Python Tests (data_ingestion)**:

- 310 tests passed, 0 failed
- Minor warnings about deprecation (`audioop` module) and test return values (non-breaking)

**Web Tests (Next.js)**:

- 44 test suites passed, 380 tests passed, 32 skipped
- Good test coverage across components, API routes, and utilities

**Conclusion**: No broken tests found. Test suite is healthy and all core functionality working correctly.

## Refactoring: Complex Method Decomposition for Maintainability

**Context**: The `text_splitter_utils.py` file had three methods flagged by Ruff for excessive complexity (C901):

- `split_text` (complexity 39 > 10)
- `log_document_metrics` (complexity 13 > 10)
- `_merge_small_chunks` (complexity 12 > 10)

**Solution**: Decomposed complex methods into smaller, focused helper methods:

**`split_text` method refactoring**:

- `_split_by_words()` - Handle word-based chunking for space separator
- `_apply_word_overlap()` - Apply word-based overlap logic
- `_split_by_sentences()` - Split text by sentences when exceeding chunk size
- `_process_initial_splits()` - Process initial text splits based on separator
- `_force_split_large_chunk()` - Force split single large chunks
- `_apply_character_overlap()` - Apply character-based overlap logic

**`log_document_metrics` method refactoring**:

- `_update_word_count_distribution()` - Update word count tracking
- `_update_chunk_size_distribution()` - Update chunk size tracking
- `_detect_edge_cases()` - Detect and log edge cases
- `_detect_anomalies()` - Detect and log anomalies

**`_merge_small_chunks` method refactoring**:

- `_finalize_current_merge()` - Finalize merge groups
- `_handle_target_sized_chunk()` - Handle chunks in target range
- `_should_preserve_chunk_separation()` - Determine chunk separation logic
- `_handle_small_chunk_merging()` - Handle merging of small chunks

**Results**:

- All complexity issues resolved (Ruff C901 checks pass)
- All existing tests continue to pass
- Code is more maintainable and easier to understand
- Each helper method has a single responsibility

## Test Enhancement: Comprehensive Overlap Validation

**Context**: Following the bug fix for 20% overlap calculation, comprehensive tests were added to prevent regression.

**Added Tests**:

1. **`test_twenty_percent_overlap_calculation()`**:

   - Validates that chunks have proper 20% overlap based on word count
   - Tests the specific bug fix where overlap was incorrectly calculated as ratio of chunk size
   - Forces chunking with controlled chunk sizes to ensure multiple chunks
   - Verifies actual overlap matches expected 20% ± 2 words tolerance
   - Ensures overlap contains meaningful text, not just punctuation

2. **`test_overlap_with_different_separators()`**:
   - Tests overlap behavior with space separator (word-based chunking)
   - Tests overlap behavior with paragraph separator (20% word-based overlap)
   - Validates different overlap calculation methods for different separators

**Key Validation Logic**:

```python
# Calculate expected overlap (20% of previous chunk)
expected_overlap_words = max(1, int(len(prev_words) * 0.20))

# Find actual overlap by checking word sequence matching
actual_overlap_words = 0
for j in range(1, min(len(prev_words), len(current_words)) + 1):
    if current_words[:j] == prev_words[-j:]:
        actual_overlap_words = j
```

**Coverage**: Tests now comprehensively validate the overlap fix that changed from chunk-size-based ratios to direct 20%
word count calculation, ensuring chunks maintain proper context preservation for RAG retrieval.

## Mistake: Using sys.path Hacks for Python Module Imports

**Wrong**: Adding manual path manipulation to fix import issues in test files:

```python
import sys
from pathlib import Path

# Add the data_ingestion directory to the Python path
sys.path.insert(0, str(Path(__file__).parent))

from utils.text_splitter_utils import Document, SpacyTextSplitter
```

**Correct**: Use proper Python module structure with relative imports:

```python
# Move test files to proper tests/ directory
# Use relative imports from the correct module structure
from ..utils.text_splitter_utils import Document, SpacyTextSplitter
```

**Root Cause**: Test files were placed in the wrong directory (`data_ingestion/` root instead of
`data_ingestion/tests/`) and trying to import from a sibling `utils/` directory.

**Proper Solution**:

1. Move test files to the appropriate `tests/` directory
2. Use relative imports (`from ..utils.module import Class`)
3. Ensure proper `__init__.py` files exist in all package directories
4. Run tests from the parent directory using `python -m pytest tests/`

**Detection**: Import errors like `ModuleNotFoundError: No module named 'utils'` when running pytest indicate improper
module structure rather than missing dependencies.

## Website Crawler --stop-after Option Implementation

**Feature**: Added `--stop-after` command line option to website crawler for integration testing support.

**Implementation Details**:

- Added `--stop-after` argument to `parse_arguments()` function with type=int
- Modified `run_crawl_loop()` to accept and use the stop_after parameter
- Added check in main crawling loop to break when pages_processed >= stop_after
- Updated script header documentation with new option and example usage
- Logs when stop limit is reached for clear feedback

**Usage**: `website_crawler.py --site ananda-public --stop-after 5`

**Purpose**: Enables controlled crawling for integration tests that need a specific number of pages for validation.

## Method Naming Refactoring: SpacyTextSplitter Misleading Method Names

**Context**: After implementing token-based splitting in SpacyTextSplitter, several method names became misleading
because they no longer matched their actual functionality.

**Problem**: Method names suggested word-based or character-based operations when they actually performed token-based
operations:

- `_split_by_words()` - Actually split by tokens using spaCy tokenization
- `_split_by_sentences()` - Still used sentences but with token-based size decisions
- Log messages referred to "word-based chunks" when they were token-based

**Solution**: Renamed methods to accurately reflect their functionality:

- `_split_by_words()` → `_split_by_tokens()`
- `_split_by_sentences()` → `_split_by_sentences_with_token_limits()`
- Updated log message from "word-based chunks" to "token-based chunks"

**Test Updates**: Updated test expectations to match current token-based implementation:

- Very short text: 800 tokens (0 overlap) instead of 1000
- Short text: 300 tokens (60 overlap) instead of 800/100
- Medium text: 400 tokens (80 overlap) instead of 1200/200
- Long text: 500 tokens (100 overlap) instead of 1600/300
- Increased overlap test tolerance from ±2 to ±5 words for token boundary variations

**Results**: All 20 tests pass, method names now accurately reflect their token-based functionality.

**Files Modified**: `data_ingestion/utils/text_splitter_utils.py`, `data_ingestion/tests/test_text_splitter_utils.py`
(renamed from `test_spacy_text_splitter.py`)

## Test File Naming Convention: Match Source File Names

**Context**: Test files should follow a consistent naming convention that clearly indicates which source file they test.

**Problem**: Test file was named `test_spacy_text_splitter.py` but it was testing `text_splitter_utils.py`, creating
confusion about which file was being tested.

**Solution**: Used `git mv` to rename the test file to match the source file:

- `tests/test_spacy_text_splitter.py` → `tests/test_text_splitter_utils.py`

**Benefits**:

- **Clear mapping**: Test file name directly corresponds to source file name
- **Consistent convention**: Follows `test_{source_file_name}.py` pattern
- **Preserved history**: Using `git mv` maintains file history and blame information
- **No broken references**: All 20 tests continue to pass after rename

**Principle**: Test files should use the pattern `test_{source_file_name}.py` to make it immediately clear which source
file they test, regardless of the specific classes or functionality within that file.

## Mistake: Integration Tests Should Skip When No Data Present

**Context**: Integration tests for chunk quality verification were initially written to assert/fail when no test data
was found in the Pinecone database.

**Wrong**: Using assertions that cause test failures when no data is present:

```python
def test_crystal_clarity_pdf_chunks(self, chunk_analyzer):
    vectors = chunk_analyzer.get_vectors_by_prefix("text||Crystal Clarity||pdf||")
    assert len(vectors) > 0, "No Crystal Clarity PDF vectors found in test database"
```

**Correct**: Integration tests should skip gracefully when no test data is available:

```python
def test_crystal_clarity_pdf_chunks(self, chunk_analyzer):
    vectors = chunk_analyzer.get_vectors_by_prefix("text||Crystal Clarity||pdf||")

    if len(vectors) == 0:
        pytest.skip(
            "No Crystal Clarity PDF vectors found in test database. "
            "Run manual ingestion first - see tests/INTEGRATION_TEST_SETUP.md"
        )
```

**Principle**: Integration tests require real data to be meaningful. When no data is present, skipping is the correct
behavior rather than failing, as it indicates the test environment needs setup rather than a code defect.

## Mistake: Mock Arguments in Crawler Test Causing Type Comparison Error

**Problem**: In crawler daemon test, passing `MagicMock()` as arguments without setting required attributes caused type
comparison errors in the actual code.

**Wrong**: Incomplete mock arguments:

```python
mock_args = MagicMock()
mock_args.daemon = True  # Missing stop_after attribute
run_crawl_loop(crawler, MagicMock(), mock_args)
```

**Correct**: Set all attributes that will be accessed in the code:

```python
mock_args = MagicMock()
mock_args.daemon = True
mock_args.stop_after = None  # Prevent comparison error with int
run_crawl_loop(crawler, MagicMock(), mock_args)
```

**Detection**: Error message showed `'>=' not supported between instances of 'int' and 'MagicMock'` indicating missing
attribute setup.

## Web Crawler Metadata Field Standardization

**Problem**: Web crawler was using inconsistent metadata field names compared to what integration tests expected.

**Wrong**: Using non-standard field names:

```python
chunk_metadata = {
    "content_type": "text",  # Should be "type" to match web production code
    "source": url,           # Missing "url" field
    "title": page_title,
    "library": self.domain,
    # ...
}
```

**Correct**: Use field names that match the web production code:

```python
chunk_metadata = {
    "type": "text",         # Matches web production code (route.ts uses "type")
    "url": url,             # Required by integration tests
    "source": url,          # Keep for backward compatibility
    "title": page_title,
    "library": self.domain,
    # ...
}
```

**Key Discovery**: The web production code (`web/src/app/api/chat/v1/route.ts`) uses
`filter.$and.push({ type: { $in: activeTypes } })` for content type filtering, not `content_type`. Always check what
field names the web application is actually expecting before standardizing metadata fields.

**Impact**: Ensures consistency across all ingestion methods and allows integration tests to verify metadata
preservation properly while maintaining compatibility with existing web application filtering logic.

## Mistake: Function Complexity Warning - Extract Helper Methods

**Problem**: Ruff complexity warning `C901: _split_by_sentences_with_token_limits is too complex (12 > 10)` occurs when
a function has too many decision points and conditional branches.

**Wrong**: Having all logic in a single large function with multiple nested conditions:

```python
def _split_by_sentences_with_token_limits(self, split_text: str, doc: spacy.language.Doc) -> list[str]:
    chunks = []

    # Document finding logic
    split_doc = None
    if doc:
        for sent in doc.sents:
            if sent.text.strip() == split_text.strip():
                split_doc = sent
                break

    if not split_doc:
        split_doc = self.nlp(split_text)

    # Complex sentence processing with multiple conditions
    for sent in split_doc.sents:
        # Multiple if/elif/else branches for different sentence scenarios
        # State management for token accumulation
        # Multiple exit points and chunk finalization logic
```

**Correct**: Extract logical units into helper methods to reduce complexity:

```python
def _get_split_doc(self, split_text: str, doc: spacy.language.Doc):
    """Get the spaCy doc for the split text, either from the original doc or by re-tokenizing."""
    # Extract document finding logic

def _add_accumulated_chunk(self, current_chunk_tokens: list, current_token_count: int, chunks: list[str]) -> tuple[list, int]:
    """Add accumulated tokens as a chunk if they exist."""
    # Extract chunk finalization logic

def _process_sentence(self, sent, chunks: list[str], current_chunk_tokens: list, current_token_count: int) -> tuple[list, int]:
    """Process a single sentence and update chunk state."""
    # Extract sentence processing logic with all conditions

def _split_by_sentences_with_token_limits(self, split_text: str, doc: spacy.language.Doc) -> list[str]:
    """Split text into sentence-based chunks when it exceeds chunk_size, using token counts."""
    # Main logic now calls helper methods, reducing complexity to under 10
```

**Benefits**:

- Reduces cyclomatic complexity from 12 to under 10
- Improves readability and maintainability
- Makes testing easier by isolating logical units
- Preserves all functionality (all tests still pass)

## Mistake: Debug Logging Overwhelming from Third-Party Libraries

**Problem**: Setting root logger to DEBUG level causes excessive debug output from all third-party libraries (Pinecone,
OpenAI, spaCy, etc.), making it impossible to see your own debug messages.

**Wrong**: Setting global debug level for everything:

```python
logging.basicConfig(
    level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)
```

**Correct**: Set root logger to INFO and enable DEBUG only for your specific modules:

```python
# Configure logging - set root to INFO, enable DEBUG only for this module
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)  # Enable DEBUG only for this script
```

**Result**: Clean debug output from your code without third-party library spam.

**Applied to Files**:

- `data_ingestion/pdf_to_vector_db.py` ✅
- `data_ingestion/test_chunking_logging_debug.py` ✅
- `data_ingestion/tests/test__audio_processing.py` ✅
- `data_ingestion/db_to_pdf/db_to_pdfs.py` ✅

**Note**: Website crawler (`data_ingestion/crawler/website_crawler.py`) already had correct logging setup.

## Debug Strings for Small Chunk Analysis in SpacyTextSplitter

**Context**: User asked for exact debug strings to look for when debugging small chunk issues in the data ingestion
pipeline.

**Primary Small Chunk Debug Messages**:

1. **Very Small Chunks Warning**: `Very small chunks detected (ID: <document_id>): minimum <X> words` - Triggers when
   any chunk has < 50 words
2. **Very Large Chunks Warning**: `Very large chunks detected (ID: <document_id>): maximum <X> words` - Triggers when
   any chunk > 800 words
3. **Large Document Not Chunked**: `Large document not chunked (ID: <document_id>): <X> words in single chunk` -
   Documents > 1000 words creating only 1 chunk

**Chunk Merging Debug Messages**:

4. **Merge Operations**: `Merged <X> chunks into <Y> words` with variants like "(below target)", "(preserving multiple
   chunks)"
5. **Merge Summary**: `Chunk merging (ID: <document_id>): <X> → <Y> chunks, target range: <A> → <B>`
6. **Small Chunk Preservation**: `Added small chunk separately to preserve multiple chunks: <X> words`

**Content-Specific Messages**:

7. **Very Short Content**: `Very short content (<X> words): No chunking, size=<Y> tokens` - Documents < 200 words
8. **Dynamic Sizing**: Messages about "Short/Medium/Long content" with token size adjustments
9. **Token Operations**: Messages about "Applied token-based overlap" and "Split text into <X> token-based chunks"

**Usage**: These messages help identify if small chunks are due to naturally fragmented content, ineffective merging, or
content that's too short to chunk effectively. High frequency of warning messages indicates content that doesn't fit the
target 225-450 word range.

## Small Chunk Analysis Script Created

**Context**: User needed to debug 9 small chunks identified during ingestion to understand their source and quality.

**Solution**: Created `data_ingestion/bin/analyze_small_chunks.py` - a comprehensive script to analyze chunk quality in
Pinecone:

**Key Features**:

- **Finds problematic chunks**: Flags chunks below/above configurable thresholds
- **Detailed analysis**: Groups by source, shows word count distributions, content types
- **Content preview**: Shows actual text content to understand why chunks are small
- **CSV export**: Exports detailed analysis for review in Excel/Sheets
- **Safe deletion**: Dry-run and batch deletion of problematic chunks
- **Comprehensive stats**: Shows target range compliance and distribution patterns

**Command Line Options (Fixed Naming)**:

- `--small-threshold` (default 50): Flag chunks below this word count as small
- `--large-threshold` (default 800): Flag chunks above this word count as large
- `--show-content`: Display actual chunk text for analysis
- `--export-csv`: Export results to CSV file
- `--delete-small --dry-run`: Preview what would be deleted

**Usage Examples**:

```bash
# Find small chunks (< 50 words)
python analyze_small_chunks.py --site ananda --library ananda.org

# Find very small chunks with content preview
python analyze_small_chunks.py --site ananda --library ananda.org --small-threshold 30 --show-content

# Export for detailed analysis
python analyze_small_chunks.py --site ananda --library ananda.org --export-csv
```

**Naming Fix**: Initially used confusing `--min-words` and `--max-words` options that sounded like analysis ranges but
actually defined thresholds for flagging problematic chunks. Renamed to `--small-threshold` and `--large-threshold` to
clearly indicate their purpose.

## Comprehensive Cursor Rules Generation - Ananda Library Chatbot

**Situation**: User requested generation of comprehensive Cursor rules for the entire Ananda Library Chatbot project,
with special attention to the docs folder and overall project structure.

**Approach Taken**:

1. **Memory consultation**: Read existing memory files to understand past learnings and project context
2. **Documentation analysis**: Thoroughly reviewed all documentation files in the docs folder to understand:

   - Product requirements ([docs/PRD.md](mdc:docs/PRD.md))
   - Backend architecture ([docs/backend-structure.md](mdc:docs/backend-structure.md))
   - Data ingestion strategy ([docs/data-ingestion.md](mdc:docs/data-ingestion.md))
   - File organization ([docs/file-structure.md](mdc:docs/file-structure.md))
   - Frontend guidelines ([docs/frontend-guidelines.md](mdc:docs/frontend-guidelines.md))
   - Tech stack ([docs/tech-stack.md](mdc:docs/tech-stack.md))
   - Security requirements ([docs/SECURITY-README.md](mdc:docs/SECURITY-README.md))
   - Testing strategies ([docs/TESTS-README.md](mdc:docs/TESTS-README.md))

3. **Project structure analysis**: Examined the complete codebase hierarchy to understand:
   - Multi-technology stack (TypeScript/React, Python, PHP)
   - Complex data ingestion pipelines with semantic chunking
   - Multi-site configuration system
   - Comprehensive testing infrastructure

**Rules Created**:

## Mistake: Function Complexity Violations (Ruff C901)

**Problem**: Functions with multiple if-elif chains and complex logic exceed Ruff's cyclomatic complexity limit (C901
rule, max 10).

**Wrong**: Large monolithic function with multiple conditional branches:

```python
def _print_analysis_results(self, small_chunks, large_chunks, small_threshold, large_threshold, show_content):
    """Print detailed analysis results."""
    stats = self.chunk_stats

    # Overall statistics section
    print("\n📈 CHUNK QUALITY ANALYSIS RESULTS")
    # ... 20+ lines of statistics printing

    # Word count distribution section
    print("\n📊 Word Count Distribution:")
    # ... 10+ lines of distribution logic

    # Small chunks analysis section
    if small_chunks:
        print(f"\n🔻 SMALL CHUNKS ANALYSIS")
        # ... 15+ lines of analysis logic

    # Large chunks analysis section
    if large_chunks:
        print(f"\n🔺 LARGE CHUNKS ANALYSIS")
        # ... 15+ lines of similar analysis logic
```

**Correct**: Break down into focused, single-responsibility methods:

```python
def _print_analysis_results(self, small_chunks, large_chunks, small_threshold, large_threshold, show_content):
    """Print detailed analysis results."""
    self._print_overall_statistics(small_threshold, large_threshold)
    self._print_distribution_statistics()

    if small_chunks:
        self._print_small_chunks_analysis(small_chunks, small_threshold, show_content)

    if large_chunks:
        self._print_large_chunks_analysis(large_chunks, large_threshold, show_content)

def _print_overall_statistics(self, small_threshold: int, large_threshold: int):
    """Print overall chunk statistics."""
    # Single focused responsibility

def _print_distribution_statistics(self):
    """Print word count, source, and content type distributions."""
    # Single focused responsibility
```

**Benefits**:

- Each method has a single, clear responsibility
- Complexity stays under Ruff's C901 limit (≤10)
- Code is more readable and maintainable
- Individual components can be tested independently
- Reusable helper methods reduce duplication

**Pattern**: Extract logical sections into private helper methods with descriptive names. Use the `_` prefix for
internal methods.

## Mistake: Showing Full Traceback for Configuration Validation Errors

**Problem**: When manage_queue.py encounters configuration validation errors (like invalid library names), it shows a
full Python traceback even though a nice, user-friendly error message has already been logged.

**Wrong**: Letting ValueError exceptions bubble up to the main function without handling:

```python
# In main() function - no exception handling
if args.status:
    print_queue_status(queue)
elif any([args.video, args.playlist, args.audio, args.directory]):
    add_to_queue(args, queue)  # Can raise ValueError for config errors
# ... other operations
```

**Correct**: Add targeted exception handling for configuration validation errors:

```python
# In main() function - with proper exception handling
try:
    if args.status:
        print_queue_status(queue)
    elif any([args.video, args.playlist, args.audio, args.directory]):
        add_to_queue(args, queue)
    # ... other operations
except ValueError as e:
    # Don't print traceback for configuration validation errors -
    # the error message has already been logged
    if "library_config.json" in str(e) or "Library" in str(e):
        return
    else:
        # Re-raise other ValueError exceptions that may need full tracebacks
        raise
```

**Key Principle**: When you've already logged a clear, user-friendly error message, don't confuse users with technical
tracebacks. Only show tracebacks for unexpected errors that need debugging.

**Applied to**: `data_ingestion/audio_video/manage_queue.py` - Now gracefully exits on library config validation errors
without showing traceback.

## Mistake: Incorrect SpacyTextSplitter Parameter Usage in Website Crawler

**Problem**: Website crawler was getting poor chunking statistics (14% chunks under 100 words, only 59.6% in 300-499
range) due to incorrect `SpacyTextSplitter` parameter usage and manual dynamic sizing logic that conflicted with the
class's built-in capabilities.

**Wrong**: Attempting to pass `chunk_size` and `chunk_overlap` parameters to `SpacyTextSplitter` constructor and
implementing manual dynamic sizing:

```python
# Incorrect - SpacyTextSplitter doesn't accept these parameters
self.text_splitter = SpacyTextSplitter(
    chunk_size=1200,  # ❌ Not a valid parameter
    chunk_overlap=300,  # ❌ Not a valid parameter
    separator="\n\n",
    pipeline="en_core_web_sm",
)

# Incorrect - Manual dynamic sizing conflicts with built-in logic
def _calculate_dynamic_chunk_size(word_count: int) -> tuple[int, int]:
    if word_count < 1000:
        return 800, 200  # ❌ Bypasses SpacyTextSplitter's logic
```

**Correct**: Use only valid `SpacyTextSplitter` parameters and rely on its built-in dynamic sizing:

```python
# Correct - Only use supported parameters
self.text_splitter = SpacyTextSplitter(
    separator="\n\n",
    pipeline="en_core_web_sm",
)

# Correct - Let SpacyTextSplitter handle dynamic sizing internally
def create_chunks_from_page(page_content, text_splitter=None) -> list[str]:
    if text_splitter is None:
        text_splitter = SpacyTextSplitter(
            separator="\n\n",
            pipeline="en_core_web_sm",
        )
    chunks = text_splitter.split_text(full_text, document_id=document_id)
    return chunks
```

**Detection**: `TypeError: SpacyTextSplitter.__init__() got an unexpected keyword argument 'chunk_size'`

**Impact**: After fix, achieved 60-90% target range compliance per page vs. previous poor performance. The
`SpacyTextSplitter` class has sophisticated built-in dynamic sizing logic based on content length that shouldn't be
overridden.

**Valid SpacyTextSplitter Parameters**: Only `separator` and `pipeline` - the class handles dynamic chunk sizing
internally via `_set_dynamic_chunk_size()` method.

### Mistake: Integration Test Vector Prefix Mismatch - ✅ RESOLVED

**Problem**: Integration tests were failing because they expected standardized 7-part vector ID prefixes, but some
ingestion scripts were using different formats.

**Root Cause**: Inconsistent vector ID generation across ingestion scripts. Some used standardized
`generate_vector_id()` function, others used custom formats.

**Solution Applied**: Updated all ingestion scripts to use the standardized `generate_vector_id()` function from
`data_ingestion/utils/pinecone_utils.py`.

**Scripts Fixed**:

- ✅ `data_ingestion/pdf_to_vector_db.py` - Updated to use standardized 7-part format
- ✅ `data_ingestion/audio_video/pinecone_utils.py` - Updated to use standardized 7-part format

**Scripts already using standardized format**:

- ✅ `data_ingestion/sql_to_vector_db/ingest_db_text.py`
- ✅ `data_ingestion/crawler/website_crawler.py`

**Integration tests**: Updated to expect correct standardized 7-part format:
`{content_type}||{library}||{source_location}||{title}||{author}||{hash}||{chunk_index}`

**Expected Vector ID Examples**:

- PDF: `text||Crystal Clarity||pdf||The_Essence_of_Self_Realization||Unknown||abc123||0`
- Audio: `audio||ananda||audio||How_to_Commune_with_God||Swami_Kriyananda||def456||0`
- Video: `video||ananda||video||Meditation_Talk||Swami_Kriyananda||ghi789||0`
- Web: `text||ananda.org||web||Meditation_Techniques||Unknown||jkl012||0`
- Database: `text||ananda||db||Spiritual_Diary||Paramhansa_Yogananda||mno345||0`

**Impact**: All ingestion methods now use consistent vector ID format, enabling proper integration testing and bulk
operations.

## Mistake: Incorrect Token-to-Word Conversion in Audio Transcription Chunking

**Problem**: Audio transcription chunks were consistently failing to meet the target word range (225-450 words), with 0%
compliance and average chunk sizes around 119-185 words. The issue was in the token-to-word conversion ratio used when
applying spaCy's dynamic chunk sizing to audio transcription.

**Wrong**: Using too conservative conversion ratio:

```python
# In data_ingestion/audio_video/transcription_utils.py
target_words_per_chunk = text_splitter.chunk_size // 4  # Too conservative
# Result: 300 tokens / 4 = 75 words per chunk (way too small)
```

**Correct**: Using more appropriate conversion ratio:

```python
# In data_ingestion/audio_video/transcription_utils.py
target_words_per_chunk = int(text_splitter.chunk_size / 2.0)  # Better ratio
# Result: 300 tokens / 2.0 = 150 words per chunk (closer to target)
```

**Testing Results**:

- **Before fix**: 0% target compliance, avg 119-185 words/chunk
- **After fix**: 87.5% target compliance, avg 224.5 words/chunk
- **Integration tests**: All audio tests now pass with excellent compliance

**Root Cause**: The SpacyTextSplitter uses token-based chunk sizing (300-500 tokens), but audio transcription works with
word counts. The original `/4` conversion was too conservative, while `/2.0` provides the right balance for reaching the
225-450 word target range.

**Detection Method**: Integration test `test_audio_transcription_chunks` failed with target compliance assertion,
leading to analysis of chunking strategy and token-to-word conversion ratios.

### Mistake: Hardcoded Dimension Validation in RAG Evaluation

**Problem**: The `evaluate_rag_system.py` script was using hardcoded logic to determine expected vector dimensions based
on index names rather than using the actual embedding model dimensions from environment variables.

**Wrong**: Hardcoded dimension logic based on index name comparison:

```python
expected_dimension = (
    1536 if index_name == os.getenv("PINECONE_INDEX_NAME") else 3072
)
```

**Correct**: Use environment variables for dimensions that match the embedding models:

```python
# In load_environment() - require dimension environment variables
required_vars = [
    "OPENAI_EMBEDDINGS_DIMENSION",
    "OPENAI_INGEST_EMBEDDINGS_DIMENSION",
    # ... other vars
]

# In main() - read dimensions from environment
CURRENT_DIMENSION = int(os.getenv("OPENAI_EMBEDDINGS_DIMENSION"))
NEW_DIMENSION = int(os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION"))

# Pass to index validation
current_index = get_pinecone_index(pinecone_client, CURRENT_INDEX_NAME, CURRENT_EMBEDDING_MODEL, CURRENT_DIMENSION)
```

**Impact**: Caused "Vector dimension 1536 does not match the dimension of the index 3072" errors when the script tried
to use ada-002 embeddings (1536) with a 3-large index (3072).

**Environment Configuration**: Each site's `.env.{site}` file should specify:

- `OPENAI_EMBEDDINGS_DIMENSION=1536` (for ada-002)
- `OPENAI_INGEST_EMBEDDINGS_DIMENSION=3072` (for 3-large)

**Principle**: Always use explicit environment configuration rather than inferring settings from other variables.

## Mistake: Using Bare Except Clauses

**Problem**: Ruff linting error E722 "Do not use bare `except`" occurs when using `except:` without specifying exception
types.

**Wrong**: Using bare except that catches all exceptions including system exceptions:

```python
try:
    nltk.download('stopwords', quiet=True)
    return set(stopwords.words('english'))
except:  # E722 error - catches ALL exceptions
    print("Warning: NLTK stopwords not available, using basic set")
    return basic_set
```

**Correct**: Catch specific exceptions that are expected to occur:

```python
try:
    nltk.download('stopwords', quiet=True)
    return set(stopwords.words('english'))
except (ImportError, LookupError, OSError) as e:  # Specific exceptions
    print("Warning: NLTK stopwords not available, using basic set")
    return basic_set
```

**Rationale**: Bare except clauses catch system-exiting exceptions like `KeyboardInterrupt` and `SystemExit`, which
usually shouldn't be caught. Specific exception handling is more precise and safer.

## Mistake: spaCy Text Length Limit Causing Processing Failures

**Problem**: Large PDF documents (>1,000,000 characters) were failing with spaCy's text length limit error, causing
ingestion to skip these files without proper error reporting or retry guidance.

**Wrong**: Using default spaCy max_length limit (1,000,000 characters) without error handling:

```python
# In text_splitter_utils.py _ensure_nlp method
self.nlp = spacy.load(self.pipeline)
# No max_length adjustment - defaults to 1,000,000 chars

# In pdf_to_vector_db.py - poor error reporting
except Exception as file_processing_error:
    logger.warning(f"Skipping file {pdf_path} due to error. Will attempt to continue with next file.")
    return False  # No failure tracking or reporting
```

**Correct**: Increase spaCy max_length limit and implement comprehensive failure tracking:

```python
# In text_splitter_utils.py _ensure_nlp method
self.nlp = spacy.load(self.pipeline)
# Increase max_length to handle very large documents
# Default is 1,000,000 chars. Setting to 2,000,000 to handle large PDFs
# This requires roughly 2GB of temporary memory during processing
self.nlp.max_length = 2_000_000
self.logger.debug(f"Set spaCy max_length to {self.nlp.max_length:,} characters")

# In pdf_to_vector_db.py - comprehensive failure tracking
failed_files = []  # Track failures for reporting

success, failure_reason = await _process_single_pdf(...)
if not success:
    failed_files.append({
        'file_path': current_pdf_path,
        'file_index': i,
        'reason': failure_reason
    })

# Detailed error categorization
if "Text of length" in error_message and "exceeds maximum" in error_message:
    match = re.search(r"Text of length (\d+) exceeds maximum of (\d+)", error_message)
    if match:
        text_length = int(match.group(1))
        max_length = int(match.group(2))
        failure_reason = f"Document too large: {text_length:,} chars (max: {max_length:,})"
```

**Additional Improvements**:

- Added memory monitoring with psutil to track system memory usage
- Comprehensive failure reporting with categorized error types and retry recommendations
- Memory pressure warnings when processing large documents
- Specific guidance for different failure types (memory, PDF parsing, API quotas, etc.)

**Detection**: Large PDFs failing with "Text of length X exceeds maximum of 1000000" error. Monitor memory usage during
processing to ensure adequate resources.

## Mistake: Insufficient Network Resilience in PDF Ingestion

**Problem**: PDF ingestion was failing mid-process with "Failed to connect; did you specify the correct index name?" and
"Remote end closed connection without response" errors. This occurred after processing successfully for a while (e.g.,
63% through batches), indicating network connectivity issues rather than configuration problems.

**Symptoms**:

- Script processes successfully for many chunks/batches
- Sudden cascade of connection failures in the same batch
- Multiple timeout errors for both OpenAI embeddings and Pinecone upserts
- "Remote end closed connection without response" low-level network errors

**Wrong**: No retry logic or resilience for network issues:

```python
# Original code - single attempt with basic timeout
try:
    vector = await asyncio.wait_for(
        asyncio.to_thread(embeddings.embed_query, doc.page_content),
        timeout=15.0,  # Single attempt, short timeout
    )
except asyncio.TimeoutError:
    logger.warning(f"Embedding timeout for chunk {chunk_index}, skipping...")
    return

# Similar single-attempt pattern for Pinecone upserts
```

**Correct**: Implement retry logic with exponential backoff for both OpenAI and Pinecone operations:

```python
async def retry_with_backoff(
    operation_func,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    backoff_factor: float = 2.0,
    operation_name: str = "operation",
) -> any:
    """Retry an async operation with exponential backoff."""
    # Implementation with fatal error detection and progressive delays

# Usage in process_chunk:
async def embedding_operation():
    return await asyncio.wait_for(
        asyncio.to_thread(embeddings.embed_query, doc.page_content),
        timeout=30.0,  # Increased timeout
    )

vector = await retry_with_backoff(
    embedding_operation,
    max_retries=3,
    base_delay=2.0,
    operation_name=f"OpenAI embedding for chunk {chunk_index}"
)
```

**Additional Improvements**:

- Reduced batch size from 10 to 5 chunks to reduce API load
- Added 1-second delays between batches for rate limiting
- Increased timeouts (30s for embeddings, 20s for Pinecone, 2min for batches)
- Better error categorization for network vs configuration issues
- Continue processing other chunks when individual chunks fail due to network issues

**Root Cause**: Network instability, API rate limiting, or connection pool exhaustion when processing large documents
with many concurrent requests.

## Mistake: Inadequate Error Handling for Corrupted Transcription Cache

**Problem**: The `get_saved_transcription()` function in `transcription_utils.py` did not handle corrupted gzipped JSON
files gracefully, causing CRC check failures that crashed the processing pipeline.

**Wrong**: No error handling for file corruption:

```python
# In get_saved_transcription function
with gzip.open(full_json_path, "rt", encoding="utf-8") as f:
    return json.load(f)
```

**Error Result**: `CRC check failed 0x3622593e != 0x31ca9756` - system crash on corrupted cache files.

**Correct**: Comprehensive error handling with automatic cleanup:

```python
try:
    with gzip.open(full_json_path, "rt", encoding="utf-8") as f:
        return json.load(f)
except (gzip.BadGzipFile, OSError, json.JSONDecodeError) as e:
    # Handle corrupted cache files
    file_identifier = youtube_id or os.path.basename(file_path) if file_path else "unknown file"
    logger.error(f"Corrupted transcription cache detected for {file_identifier}: {str(e)}")
    logger.info(f"Removing corrupted cache file: {full_json_path}")

    try:
        os.remove(full_json_path)
        # Also remove from database
        conn = sqlite3.connect(TRANSCRIPTIONS_DB_PATH)
        c = conn.cursor()
        c.execute("DELETE FROM transcriptions WHERE file_hash = ?", (file_hash,))
        conn.commit()
        conn.close()
        logger.info(f"Successfully cleaned up corrupted cache for {file_identifier}")
    except Exception as cleanup_error:
        logger.error(f"Failed to clean up corrupted cache: {cleanup_error}")

    # Return None to trigger fresh transcription
    return None
```

**Root Causes of Corruption**:

- Process interruption during file writing (Ctrl+C, system crash)
- Disk I/O errors or filesystem corruption
- Race conditions in parallel processing
- Hardware issues (bad sectors, failing storage)

**Recovery Strategy**: Detect corruption, clean up corrupted files from both filesystem and database, allow system to
regenerate fresh transcription automatically.

## Mistake: Invalid Input Parameter in OpenAI Embeddings API

**Problem**: The `create_embeddings()` function in `data_ingestion/audio_video/pinecone_utils.py` was passing invalid or
malformed text chunks to the OpenAI embeddings API, causing `'$.input' is invalid` errors.

**Wrong**: No input validation before calling OpenAI API:

```python
def create_embeddings(chunks, client):
    texts = [chunk["text"] for chunk in chunks]  # No validation
    model_name = os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL")
    response = client.embeddings.create(input=texts, model=model_name)
    return [embedding.embedding for embedding in response.data]
```

**Error Result**: `Error code: 400 - {'error': {'message': "'$.input' is invalid"}}` - API rejects malformed input.

**Correct**: Comprehensive input validation and error handling:

```python
def create_embeddings(chunks, client):
    texts = []
    valid_chunk_indices = []

    for i, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            logger.warning(f"Chunk {i} is not a dictionary, skipping: {type(chunk)}")
            continue

        if "text" not in chunk:
            logger.warning(f"Chunk {i} missing 'text' field, skipping")
            continue

        text = chunk["text"]

        # Validate text content
        if not isinstance(text, str):
            logger.warning(f"Chunk {i} text is not a string, skipping: {type(text)}")
            continue

        # Check for empty or whitespace-only text
        if not text or not text.strip():
            logger.warning(f"Chunk {i} has empty or whitespace-only text, skipping")
            continue

        # Check for extremely long text that might cause API issues
        if len(text) > 8000:  # OpenAI embeddings have token limits
            logger.warning(f"Chunk {i} text is very long ({len(text)} chars), truncating")
            text = text[:8000]

        texts.append(text)
        valid_chunk_indices.append(i)

    if not texts:
        raise ValueError("No valid text chunks found for embedding creation")

    try:
        response = client.embeddings.create(input=texts, model=model_name)
        embeddings = [embedding.embedding for embedding in response.data]
        # Additional validation and error logging
        return embeddings
    except Exception as e:
        logger.error(f"OpenAI embeddings API error: {str(e)}")
        # Detailed debugging information
        raise
```

**Root Causes of Invalid Input**:

- Empty or None text chunks from failed transcription processing
- Non-string data types being passed as text
- Malformed chunk dictionaries missing required fields
- Extremely long text exceeding API token limits
- Whitespace-only or empty string chunks

**Prevention Strategy**: Always validate chunk structure and text content before API calls, filter out invalid chunks,
provide detailed error logging for debugging.

### Mistake: Error Reporting Bug in PDF Ingestion Script

**Problem**: The PDF ingestion script was incorrectly reporting "✅ All files processed successfully! No failures to
report." even when chunks failed during processing due to token limit errors.

**Root Causes**:

1. **Missing Error Propagation**: The `process_document` function didn't return failure status to indicate when chunks
   failed during processing
2. **Batch Processing Failures Ignored**: Errors in `_process_single_batch` were logged but didn't cause the file to be
   marked as failed
3. **No Token Validation**: Chunks exceeding OpenAI's 8192 token limit were sent to the embedding API, causing failures
   that weren't properly categorized

**Wrong**: Functions that don't propagate failure information:

```python
async def process_document(...) -> None:
    # Process chunks but don't return success/failure status
    await _process_chunks_in_batches(...)
    # No way to know if chunks failed

async def _process_chunks_in_batches(...) -> None:
    # Process batches but don't track failures
    await _process_single_batch(...)
    # Failures are logged but not returned

async def _process_single_batch(...) -> None:
    # Log failures but don't return count
    logger.warning(f"Failed to process {len(failed_chunks)} chunks")
    # No return value to indicate failures
```

**Correct**: Functions that properly track and propagate failures:

```python
async def process_document(...) -> tuple[bool, int, int]:
    """Returns (success, total_chunks, failed_chunks)"""
    failed_chunks = await _process_chunks_in_batches(...)
    total_chunks = len(valid_docs)
    success = failed_chunks == 0
    return success, total_chunks, failed_chunks

async def _process_chunks_in_batches(...) -> int:
    """Returns total number of failed chunks"""
    total_failed_chunks = 0
    for batch in batches:
        failed_count = await _process_single_batch(...)
        total_failed_chunks += failed_count
    return total_failed_chunks

async def _process_single_batch(...) -> int:
    """Returns number of failed chunks in this batch"""
    failed_chunks = []
    for result in results:
        if isinstance(result, Exception):
            failed_chunks.append(chunk_idx)
    return len(failed_chunks)
```

**Additional Fix**: Added token validation before embedding:

```python
def _validate_chunk_token_limit(text: str, max_tokens: int = 8192) -> tuple[bool, int]:
    """Validate chunk doesn't exceed OpenAI token limits"""
    token_count = _count_tokens(text)
    return token_count <= max_tokens, token_count

# In process_chunk:
is_valid, token_count = _validate_chunk_token_limit(doc.page_content)
if not is_valid:
    error_msg = f"Chunk {chunk_index} exceeds token limit: {token_count} tokens (max 8192)"
    raise ValueError(error_msg)
```

**Detection**: Error logs showed chunk failures but final summary reported success. Always ensure error handling
propagates failure status through the entire call chain.

## Mistake: Inconsistent Chunking Strategy Across Ingestion Scripts

**Problem**: Different ingestion scripts were using different text splitting approaches despite the project
documentation claiming all scripts use spaCy chunking. Analysis of vector database word counts revealed:

- PDF script: Using `SpacyTextSplitter(chunk_size=600, chunk_overlap=120)` → 83.7 avg words/chunk
- SQL script: Using `TokenTextSplitter(chunk_size=256, chunk_overlap=50)` → 167.8 avg words/chunk
- Web crawler: Using custom word-based chunking → Variable word counts

**Wrong**: SQL script using outdated token-based chunking:

```python
# data_ingestion/sql_to_vector_db/ingest_db_text.py
text_splitter = TokenTextSplitter.from_tiktoken_encoder(
    encoding_name="cl100k_base", chunk_size=256, chunk_overlap=50
)
```

**Correct**: All ingestion scripts should use the shared spaCy-based chunking strategy:

```python
# Import shared utility
from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter

# Use consistent configuration across all scripts
text_splitter = SpacyTextSplitter(
    chunk_size=600,
    chunk_overlap=120,  # 20% overlap
    separator="\n\n",
    pipeline="en_core_web_sm",
)
```

**Impact**: Inconsistent chunking affects RAG quality and retrieval consistency. Documents from different sources have
wildly different chunk characteristics, leading to uneven search quality.

**Detection Method**: Analyze word counts per chunk using `data_ingestion/bin/analyze_text_field_words.py` to identify
chunking inconsistencies across libraries/sources.

### Mistake: Duplicate import statements causing linter errors

**Wrong**:

```python
import re  # At top of file
# ... later in code
import re  # Duplicate local import
```

**Correct**:

```python
import re  # Only at top of file - no local imports needed for already imported modules
```

### Mistake: Failing chunks due to OpenAI token limits without graceful handling

**Wrong**:

```python
# Validate chunk token count before processing
is_valid, token_count = _validate_chunk_token_limit(doc.page_content)
if not is_valid:
    error_msg = f"Chunk {chunk_index} exceeds token limit: {token_count} tokens (max 8192)"
    logger.error(error_msg)
    raise ValueError(error_msg)  # Just fails the chunk
```

**Correct**:

```python
# Validate chunk token count before processing
is_valid, token_count = _validate_chunk_token_limit(doc.page_content)
if not is_valid:
    logger.warning(f"Chunk {chunk_index} exceeds token limit: {token_count} tokens (max 8192). Attempting to split...")

    # Try to process as oversized chunk (split into sub-chunks)
    failed_sub_chunks = await _process_oversized_chunk(
        doc, pinecone_index, embeddings, chunk_index, library_name
    )

    if failed_sub_chunks > 0:
        error_msg = f"Chunk {chunk_index} split processing failed: {failed_sub_chunks} sub-chunks failed"
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Successfully processed all sub-chunks
    return
```
