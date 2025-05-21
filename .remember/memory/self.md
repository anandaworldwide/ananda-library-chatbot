# self.md

## Mistake: S3 URL Mismatch in Tests

**Wrong**:

```
// web/__tests__/components/CopyButton.test.tsx
// Expected URL did not match the actual generated URL by getS3AudioUrl.ts
expect(callHtml).toContain(
  '<a href="https://ananda-audio.s3.us-west-2.amazonaws.com/my%20treasures%2Faudiofile.mp3">Direct Audio Test</a> (My Treasures) → 1:10',
);
```

**Correct**:

```
// web/__tests__/components/CopyButton.test.tsx
// Updated expected URL to match the output of getS3AudioUrl.ts
expect(callHtml).toContain(
  '<a href="https://ananda-chatbot.s3.us-west-1.amazonaws.com/public/audio/my%20treasures/audiofile.mp3">Direct Audio Test</a> (My Treasures) → 1:10',
);
```

## Mistake: npm run Argument Parsing

**Wrong**:
Running `npm run <script> <arg1> <arg2> --flag` might result in `--flag` not being passed to the script, as npm can intercept it.
Command: `npm run prompt ananda-public push ananda-public-base.txt --skip-tests`
Result: `--skip-tests` was not included in `process.argv` inside `manage-prompts.ts`.

**Correct**:
Use `--` to explicitly separate npm options from script arguments.
Command: `npm run prompt -- ananda-public push ananda-public-base.txt --skip-tests`
Result: `--skip-tests` is correctly passed to the script and included in `process.argv`.

### Finding: Script for Checking Firestore URLs

**Situation**: User asked for the location of a Python script that checks Firestore for 404 URLs included in "Answers". Initial searches focused on `data_ingestion` and general crawler utilities, which did not directly match the requirement of interacting with Firestore "Answers" for this specific purpose.

**Resolution**: A broader codebase search for Python scripts interacting with Firestore, URLs, and terms like "answers" and "404" identified `bin/count_hallucinated_urls.py`. This script specifically:

- Connects to Firestore.
- Queries a `chatLogs` collection (derived from an environment prefix, effectively the "Answers").
- Extracts URLs from answer fields.
- Performs HTTP HEAD requests to check their status (including 404s).
- Reports on these URLs.

**Script Path**: `bin/count_hallucinated_urls.py`

### Mistake: Incorrect Document Retrieval Logic Bypassing Library Filters

**Situation**: In `web/src/utils/server/makechain.ts`, the `setupAndExecuteLanguageModelChain` function was pre-fetching documents using `retriever.getRelevantDocuments(sanitizedQuestion)`. This call did not apply library-specific filters defined in the site configuration. These pre-fetched documents (as `finalDocs`) were then passed to `makeChain`, causing `makeChain`'s own `retrievalSequence` (which contains the correct library filtering logic) to be bypassed.

**Wrong**:

```typescript
// In setupAndExecuteLanguageModelChain (makechain.ts)
// ...
const retrievedDocs = await retriever.getRelevantDocuments(sanitizedQuestion); // No library filtering here
// ... docsForLlm derived from retrievedDocs
const chain = await makeChain(
  // ...
  docsForLlm, // Passed as finalDocs, bypassing makeChain's internal retrieval
);

// In makeChain (makechain.ts)
// ...
if (finalDocs) {
  return finalDocs; // Bypasses library-specific retrieval logic
}
// ... library-specific retrieval logic ...
```

**Correct**:

1.  `setupAndExecuteLanguageModelChain` no longer pre-fetches documents.
2.  The `finalDocs` parameter was removed from `makeChain`.
3.  `makeChain` always executes its internal `retrievalSequence`, which correctly applies `baseFilter` (media types, collection authors from `route.ts`) in conjunction with `includedLibraries` (handling weighted parallel calls or `$in` filters for multiple libraries).
4.  `makeChain` was modified to return an object `{ answer: string, sourceDocuments: Document[] }`.
5.  `setupAndExecuteLanguageModelChain` uses this structured return object for its final processing and for providing documents to be saved.

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

**Situation**: After refactoring `makechain.ts` to correctly handle library-specific document filtering, a new linter error appeared, and answer streaming to the frontend broke. The linter error was related to type inference in `RunnablePassthrough.assign`. The broken streaming was caused by a final lambda in `conversationalRetrievalQAChain` that aggregated the answer before streaming callbacks could process individual tokens.

**Wrong (Conceptual Snippets from Previous State)**:

```typescript
// In makechain.ts - fullAnswerGenerationChain causing linter error
const fullAnswerGenerationChain = RunnablePassthrough.assign({
  answer: (input: { context: string; ... }) => generationChain.invoke(input), // Complex input type here was problematic for inference
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

1.  **Linter Error Fix**: Refactored `fullAnswerGenerationChain` in `makechain.ts`. Introduced `PromptDataType` and a new `generationChainThatTakesPromptData` runnable. This new runnable explicitly defines its input type (`PromptDataType`) and selects the fields required by the LLM prompt internally. `RunnablePassthrough.assign` then uses `generationChainThatTakesPromptData` for the `answer` field and a simple lambda `(input: PromptDataType) => input.documents` for `sourceDocuments`.
2.  **Streaming Fix**: Removed the final result-transforming lambda from `conversationalRetrievalQAChain` in `makechain.ts`. This allows the streamed tokens from the `answer` field (generated by `generationChainThatTakesPromptData`, which includes a `StringOutputParser`) to propagate to the `handleLLMNewToken` callback in `setupAndExecuteLanguageModelChain`.
3.  **Warning Logic Relocation**: The logic to check if the AI's answer indicates no specific information was moved from the removed lambda in `conversationalRetrievalQAChain` to `setupAndExecuteLanguageModelChain`. It now checks the final aggregated `result.answer` after all streaming has completed.

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

**Wrong**:
When attempting to remove an unused variable or import from a specific function/file, the `edit_file` tool sometimes applies the deletion to a different function or location within the same file, or even fails to apply the change if the targeted line is already commented out but still flagged by the linter (possibly due to stale linter data), or fails to remove an import line repeatedly.

**Correct**:
If the `edit_file` tool misapplies an edit or fails to apply it:

1. Re-try the edit with more surrounding context to help the model pinpoint the exact location.
2. Verify if the linter data is current, especially if the tool fails to act on a line that appears already fixed (e.g., commented out).
3. If an edit (like removing an import) persistently fails across multiple attempts, note it for manual review and move on to other issues to avoid getting stuck.
4. If an edit causes a new error (e.g., removing a variable that _is_ used elsewhere), the immediate next step should be to revert or fix that erroneous edit.

### False Positive Linter Error Suppression

**Situation**:
A linter (e.g., ESLint with `@typescript-eslint/no-unused-vars`) flags a variable as unused, but it is actually used (e.g., within a callback or a complex assignment that the linter doesn't fully trace for usage in the final return path).

**Resolution**:
If confident the variable is used and the linter warning is a false positive, suppress the warning for that specific line using a linter disable comment.
For ESLint and `@typescript-eslint/no-unused-vars`, this can be done by adding `// eslint-disable-next-line @typescript-eslint/no-unused-vars` on the line immediately preceding the variable declaration.

**Example**:

```typescript
// web/src/utils/server/makechain.ts
// ...
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let fullResponse = ''; // This variable is used in a callback, but linter flags it.
// ...
```

### Mistake: Jest Module Resolution for Local Dependencies

**Situation**:
When Jest tests need to import from another directory in the monorepo, using relative paths can be error-prone and fragile. Errors like "Configuration error: Could not locate module..." or "Cannot find module" occur.
This happens even if relative paths are used in mocks/imports, as TypeScript/Jest might not correctly resolve these across directory boundaries without proper configuration.

**Wrong**:

```typescript
// Attempting to use relative paths for mocks or imports from another directory
jest.mock('../../../../src/utils/pinecone-client');
import { getPineconeClient } from '../../../../src/utils/pinecone-client';
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
       '^@/(.*)$': '<rootDir>/src/$1',
     },
   };
   ```

3. Use the aliases in your tests:
   ```typescript
   jest.mock('@/utils/pinecone-client');
   import { getPineconeClient } from '@/utils/pinecone-client';
   ```

**Reasoning**:
Using module aliases provides a more robust and maintainable way to handle imports across the codebase. It avoids deep relative paths, makes refactoring easier, and works consistently across different file locations.

### Mistake: Forgot to cd into web directory before running tests

**Wrong**:

```
Ran 'npm test' without ensuring the shell was in the web directory.
```

**Correct**:

```
Must cd into the web directory with 'cd web' before running 'npm test' to execute the Next.js test suite.
```

### Python Import Path Resolution for Direct Script Execution

**Problem**: When running a Python script directly from its directory using `./script.py` instead of as a module with `python -m`, imports referencing the parent package fail.

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

This solution ensures that Python can find the parent package when a script is run directly using `./script.py` from within its directory.

### Mistake: ModuleNotFoundError for Local Modules in Scripts

**Situation**: When running a Python script from a subdirectory (e.g., `bin/myscript.py`) that imports a local module from another directory at the project root level (e.g., `pyutil/some_module.py`), a `ModuleNotFoundError` can occur because the script's directory is not automatically part of Python's search path for modules in the way that the current working directory is when you run `python -m`.

**Wrong**:
Script `bin/evaluate_rag_system.py` trying to import `from pyutil.env_utils import load_env` might fail if `bin/` is not the current working directory or if `pyutil` is not in a location Python automatically searches (like `site-packages`).

**Correct**:
To reliably import local modules from other directories within the same project, explicitly add the project's root directory (or the specific directory containing the module) to `sys.path` at the beginning of the script.

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

This ensures that Python can find the `pyutil` directory (and other modules at the project root) regardless of how or from where the script is executed.

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

**Correct**:
Initialize an `OpenAI` client and use its `embeddings.create` method.

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

````

### Mistake: Overly verbose docstrings
**Wrong**:
```python
"""
Evaluate and compare the retrieval performance of two RAG (Retrieval-Augmented Generation) systems.

This script assesses a "current" RAG system against a "new" RAG system, typically differing in
embedding models, Pinecone index configurations, and text chunking strategies. The primary goal
is to quantify improvements in retrieval quality using human-judged relevance data.

Core Algorithm Steps:
1.  **Setup**:
    *   Loads site-specific environment variables (API keys, index names, model IDs) based on a `--site` argument.
    *   Initializes Pinecone clients and connects to two distinct Pinecone indexes: one for the
        current system and one for the new system. It verifies index dimensions.
    *   Initializes an OpenAI client for generating text embeddings.
    *   Loads a human-curated evaluation dataset (JSONL format). Each entry in this dataset
        consists of a query, a document (chunk of text), and a human-assigned relevance score
        (e.g., 0 for irrelevant, 3 for highly relevant). This data is grouped by query.

2.  **Per-Query Evaluation Loop**:
    *   For each unique query in the evaluation dataset:
        *   **Current System Retrieval**:
            *   Generates a query embedding using the current system's specified OpenAI model
              (e.g., `text-embedding-ada-002`).
            *   Queries the current system's Pinecone index to retrieve the top-K documents (chunks)
              most similar to the query embedding. Pinecone returns documents with their metadata
              and cosine similarity scores.
            *   The retrieved text is re-chunked using the current system's chunking parameters
              (defined by `CHUNK_SIZE_CURRENT` and `CHUNK_OVERLAP_CURRENT`). This step simulates
              the exact chunking that system would use.
        *   **New System Retrieval**:
            *   Repeats the retrieval process, but using the new system's embedding model
              (e.g., `text-embedding-3-large`), Pinecone index, and chunking parameters
              (`CHUNK_SIZE_NEW`, `CHUNK_OVERLAP_NEW`).
        *   **Relevance Assignment (Matcher Logic)**:
            *   For both systems, each retrieved chunk needs to be assigned a relevance score based
              on the human judgments. Since the chunking in the retrieval systems might differ from
              the chunking in the evaluation dataset, a direct match isn't always possible.
            *   The `match_chunks` function is used. It employs `difflib.SequenceMatcher` to compare
              the text content of a retrieved chunk against all human-judged chunks for that query.
            *   If the `SequenceMatcher.ratio()` (a measure of similarity between two sequences,
              ranging from 0 to 1) exceeds a predefined `SIMILARITY_THRESHOLD` (e.g., 0.85),
              the retrieved chunk is considered a match to the judged chunk and inherits its
              relevance score. If no judged chunk meets the threshold, the retrieved chunk
              is assigned a relevance of 0.0.
        *   **Metric Calculation**:
            *   Calculates Precision@K: The fraction of the top-K retrieved documents that have a
              relevance score of 1.0 or higher.
            *   Calculates NDCG@K (Normalized Discounted Cumulative Gain): A metric that evaluates
              the ranking quality, giving higher scores for more relevant documents ranked higher.
              It uses the assigned relevance scores and the similarity scores from Pinecone.

3.  **Aggregation and Reporting**:
    *   After processing all queries, the script calculates average Precision@K, NDCG@K, and
        average retrieval time for both the current and new systems.
    *   It then reports these average metrics and calculates the percentage improvement of the
        new system over the current system for both precision and NDCG.
    *   It also reports the relative speed difference between the two systems.

Pinecone Interaction:
- The script heavily relies on Pinecone for document retrieval. It expects both specified Pinecone
  indexes to be populated with document embeddings corresponding to their respective systems.
- If an index is empty or does not exist, the script will encounter errors or produce
  meaningless (zeroed) metrics, as no documents can be retrieved for evaluation.
- The dimensions of the embeddings in Pinecone are checked against expected values (e.g., 1536
  for `text-embedding-ada-002`, 3072 for `text-embedding-3-large`). Warnings are issued
  if mismatches are found, as this would lead to errors during Pinecone queries.
"""
````

**Correct**:

```python
"""
Evaluates and compares two RAG (Retrieval-Augmented Generation) systems for retrieval performance.

Key Operations:
- Loads configurations (API keys, Pinecone index names, OpenAI model IDs) via a `--site` argument.
- Connects to two Pinecone indexes (current vs. new system) and an OpenAI client.
- Processes a human-judged dataset (`evaluation_dataset_ananda.jsonl`) containing queries,
  documents, and relevance scores.
- For each query:
    - Retrieves top-K documents from both Pinecone indexes using their respective embedding
      models and chunking strategies.
    - Matches retrieved chunks to judged documents using `difflib.SequenceMatcher` to assign
      relevance scores. A similarity ratio above `SIMILARITY_THRESHOLD` (0.85) denotes a match.
    - Calculates Precision@K and NDCG@K for both systems.
- Aggregates results: reports average Precision@K, NDCG@K, retrieval times, and percentage
  improvements of the new system over the current one.

Dependencies:
- Populated Pinecone indexes for both systems are required. Empty indexes will result in errors
  or zeroed (meaningless) metrics.
- Correct Pinecone index dimensions (e.g., 1536 for `text-embedding-ada-002`, 3072 for
  `text-embedding-3-large`) are crucial; mismatches cause query failures.
"""
```
