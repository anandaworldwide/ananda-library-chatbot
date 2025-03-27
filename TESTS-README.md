# Testing Documentation

## Overview

This project uses Jest for testing and has a dual test configuration approach:

1. **Standard Tests**: Run with `npm test` or `jest`
2. **Server Tests**: Run with `jest --selectProjects=server`
3. **API Security Tests**: Run with `bin/test_api_security.sh` script

> **Note**: See @TESTS-TODO.md for known issues and planned improvements to the testing setup.

## Test Directory Structure

Tests are organized in two parallel structures:

1. **`__tests__/` Directory**: Contains most tests including components, API, and some utils tests

   - `__tests__/components/` - React component tests
   - `__tests__/api/` - API endpoint tests
   - `__tests__/utils/` - Utility function tests
   - `__tests__/utils/server/` - **Server utility tests running in JSDOM environment**

2. **Co-located Tests**: Server utilities have tests alongside their implementation
   - `utils/server/` - Contains both implementations and tests (`.test.ts` files)

## Important Note About Server Tests

Server utility tests exist in **TWO** locations:

- `utils/server/*.test.ts` - Run with `--selectProjects=server` flag (Node.js environment)
- `__tests__/utils/server/*.test.ts` - Run with standard Jest (JSDOM environment)

Both sets of tests are valid but test different aspects of the server utilities:

- Co-located tests focus on unit testing in a Node.js environment
- Tests in `__tests__/utils/server/` may include more integration-focused tests

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

## Running Tests

### Running All Tests

To run both standard and server tests:
