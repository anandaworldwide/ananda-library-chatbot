# Testing Improvements

## Current Status

- 🐥 **Web Tests**: All 917 tests passing (71 suites) with 60.45% coverage
- 🐥 **Server Tests**: All 321 tests passing (18 suites)
- 🐥 **Python Tests**: All 510 passing, 4 skipped (100% pass rate!)

## Issues

- [x] Standard Jest config excludes `__tests__/utils/server/` tests (82 tests in 10 files not running in CI)
- [x] Server config only runs tests in `utils/server/**/*.test.ts`
- [x] **Python Health Server Tests**: Fixed endpoint path mismatch and missing log activity mocks

## Action Items

### Immediate

- [x] Update CI scripts to run both test configurations:

  ```json
  "test:ci": "jest --ci --coverage && jest --selectProjects=server --ci --coverage"
  ```

- 🐣 Fix Vercel build to run server tests:

  ```json
  "build-with-api-tests": "jest && jest --selectProjects=server && node scripts/build.js"
  ```

- [x] Fix Python health server tests to match actual endpoints (`/api/health`, `/stats`, `/dashboard`, `/`)

### Index.tsx Coverage Plan (Target: 70%)

**Current**: 25% coverage (needs 45% improvement)

#### Phase 1: Basic Component Testing 🐣

- [x] Setup test environment and basic rendering tests
- [x] Props validation tests
- [x] Initial state verification tests
- 🥚 Maintenance mode rendering tests

#### Phase 2: Core Functionality (25% coverage) 🥚

- 🥚 Chat message handling tests
- 🥚 Stream processing tests
- 🥚 Error scenario tests
- 🥚 Basic user interaction tests

#### Phase 3: Advanced Features (25% coverage) 🥚

- 🥚 Session management tests
- 🥚 Collection handling tests
- 🥚 Media type filtering tests
- 🥚 Scroll behavior tests

#### Phase 4: Integration Testing (20% coverage) 🥚

- 🥚 API integration tests
- 🥚 WebSocket handling tests
- 🥚 Error boundary tests
- 🥚 Edge case tests

#### Setup Requirements

##### MSW (Mock Service Worker) Setup

- 🥚 Install MSW v2: `npm install msw --save-dev`
- 🥚 Create handlers for streaming chat responses:

  ```typescript
  // __tests__/mocks/handlers.ts
  import { http, HttpResponse } from "msw";

  export const handlers = [
    http.post("/api/chat/v1", async ({ request }) => {
      const stream = new ReadableStream({
        async start(controller) {
          // Simulate streaming chat response
          controller.enqueue('data: {"token": "Hello"}\n\n');
          controller.enqueue('data: {"token": " world"}\n\n');
          controller.enqueue('data: {"sourceDocs": []}\n\n');
          controller.enqueue('data: {"done": true}\n\n');
          controller.close();
        },
      });
      return new HttpResponse(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }),
  ];
  ```

- 🥚 Setup MSW in jest setup file:

  ```typescript
  // jest.setup.ts
  import { setupServer } from "msw/node";
  import { handlers } from "./mocks/handlers";

  const server = setupServer(...handlers);

  beforeAll(() => server.listen());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  ```

##### Additional Tools Status

- ✓ Jest + React Testing Library (already configured)
- ✓ jest-dom (already configured in jest.setup.ts)
- ✓ user-event (template exists but needs consistent usage)

### Long-term

- [x] Consolidate testing approach:

  - [x] Either move all tests to one location
  - [x] Or clearly document which tests belong where

- [x] Add clear inline documentation to Jest config

See TESTS-README.md for details on current setup.

## Rate Limiter Tests 🐥

- [x] Test genericRateLimiter across different API endpoints:

  - [x] Test that rate limiter blocks requests after limit is reached
  - [x] Test that rate limiter resets after window period
  - [x] Test that different IPs have separate rate limits
  - [x] Test that different endpoints have separate rate limit counters
  - [x] Test proper error response when rate limit is exceeded (429 status code)

- [x] Test specific API endpoint rate limiters:

  - 🥚 Test high-volume endpoints (chat API, answers API), e.g., makechain.ts coverage increase to 70% (currently at
    ~49%)
  - [x] Test admin-only endpoints (model-comparison-export, downvotedAnswers)
  - [x] Test authentication endpoints (get-token, web-token)
  - [x] Test that 429 responses include appropriate headers and message

- [x] Test rate limiter internals:

  - [x] Test Firestore storage of rate limit data
  - 🥚 Test pruning of old rate limit records
  - 🥚 Test behavior when Firestore is unavailable
  - [x] Test counter increments correctly with successive requests

## Firebase Mocking Improvements 🐥

