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
# data_ingestion/sql_to_vector_db/ingest-db-text.py
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

### Rule: Add File Header Comment

**Requirement**: Always add a brief, descriptive comment at the top of any new or modified file, explaining its purpose.

**Example**:

```python
# /path/to/file.py
# This script performs X, Y, and Z.
```

```typescript
// /path/to/file.ts
// This module is responsible for A, B, and C.
```

### Mistake: PDF Metadata Extraction Not Working for Author and Title

**Situation**: PDF documents were being ingested into the vector database with "Unknown" author and "Untitled" title,
even though the PDF metadata contained valid author and title information.

**Wrong**:

```python
# In process_document function - incomplete field name checking
pdf_info = raw_doc.metadata.get('pdf', {}).get('info', {})
if isinstance(pdf_info, dict):
    source_url = pdf_info.get('Subject')  # Only checked 'Subject', not 'subject'
    title = pdf_info.get('Title', 'Untitled')  # Only checked 'Title', not 'title'
    # No author extraction at all!
```

**Correct**:

```python
# Extract title - check multiple possible field names
title_fields = ['title', 'Title', 'subject', 'Subject']
for field in title_fields:
    if field in pdf_info and pdf_info[field] and pdf_info[field].strip():
        title = pdf_info[field].strip()
        break

# Extract author - check multiple possible field names
author_fields = ['author', 'Author', 'creator', 'Creator']
for field in author_fields:
    if field in pdf_info and pdf_info[field] and pdf_info[field].strip():
        author = pdf_info[field].strip()
        break

# Extract source URL - check both lowercase and uppercase
if pdf_info.get('subject') and pdf_info['subject'].strip():
    source_url = pdf_info['subject'].strip()
elif pdf_info.get('Subject') and pdf_info['Subject'].strip():
    source_url = pdf_info['Subject'].strip()
```

**Key Learning**: PDF metadata field names can be case-sensitive and vary between documents. Always check multiple
possible field name variations (lowercase, uppercase) and extract all relevant metadata fields (title, author, source
URL).

### Mistake: Overly Aggressive Text Cleaning Regex Patterns

**Wrong**:

```python
# Fix single letters or short fragments isolated by newlines
# This handles cases like "Yo\nd\nYogananda" -> "Yogananda"
text = re.sub(r'\b(\w{1,2})\s*\n\s*(\w{1,2})\s*\n\s*(\w+)', r'\1\2\3', text)
text = re.sub(r'\b(\w{1,2})\s*\n\s*(\w+)', r'\1\2', text)
```

**Correct**:

```python
# Only fix hyphenated words split across lines (safe pattern)
text = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', text)
# Remove the aggressive short-fragment patterns - they risk combining separate words
# like "I\nAm\nHappy" -> "IAmHappy" or "A\nNew\nDay" -> "ANewDay"
```

These aggressive patterns are only appropriate for OCR text with scanning artifacts. For normal text, they risk
incorrectly combining legitimate separate words like pronouns, articles, and prepositions.

### Mistake: PDF Page-by-Page Processing Causing Poor Chunking Quality

**Problem**: Processing PDFs page-by-page in `pdf_to_vector_db.py` caused several chunking quality issues:

- Broken paragraphs at page boundaries
- Context loss across pages
- Small trailing chunks at end of pages
- Suboptimal spaCy chunking decisions due to lack of full document context
- Overwriting chunks due to restarted chunk indexing per page

**Wrong**:

```python
# Processing each page separately
for page_index, page_doc in enumerate(pages_from_pdf):
    await process_document(
        page_doc, pinecone_index, embeddings,
        page_index, library_name, text_splitter
    )
```

**Correct**:

```python
# Process entire PDF as one document
# Concatenate all page content and track page boundaries for metadata
full_text_parts = []
page_boundaries = []
current_offset = 0

for page_index, page_doc in enumerate(pages_from_pdf):
    if page_doc.page_content and page_doc.page_content.strip():
        page_text = page_doc.page_content.strip()

        # Add spacing between pages (but no page markers in text)
        if page_index > 0:
            page_separator = "\n\n"
            full_text_parts.append(page_separator)
            current_offset += len(page_separator)

        # Track this page's boundaries for metadata
        start_offset = current_offset
        full_text_parts.append(page_text)
        current_offset += len(page_text)
        end_offset = current_offset

        page_boundaries.append({
            'page_number': page_index + 1,
            'start_offset': start_offset,
            'end_offset': end_offset
        })

# Create single document with clean text (no page markers)
full_document = Document(
    page_content="".join(full_text_parts),
    metadata={
        **first_page.metadata.copy(),
        'page_boundaries': page_boundaries,
        'total_pages': len(pages_from_pdf)
    }
)

# Process complete document - chunks get page info in metadata
await process_document(
    full_document, pinecone_index, embeddings,
    0, library_name, text_splitter
)
```

This approach preserves context across page boundaries, keeps text content clean, and stores page reference information
in chunk metadata (e.g., `page_reference: "Page 5"` or `page_reference: "Pages 5-6"` for chunks spanning multiple
pages).

## Mistake: Sentence Splitting Should Preserve Punctuation

**Wrong**: Initial implementation removed trailing punctuation from the last sentence for consistency:

```python
def split_into_sentences(text: str) -> list[str]:
    # Basic sentence splitting on common punctuation
    sentences = re.split(r'[.!?]+\\s+', text)

    # Handle the last sentence which might still have trailing punctuation
    if sentences and sentences[-1]:
        # Remove trailing punctuation from the last sentence
        sentences[-1] = re.sub(r'[.!?]+$', '', sentences[-1])

    return sentences

# Test expectation:
assert result == ["First sentence", "Second sentence", "Third sentence"]
```

