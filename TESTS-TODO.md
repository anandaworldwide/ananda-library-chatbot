# Testing Improvements

## Issues

- Standard Jest config excludes `__tests__/utils/server/` tests (82 tests in 10 files not running in CI)
- Server config only runs tests in `utils/server/**/*.test.ts`

## Action Items

### Immediate

- [ ] Update CI scripts to run both test configurations:

  ```json
  "test:ci": "jest --ci --coverage && jest --selectProjects=server --ci --coverage"
  ```

- [ ] Fix Vercel build to run server tests:

  ```json
  "build-with-api-tests": "jest && jest --selectProjects=server && node scripts/build.js"
  ```

### Long-term

- [ ] Consolidate testing approach:

  - [ ] Either move all tests to one location
  - [ ] Or clearly document which tests belong where

- [ ] Add clear inline documentation to Jest config

See TESTS-README.md for details on current setup.

## Rate Limiter Tests

- [x] Test genericRateLimiter across different API endpoints:

  - [x] Test that rate limiter blocks requests after limit is reached
  - [x] Test that rate limiter resets after window period
  - [ ] Test that different IPs have separate rate limits
  - [ ] Test that different endpoints have separate rate limit counters
  - [x] Test proper error response when rate limit is exceeded (429 status code)

- [x] Test specific API endpoint rate limiters:

  - [ ] Test high-volume endpoints (chat API, answers API)
  - [x] Test admin-only endpoints (model-comparison-export, downvotedAnswers)
  - [x] Test authentication endpoints (get-token, web-token)
  - [x] Test that 429 responses include appropriate headers and message

- [x] Test rate limiter internals:

  - [x] Test Firestore storage of rate limit data
  - [ ] Test pruning of old rate limit records
  - [ ] Test behavior when Firestore is unavailable
  - [x] Test counter increments correctly with successive requests

## Firebase Mocking Improvements (Completed)

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

## Critical Test Patterns

- [x] Established pattern for properly mocking Firebase:

  ```typescript
  // Mock Firebase BEFORE any imports
  jest.mock('@/services/firebase', () => {
    const mockCollection = jest.fn().mockReturnThis();
    const mockDoc = jest.fn().mockReturnThis();
    const mockGet = jest
      .fn()
      .mockResolvedValue({ exists: false, data: () => null });

    return {
      db: {
        collection: mockCollection,
        doc: mockDoc,
        get: mockGet,
      },
    };
  });

  // Also mock genericRateLimiter which imports Firebase
  jest.mock('@/utils/server/genericRateLimiter', () => ({
    genericRateLimiter: jest.fn().mockResolvedValue(true),
    deleteRateLimitCounter: jest.fn().mockResolvedValue(undefined),
  }));
  ```
