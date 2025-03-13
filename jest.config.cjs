// Jest configuration for Next.js project with TypeScript
/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  // Add patterns to ignore certain files that shouldn't be treated as tests
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/__tests__/api/chat/v1/test-utils.ts',
    '<rootDir>/__tests__/api/chat/v1/utils/',
    '<rootDir>/__tests__/api/chat/v1/streaming-test-utils.ts',
    '<rootDir>/__tests__/.templates/',
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Coverage thresholds to enforce minimum test coverage
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
  },
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  // Configure transformIgnorePatterns to handle ES modules properly
  transformIgnorePatterns: [
    '/node_modules/(?!react-markdown|remark-*|rehype-*|unified|mdast-*|micromark|decode-named-character-reference|character-entities|property-information|hast-*|unist-*|bail|is-plain-obj|trough|vfile|escape-string-regexp)/',
  ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
