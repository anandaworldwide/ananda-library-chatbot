# Test Templates

This directory contains templates for creating standardized tests across the codebase. These templates help ensure
consistent test coverage and quality.

## Available Templates

- **component.test.tsx**: Template for React component tests
- **utility.test.ts**: Template for utility function tests
- **api-route.test.ts**: Template for API endpoint tests

## Usage

1. Copy the appropriate template to your test location
2. Rename it to match your code file (e.g., `MyComponent.test.tsx`)
3. Replace placeholders with your actual implementation details
4. Implement the test cases relevant to your code

## Test Coverage Thresholds

We have established minimum coverage thresholds in Jest configuration:

```js
// From jest.config.cjs
coverageThreshold: {
  global: {
    statements: 65,
    branches: 60,
    functions: 60,
    lines: 65,
  },
  './components/': {
    statements: 70,
    branches: 60,
    functions: 55,
    lines: 70,
  },
  './utils/': {
    statements: 70,
    branches: 70,
    functions: 65,
    lines: 70,
  },
  './app/api/': {
    statements: 70,
    branches: 60,
    functions: 60,
    lines: 70,
  },
}
```

## Testing Requirements

### Components

All component tests should cover:

1. **Basic rendering** with default props
2. **User interactions** (clicks, form submissions, etc.)
3. **Conditional rendering** based on different props
4. **Error states** and error handling
5. **Loading states** when applicable
6. **Async operations** when component makes API calls

### Utility Functions

All utility tests should cover:

1. **Success cases** with valid inputs
2. **Error handling** for API failures
3. **Network failures** and timeouts
4. **Input validation** edge cases
5. **State transitions** (if the utility manages state)

### API Routes

All API route tests should cover:

1. **Successful responses** with valid inputs
2. **Validation errors** for invalid inputs
3. **Authentication/authorization** checks
4. **Method validation** (GET/POST/etc. handling)
5. **Database error handling**
6. **Rate limiting** when applicable

## Best Practices

1. Use descriptive test names that clearly indicate what is being tested
2. Group related tests together using nested `describe` blocks
3. Mock external dependencies appropriately
4. Test only one concept per test case
5. Avoid excessive use of snapshots (prefer explicit assertions)
6. Clean up after tests (reset mocks, restore timers)
7. Use fake timers for testing timeouts and intervals
8. Use parameterized tests for similar test cases with different inputs
9. Keep tests independent from each other

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm test -- --coverage

# Run tests for a specific file
npm test -- MyComponent.test.tsx

# Run tests in watch mode during development
npm test -- --watch
```
