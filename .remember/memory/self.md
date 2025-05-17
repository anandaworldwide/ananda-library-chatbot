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