**Correct**: Keep punctuation on ALL sentences (Option A) for more natural text processing:

```python
def split_into_sentences(text: str) -> list[str]:
    # Use regex that preserves punctuation with sentences
    sentences = re.split(r'(?<=[.!?])\\s+', text)

    # Clean up and filter out empty sentences (no punctuation removal)
    sentences = [s.strip() for s in sentences if s.strip()]

    return sentences

# Test expectation:
assert result == ["First sentence.", "Second sentence.", "Third sentence."]
```

**Principle**: User preference was to preserve natural punctuation rather than normalize it away.

## Mistake: Unused Pinecone Imports Causing Dependency Conflicts

**Wrong**: Including unused imports from Pinecone internal modules that may not be available:

```python
from pinecone.core.grpc.protos.vector_service_pb2 import Vector
```

This causes `ModuleNotFoundError: No module named 'protoc_gen_openapiv2'` during testing.

**Correct**: Only import what is actually used in the code:

```python
from pinecone import Pinecone, NotFoundException, Index
from pinecone import ServerlessSpec
```

**Principle**: Import only what you use to avoid dependency conflicts and reduce import overhead.

## Mistake: Python Import Issues in Data Ingestion Scripts

**Wrong**: Importing unused or incorrect database connector modules, and complex redundant path manipulation for shared
utilities import:

```python
#!/usr/bin/env python
import mysql.connector  # Module not installed, causes ModuleNotFoundError
# Complex nested try/except for path manipulation
try:
    # Running from workspace root
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
    from pyutil.env_utils import load_env
except ImportError:
    # Running from data_ingestion/sql_to_vector_db
    try:
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
        from pyutil.env_utils import load_env
    except ImportError:
        print("Error: Could not find the 'pyutil' module...")
        sys.exit(1)
```

**Correct**: Use only required modules and consistent simple path manipulation:

```python
#!/usr/bin/env python3
import pymysql  # Use the actual installed connector
# Simple, consistent path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(os.path.dirname(current_dir))  # Go to project root
sys.path.insert(0, parent_dir)

from pyutil.env_utils import load_env
from data_ingestion.utils.text_processing import remove_html_tags, replace_smart_quotes
```

**Key Points**:

- Only import modules that are actually installed (`pymysql` instead of `mysql.connector`)
- Use consistent path manipulation to reach project root: `parent_dir = os.path.dirname(os.path.dirname(current_dir))`
- Import shared utilities after setting the path correctly
- Prefer simple, readable path setup over complex try/except blocks

## Mistake: PDF to Vector DB Script Refactoring - Function Signature Updates

**Context**: When refactoring the PDF to vector DB script to use shared utilities, several function signatures needed to
be updated to match the shared utility interfaces.

**Key Changes Made**:

- **Embeddings**: Replaced custom `OpenAIEmbeddings` class with shared `OpenAIEmbeddings` from `embeddings_utils`
- **Async Methods**: Updated to use `embed_query_async()` instead of `embed_query()` for async operations
- **Pinecone Operations**: Replaced custom Pinecone functions with shared utilities:
  - `get_pinecone_client()` from `pinecone_utils`
  - `create_pinecone_index_if_not_exists_async()` from `pinecone_utils`
  - `clear_library_vectors_async()` from `pinecone_utils`
  - `get_pinecone_ingest_index_name()` from `pinecone_utils`
- **Checkpoint Management**: Replaced custom checkpoint functions with `pdf_checkpoint_integration()` from
  `checkpoint_utils`
- **Signal Handling**: Replaced custom signal handler with `setup_signal_handlers()` from `progress_utils`

**Test Updates**: After moving functions to shared utilities, the original tests became obsolete. Removed tests for
functions that:

- Were moved to shared utilities (already tested there with 207 total tests)
- No longer exist in the PDF script after refactoring
- Kept only tests for functions still unique to the PDF script (`process_document`, `process_chunk`)

**Final Result**: Script successfully refactored to use shared utilities with 4 passing tests for remaining unique
functions.

## Mistake: Unit Test Mocking for Async Functions

**Wrong**: When testing async functions that check global flags like `is_exiting`, only patching the flag in one
location.

```python
patch("data_ingestion.utils.progress_utils.is_exiting", False)
```

**Correct**: Patch the flag in both the shared utility module and the module under test to ensure all references are
properly mocked.

```python
patch("data_ingestion.utils.progress_utils.is_exiting", False),
patch("pdf_to_vector_db.is_exiting", False)
```

## Mistake: Using await with Synchronous Functions

**Wrong**: Using `await` with synchronous functions that return regular values instead of coroutines:

```python
# In data_ingestion/pdf_to_vector_db.py
# save_checkpoint_func is a synchronous function that returns bool
await save_checkpoint_func(i)  # TypeError: object bool can't be used in 'await' expression
```

**Correct**: Use synchronous functions directly without `await`:

```python
# In data_ingestion/pdf_to_vector_db.py
# save_checkpoint_func is synchronous, call it directly
save_checkpoint_func(i)  # Returns bool directly
```

**Principle**: Always check function signatures and return types. If a function returns a regular value (like `bool`,
`str`, `int`) rather than a coroutine, it should be called synchronously without `await`. Only use `await` with async
functions that return coroutines or awaitable objects.

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
