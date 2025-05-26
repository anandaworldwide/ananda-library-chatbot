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

**Wrong**:

```python
# Using relative path calculation that might be unreliable
import sys
import os
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
```

**Correct**:

```python
# Directly calculate the absolute paths for reliable import resolution
import sys
import os
# Get the absolute path of the current script
current_dir = os.path.dirname(os.path.abspath(__file__))
# Get the parent directory of the package directory
parent_dir = os.path.dirname(os.path.dirname(current_dir))
# Add parent directory to Python path
sys.path.insert(0, parent_dir)
```

This solution ensures that Python can find the parent package when a script is run directly using `./script.py` from
within its directory.

### Mistake: ModuleNotFoundError for Local Modules in Scripts

**Situation**: When running a Python script from a subdirectory (e.g., `bin/myscript.py`) that imports a local module
from another directory at the project root level (e.g., `pyutil/some_module.py`), a `ModuleNotFoundError` can occur
because the script's directory is not automatically part of Python's search path for modules in the way that the current
working directory is when you run `python -m`.

**Wrong**: Script `bin/evaluate_rag_system.py` trying to import `from pyutil.env_utils import load_env` might fail if
`bin/` is not the current working directory or if `pyutil` is not in a location Python automatically searches (like
`site-packages`).

**Correct**: To reliably import local modules from other directories within the same project, explicitly add the
project's root directory (or the specific directory containing the module) to `sys.path` at the beginning of the script.

**Example Snippet (`bin/evaluate_rag_system.py`)**:

```python
#!/usr/bin/env python3
import os
import sys

# Add project root to Python path
# Assumes the script is in a subdirectory like 'bin' one level down from project root
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

# Now, imports like this should work:
from pyutil.env_utils import load_env

# ... rest of the script ...
```

This ensures that Python can find the `pyutil` directory (and other modules at the project root) regardless of how or
from where the script is executed.

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

**Problem**: The `generate_vector_id` function in `ingest_db_text.py` was using overly aggressive sanitization that
stripped out valid ASCII punctuation marks that Pinecone actually allows.

**Wrong**: Removing all non-alphanumeric characters except underscore and hyphen:

```python
# Overly restrictive - removes valid punctuation
sanitized_title = re.sub(r"\s+", "_", title)
sanitized_title = re.sub(r"[^a-zA-Z0-9_\-]", "", sanitized_title)
```

This stripped out colons, percent signs, hash symbols, and other valid ASCII characters, causing:

- Unnecessary data loss in titles
- Reduced readability ("How to Meditate: A Guide" → "HowtoMeditateAGuide")
- Potential ID collisions from over-sanitization

**Correct**: Only remove null characters (the only character Pinecone prohibits):

```python
# Conservative sanitization - preserve meaningful punctuation
sanitized_title = re.sub(r"\s+", " ", title.strip())  # Normalize whitespace
sanitized_title = re.sub(r"\x00", "", sanitized_title)  # Remove null characters only
```

**Pinecone Record ID Requirements**: ASCII except `\0` - spaces and punctuation ARE allowed.

**Impact**: Preserves meaningful title information while maintaining Pinecone compatibility. Updated tests to verify
punctuation preservation and null character removal.

## Shared Vector ID Generation Implementation

**Context**: Successfully consolidated vector ID generation across all ingestion methods into a shared utility in
`pinecone_utils.py` to ensure consistency and reduce code duplication.

**Implementation Details**:

- **Location**: Added vector ID functions to `data_ingestion/utils/pinecone_utils.py` (better than separate file)
- **Format**:
  `{library}||{source_location}||{content_type}||{sanitized_title}||{source_id}||{content_hash}||{chunk_index}`
- **Key Feature**: Chunk index comes after content hash for easy prefix-based deletion
- **Sanitization**: Only removes null characters (\x00), preserves all other ASCII including punctuation
- **Functions Added**:
  - `generate_vector_id()` - Main generation function
  - `_sanitize_text()` - Conservative sanitization helper
  - `extract_metadata_from_vector_id()` - Parsing utility

**Benefits**:

- **Consistency**: All ingestion methods now use identical vector ID format
- **Prefix Deletion**: Can delete all chunks for a title using prefix like `audio||Library||title||hash||`
- **Richer metadata**: Can filter by both where data came from AND what type it is
- **Clean chunk numbering**: Simple integers like `0`, `1`, `2`

