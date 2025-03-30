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
