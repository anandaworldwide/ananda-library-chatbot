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
