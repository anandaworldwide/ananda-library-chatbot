# Testing Documentation

## Overview

This project uses Jest for testing with a dual configuration approach:

1. **Standard Tests**: Run with `npm test` or `jest` (JSDOM environment)
2. **Server Tests**: Run with `npm run test:server` or `jest --selectProjects=server` (Node environment)
3. **API Security Tests**: Run with `bin/test_api_security.sh` script

> **Note**: See @TESTS-TODO.md for known issues and planned improvements to the testing setup.

## Test Directory Structure

Tests are organized as follows:

1. **`__tests__/` Directory**: Contains all tests
   - `__tests__/components/` - React component tests (JSDOM environment)
   - `__tests__/api/` - API endpoint tests (JSDOM environment)
   - `__tests__/utils/` - Utility function tests (JSDOM environment)
   - `__tests__/utils/server/` - Server utility tests (Node.js environment)

## Why Server Tests Are Separate

Server tests require a specific environment setup:

1. **Node.js vs JSDOM** - Server code uses Node.js APIs not available in JSDOM
2. **Firebase/Database Mocking** - Server tests need Firebase mocks set up before imports
3. **Environment Variables** - Server tests require specific environment variables
4. **Timeouts & Cleanup** - Server tests need different timeouts and force exit settings

We intentionally run server tests with a separate Jest configuration to prevent environment conflicts and
ensure reliable testing.

## Semantic LLM Response Testing (Using Embeddings)

Validating responses from Large Language Models (LLMs) poses a challenge because identical semantic meaning
can be expressed with highly variable phrasing. Simple string matching or regex is often too brittle
and leads to flaky tests.

### Problem

Keyword or regex-based tests fail when the LLM provides a semantically correct answer using unexpected wording.

### Solution: Embedding Similarity

We leverage vector embeddings to compare the semantic meaning of the LLM's actual response against
predefined canonical (ideal) responses.

### How It Works

1. **Embedding Model**: Uses an embedding model (e.g., OpenAI's `text-embedding-3-small` via the `openai` library)
   to convert text into numerical vectors. It's crucial to use the same model family as the one
   potentially used for generating embeddings in the main application.
2. **Canonical Responses**: For each test query, define one or more `canonical_responses` representing acceptable
   outcomes. This includes expected answers for relevant queries and standard rejection phrases for unrelated queries.
3. **Similarity Calculation**: The test fetches the `actual_response` from the API, generates embeddings for both
   the `actual_response` and the `canonical_responses`.
4. **Cosine Similarity**: It calculates the [cosine similarity](https://en.wikipedia.org/wiki/Cosine_similarity)
   between the `actual_response` embedding and each `canonical_response` embedding. This score (ranging from -1 to 1)
   indicates semantic closeness.
5. **Thresholds**: Predetermined `similarityThreshold` and `dissimilarityThreshold` values are used:
   - For _related_ questions, the `actual_response` similarity to _relevant canonicals_ must be
     `>= similarityThreshold`, AND its similarity to _rejection canonicals_ must be `< dissimilarityThreshold`.
   - For _unrelated_ questions, the `actual_response` similarity to _rejection canonicals_ must be
     `>= similarityThreshold`.

### Implementation Details

- **Utilities**: Core functions `getEmbedding` and `cosineSimilarity` are located in `__tests__/utils/embeddingUtils.ts`.
- **Environment**: Requires `OPENAI_API_KEY` environment variable. The OpenAI client needs specific setup for Node.js
  test environments (`import 'openai/shims/node';` and `dangerouslyAllowBrowser: true`).
- **Example**: See `__tests__/site_specific/ananda-public/semanticSearch.test.ts`.

### Tuning (Critical)

The effectiveness of this method hinges on:

1. **Quality Canonical Responses**: Define representative examples of good (and bad/rejection) responses.
2. **Threshold Adjustment**: The similarity thresholds are _not_ fixed values. They **must** be tuned by observing
   the scores generated during test runs for known good and bad responses to ensure reliable pass/fail separation.

## Running Tests

### Running Standard Tests Only (recommended for component/client work)

```bash
npm test
# or
npx jest
```

### Running Server Tests Only (recommended for server-side work)

```bash
npm run test:server
# or
npm run test:server:coverage  # includes coverage report for server code
# or
npx jest --selectProjects=server
```

### Running All Tests

To run both standard and server tests:

```bash
npm run test:all
# or
npm run test:ci  # includes coverage reports
# or manually:
npm test && npm run test:server
```

## API Security Testing

The `bin/test_api_security.sh` script provides comprehensive security testing for the API endpoints. It tests:

- Authentication requirements
- Token validation
- Cookie validation
- Protected endpoint access
- Admin endpoint restrictions
- Token expiration
- Combined token and cookie authentication

Run it with: `./bin/test_api_security.sh <password> <site_auth_cookie>`