**Example Results**:

- Database text: `Test Library||db||text||Article Title||Test Author||4b2ce3cb||0`
- Audio file: `Ananda Sangha||file||audio||How to Commune with God||Swami Kriyananda||5b2a1057||4`

**Testing**: All 20 tests in `test_ingest_db_text.py` pass, confirming backward compatibility and correct
implementation.

## Vector ID Format Update - 7-Part Structure Implementation

**Context**: Successfully updated the vector ID format from 5-part to 7-part structure for better organization and
prefix-based deletion capabilities.

**Changes Made**:

1. **Updated `generate_vector_id()` function signature** in `data_ingestion/utils/pinecone_utils.py`:

   - Changed `source_type` parameter to `source_location`
   - Added new `content_type` parameter with default "text"
   - Updated parameter order and documentation

2. **New Vector ID Format**:

   ```
   {library}||{source_location}||{content_type}||{sanitized_title}||{source_id}||{content_hash}||{chunk_index}
   ```

3. **Updated `extract_metadata_from_vector_id()`** to parse 7 parts instead of 5

4. **Updated SQL ingestion wrapper** in `ingest_db_text.py` to use new parameters:

   ```python
   return shared_generate_vector_id(
       library_name=library_name,
       title=title,
       content_chunk=content_chunk,
       chunk_index=chunk_index,
       source_location="db",
       content_type="text",
       source_id=author,
   )
   ```

5. **Updated tests** to expect 7-part format and correct title position (index 3)

**Benefits Achieved**:

- **Better organization**: Clear separation between source location and content type
- **Perfect prefix deletion**: `Test Library||db||text||Article Title||Test Author||a1b2c3d4||`
- **Richer metadata**: Can filter by both where data came from AND what type it is
- **Clean chunk numbering**: Simple integers like `0`, `1`, `2`

**Example Results**:

- Database text: `Test Library||db||text||Article Title||Test Author||4b2ce3cb||0`
- Audio file: `Ananda Sangha||file||audio||How to Commune with God||Swami Kriyananda||5b2a1057||4`

**Testing**: All 20 tests in `test_ingest_db_text.py` pass, confirming backward compatibility and correct
implementation.

## Mistake: Messy Vector ID Function Wrappers

**Problem**: The SQL ingestion file had a confusing mix of local wrapper functions and renamed imports for vector ID
generation, creating unnecessary complexity and maintenance burden.

**Wrong**: Creating local wrapper functions that just call shared utilities:

```python
# Local wrapper function (unnecessary)
def generate_vector_id(
    library_name: str,
    title: str,
    content_chunk: str,
    chunk_index: int,
    author: str = None,
    permalink: str = None,
) -> str:
    # Import shared utility from pinecone_utils
    from data_ingestion.utils.pinecone_utils import (
        generate_vector_id as shared_generate_vector_id,
    )

    # Use shared utility with database source location and text content type
    return shared_generate_vector_id(
        library_name=library_name,
        title=title,
        content_chunk=content_chunk,
        chunk_index=chunk_index,
        source_location="db",
        content_type="text",
        source_id=author,
    )
```

**Correct**: Import and use the shared function directly:

```python
# At top of file
from data_ingestion.utils.pinecone_utils import generate_vector_id

# In code
pinecone_id = generate_vector_id(
    library_name=post_data["library"],
    title=post_data["title"],
    content_chunk=doc.page_content,
    chunk_index=i,
    source_location="db",
    content_type="text",
    source_id=post_data["author"],
)
```

**Benefits**:

- **Eliminates code duplication**: No need for wrapper functions
- **Reduces complexity**: Direct imports are clearer than renamed aliases
- **Easier maintenance**: Changes to shared function don't require updating wrappers
- **Better readability**: Clear what function is being called and where it comes from

**Test Updates**: Updated test calls to use the new parameter names and structure, ensuring all 20 tests continue to
pass.

### Mistake: Referencing Non-Existent Environment Variables

**Wrong**:

```python
def load_environment(site_name: str) -> dict:
    # ... validation code ...
    return {
        'user': os.getenv('DB_USER'),
        'password': os.getenv('DB_PASSWORD'),
        'host': os.getenv('DB_HOST'),
        'database': os.getenv('DB_NAME'),  # DB_NAME doesn't exist in environment
        'port': int(os.getenv('DB_PORT', '3306')),  # DB_PORT doesn't exist in environment
        'raise_on_warnings': True
    }
```