- [x] Create common Firebase mocking pattern for tests
  - [x] Updated `apiTestMocks.ts` with robust documentation and examples
  - [x] Fixed five API test files with the new pattern:
    - [x] `audio.test.ts`
    - [x] `web-token.test.ts`
    - [x] `submitNpsSurvey.test.ts`
    - [x] `logout.test.ts`
    - [x] `get-token.test.ts`
  - [x] Created comprehensive tests for `model-comparison-export.ts` (~93% coverage)
- [x] Document Firebase initialization issues and solutions
  - [x] Added detailed explanation in `apiTestMocks.ts`
  - [x] Created copy-paste templates for future test files

## Critical Test Patterns 🐥

- [x] Established pattern for properly mocking Firebase:

  ```typescript
  // Mock Firebase BEFORE any imports
  jest.mock("@/services/firebase", () => {
    const mockCollection = jest.fn().mockReturnThis();
    const mockDoc = jest.fn().mockReturnThis();
    const mockGet = jest.fn().mockResolvedValue({ exists: false, data: () => null });

    return {
      db: {
        collection: mockCollection,
        doc: mockDoc,
        get: mockGet,
      },
    };
  });

  // Also mock genericRateLimiter which imports Firebase
  jest.mock("@/utils/server/genericRateLimiter", () => ({
    genericRateLimiter: jest.fn().mockResolvedValue(true),
    deleteRateLimitCounter: jest.fn().mockResolvedValue(undefined),
  }));
  ```

## Chat API Endpoint Tests 🐥

- [x] Fixed validation assertion issues:

  - [x] Aligned test expectations with actual error message format in `route.test.ts`
  - [x] Updated tests to expect `Collection must be a string value` instead of `Invalid collection`
  - [x] Fixed validation tests in `streaming.test.ts` for better error handling
  - [x] Improved mock configuration for collection validation

- [x] Fixed proper environment and test isolation:
  - [x] Added proper Firebase mocks to prevent real initialization
  - [x] Added proper site config mocks to improve test stability
  - [x] Ensured consistent test behavior across environments

These changes have resulted in 100% passing tests for the Chat API endpoints, with all 19 tests now passing in
`route.test.ts` and all 9 tests passing in `streaming.test.ts`. The fixes maintain the coverage levels while making
tests more reliable and less prone to environment dependencies.

- [x] Add makechain test in `utils/server/makechain.test.ts` (moved to `__tests__/utils/server/makechain.test.ts` on
      6/17)
  - 🥚 High-volume endpoints (currently at ~49% line coverage, goal is 70%)
- 🥚 Add comprehensive tests for all codebase functionality
- [x] Move retrievalSequence.test.ts to `__tests__/utils/server/` directory
- [x] Move relatedQuestionsUtils.test.ts to `__tests__/utils/server/` directory (completed on 6/26)
- [x] Update Jest config to only look for tests in `__tests__/utils/server/` directory (completed on 6/26)
- [x] Fix Jest hanging issues by adding forceExit and detectOpenHandles options (completed on 6/26)

## Resolved Issues 🐥

- [x] Fixed hanging tests by updating the Jest server configuration to include:
  - Setting a reasonable timeout (10 seconds instead of 30 seconds)
  - Adding forceExit: true to ensure Jest closes when complete
  - Adding detectOpenHandles: true to identify lingering connections
  - Properly mocking Firestore batch operations in all test files
  - Excluding server tests from the standard Jest configuration to prevent running them twice
- [x] Restructured testing documentation:
  - Updated TESTS-README.md with clear instructions on running different types of tests
  - Added explanation of the dual configuration approach and rationale
  - Documented the new npm scripts for running tests
- [x] Added npm scripts for running tests:
  - `test:server` - Run server tests only
  - `test:all` - Run both standard and server tests sequentially
  - `test:server:coverage` - Run server tests with coverage reporting
- [x] Standard Jest tests now complete in about 5 seconds (down from hanging for 30+ seconds)
- [x] Server tests now complete in about 3 seconds (down from hanging for 60+ seconds)
- [x] Confirmed makechain.ts has ~49% coverage in server tests, with goal to reach 70%

## Coverage Goals

### High Priority Coverage Improvements

- 🥚 **makechain.ts**: 49% → 70% (21% improvement needed)
- 🥚 **index.tsx**: 25% → 70% (45% improvement needed)
- 🥚 **relatedQuestions.ts**: 52% → 80% (28% improvement needed)

### Low Priority Coverage Areas

- 🥚 **AudioPlayer.tsx**: 7% → 50% (43% improvement needed)
- 🥚 **likeService.ts**: 4% → 30% (26% improvement needed)
- 🥚 **authConfig.ts**: 34% → 60% (26% improvement needed)
