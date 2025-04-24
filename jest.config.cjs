// Jest configuration for Next.js project with TypeScript
/* eslint-disable @typescript-eslint/no-var-requires */
const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: [
    '<rootDir>/jest.setup.ts',
    '<rootDir>/__tests__/setup.ts',
  ],
  setupFiles: ['<rootDir>/test/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
    '^@/utils/(.*)$': '<rootDir>/utils/$1',
    '^@/types/(.*)$': '<rootDir>/types/$1',
    '^@/services/(.*)$': '<rootDir>/services/$1',
    '^@/components/(.*)$': '<rootDir>/components/$1',
    '\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\.module\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^react-markdown$': '<rootDir>/__mocks__/react-markdown.js',
    '^remark-gfm$': '<rootDir>/__mocks__/remark-gfm.js',
    '^next/server$': '<rootDir>/__mocks__/next/server.js',
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
    // Skip server-specific tests when running the default config
    '<rootDir>/utils/server',
    '<rootDir>/__tests__/utils/server',
    '<rootDir>/__tests__/api/chat/v1/mocks.ts',
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.jest.json' },
    ],
    '^.+\\.(js|jsx|mjs)$': ['babel-jest', { presets: ['next/babel'] }],
  },
  // Configure transformIgnorePatterns to handle ES modules properly
  transformIgnorePatterns: [
    '/node_modules/(?!react-markdown|remark-*|rehype-*|unified|mdast-*|micromark|decode-named-character-reference|character-entities|property-information|hast-*|unist-*|bail|is-plain-obj|trough|vfile|escape-string-regexp|.+\\.mjs$)/',
  ],
  maxWorkers: 4,
};

// Configuration for server-side tests that need Node environment
const serverConfig = {
  displayName: 'server',
  testMatch: ['<rootDir>/__tests__/utils/server/**/*.test.ts'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testTimeout: 30000,
  forceExit: true,
  detectOpenHandles: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@/pages/(.*)$': '<rootDir>/pages/$1',
    '^@/utils/(.*)$': '<rootDir>/utils/$1',
    '^@/types/(.*)$': '<rootDir>/types/$1',
    '^@/services/(.*)$': '<rootDir>/services/$1',
    '^@/components/(.*)$': '<rootDir>/components/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest'],
  },
};

// Check if we're running server tests specifically
const isServerTest = process.argv.some(
  (arg) =>
    arg.includes('utils/server') || arg.includes('--selectProjects=server'),
);

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = isServerTest
  ? serverConfig
  : createJestConfig(customJestConfig);