**Correct**:

```python
def load_environment(site_name: str) -> dict:
    # ... validation code ...
    return {
        'user': os.getenv('DB_USER'),
        'password': os.getenv('DB_PASSWORD'),
        'host': os.getenv('DB_HOST'),
        'raise_on_warnings': True
    }

# Database name comes from command line args, not environment
def get_db_config(args):
    return {
        'user': os.getenv('DB_USER'),
        'password': os.getenv('DB_PASSWORD'),
        'host': os.getenv('DB_HOST'),
        'database': args.database,  # From command line argument
        'port': int(os.getenv('DB_PORT', '3306')),  # Optional with default
        # ... other config
    }
```

**Principle**: Only reference environment variables that actually exist. Check the actual environment setup and existing
code patterns before assuming variables exist.

## Mistake: Audio/Video Script Accessing Non-Existent Library Argument

**Wrong**: The `transcribe_and_ingest_media.py` script was trying to access `args.library` without defining the
`--library` argument in the argument parser:

```python
# Later in code - trying to use undefined attribute
if args.clear_vectors:
    clear_library_vectors(index, args.library, ask_confirmation=False)
```

**Correct**: Get library information from the queue items instead of command line arguments:

```python
if args.clear_vectors:
    # Get unique libraries from queue items
    all_items = ingest_queue.get_all_items()
    libraries = set()
    for item in all_items:
        if item.get("data", {}).get("library"):
            libraries.add(item["data"]["library"])

    if not libraries:
        logger.warning("No libraries found in queue items. Skipping vector clearing.")
    else:
        for library in libraries:
            logger.info(f"Clearing vectors for library: {library}")
            clear_library_vectors(index, library, ask_confirmation=False)
```

**Error**: `AttributeError: 'Namespace' object has no attribute 'library'` when running with `--clear-vectors` flag.

**Root Cause**: The script was importing `clear_library_vectors` from the outdated audio_video module instead of the
robust utils version, AND trying to access a non-existent `args.library` attribute. The library information is actually
stored in the queue items managed by the queue system.

**Fix Applied**:

1. Updated import to use `data_ingestion.utils.pinecone_utils.clear_library_vectors`
2. Modified clear_vectors logic to extract library names from queue items instead of command line arguments
3. Added logic to handle multiple libraries and skip clearing if no libraries found

### Mistake: Using sys.path Hacks Instead of Proper Module Execution

**Problem**: Multiple Python scripts across the project use a sys.path manipulation hack to import modules from the
project root:

```python
# Get the absolute path of the current script
current_dir = os.path.dirname(os.path.abspath(__file__))
# Get the parent directory of data_ingestion
parent_dir = os.path.dirname(os.path.dirname(current_dir))
# Add parent directory to Python path
sys.path.insert(0, parent_dir)

from data_ingestion.audio_video.IngestQueue import IngestQueue
```

This causes Ruff E402 linting errors ("Module level import not at top of file") and is a code smell.

**Root Cause**: Scripts are being executed directly from their subdirectories instead of as modules from the project
root.

**Wrong**: Running scripts directly from subdirectories:

```bash
cd data_ingestion/audio_video
./manage_queue.py -s dev -l
```

**Correct**: Run scripts as modules from project root:

```bash
python -m data_ingestion.audio_video.manage_queue -s dev -l
```

**Why This Works**:

- Project already has proper package structure with `__init__.py` files
- `pyproject.toml` declares `data_ingestion` and `pyutil` as first-party packages
- Python treats the project as a proper package when using `-m` flag
- All imports work naturally without path manipulation
- Imports can be moved to the top of files, fixing linting errors

**Alternative Solutions**:

1. Set PYTHONPATH environment variable to project root
2. Install project as editable package with `pip install -e .`

**Files Affected**: All scripts in `data_ingestion/`, `bin/`, and subdirectories that use the sys.path hack.

### Finding: Python Script Import Resolution from Project Root

**Situation**: User encountered `ModuleNotFoundError: No module named 'pyutil'` when running a script in the `bin/`
directory that imports from the `pyutil` package located at the project root level.

**Initial Error**: Running `bin/find_records_by_category.py` directly from the project root resulted in import errors,
even though the script was executable and had proper shebang.

**Root Cause**: The issue was likely related to virtual environment activation or temporary Python path issues, not the
script structure itself.

**Correct Approach**: The project is properly structured with:

- `pyutil` listed as a first-party package in `pyproject.toml`
- Scripts in `bin/` directory with proper shebang (`#!/usr/bin/env python`)
- Executable permissions on scripts

**Proper Usage**: Scripts should be run from the project root directory:

```bash
# From project root - this works correctly
bin/find_records_by_category.py --site ananda --category "some-category"
```

**Why This Works**: When running an executable Python script from the project root, the current directory (containing
`pyutil/`) is automatically added to Python's module search path, making the import resolution work correctly.

**Avoid**: Using `sys.path.append()` hacks that some existing scripts currently use - the proper project structure
already handles this correctly.

## Mistake: PDF Text Concatenation Causing Section Header Mashing

**Problem**: PDF ingestion was concatenating pages with only `"\n\n"` separators, causing section headers and content to
be mashed together without proper spacing. This resulted in text like "combat23 Control Your Destiny" where "combat" was
the end of one page and "23 Control Your Destiny" was a section header on the next page.

**Wrong**: Simple concatenation with fixed separator:

```python
# Add spacing between pages (but no page markers)
if page_index > 0:
    page_separator = "\n\n"
    full_text_parts.append(page_separator)
    current_offset += len(page_separator)
```

**Correct**: Intelligent page separator determination based on text flow:

```python
# Add intelligent spacing between pages
if page_index > 0:
    # Get the last few characters of the previous page
    previous_text = full_text_parts[-1] if full_text_parts else ""

    # Determine appropriate separator based on text flow
    page_separator = _determine_page_separator(previous_text, page_text)
    full_text_parts.append(page_separator)
    current_offset += len(page_separator)
```

**Solution**: Added `_determine_page_separator()` function that analyzes:

- Whether previous text ends with sentence-ending punctuation
- Whether current text starts with capital letter or number
- Whether current text appears to be a section header
- Whether previous text ends with hyphen (word split across pages)
- Whether text appears to be a continuation of the same sentence

**Detection**: User reported examples of mashed text where section headers were concatenated without proper spacing,
affecting readability and chunking quality.

## PDF Header/Footer Filtering Enhancement

**Problem**: PDF text extraction was including headers and footers, causing text flow disruption where page numbers and
headers would break up sentences (e.g., "combat23 Control Your Destiny" instead of "combat them. Extraordinary...").

**Solution**: Enhanced PyMuPDF-based PDF loader with intelligent header/footer detection using:

1. **Position-based filtering**: Top 10% and bottom 10% of page regions
2. **Font property analysis**: Lighter colors, smaller fonts compared to body text
3. **Content pattern recognition**: Page numbers, chapter headers, book titles
4. **Structured text extraction**: Using PyMuPDF's `get_text("dict")` for detailed font/position data

**Key Features**:

- `_is_header_footer_text()`: Multi-criteria detection of headers/footers
- `_determine_page_separator()`: Smart page joining with proper spacing
- Configurable thresholds for position and font-based filtering
- Pattern matching for common header/footer content

**Note**: This approach was superseded by switching to pdfplumber, which provides better overall text extraction
quality.

## PDF Text Extraction Library Switch - COMPLETED

**Problem**: PyMuPDF was producing garbled text with headers/footers interrupting content flow, causing issues like
"combat23 Control Your Destiny" and "N n nIdleness" appearing in extracted text.

**Solution**: Successfully switched from PyMuPDF to pdfplumber for PDF text extraction.

**Key Benefits of pdfplumber**:

- Much cleaner text extraction with better layout understanding
- Better handling of complex PDF layouts
- More accurate text flow preservation
- Reduced header/footer contamination

**Implementation**: Replaced PyMuPDF (`fitz`) with pdfplumber in `PyPDFLoader` class:

- Uses `pdfplumber.open()` instead of `fitz.open()`
- Extracts text with `page.extract_text()` instead of `page.get_text()`
- Maintains same document structure and metadata handling
- Added `_clean_text_artifacts()` method for additional text cleaning

**Results**: Testing with "Renunciate Order for New Age" PDF showed:

- 48 pages extracted successfully
- Clean title extraction: "Renunciate Order for New Age"
- No garbled artifacts or header/footer contamination
- Proper text flow preservation

**Status**: PDF text extraction quality issue resolved. Ready for production use.
