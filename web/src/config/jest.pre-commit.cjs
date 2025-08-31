/* eslint-disable @typescript-eslint/no-var-requires */
/** @type {import('jest').Config} */

const path = require("path");
const nextJest = require("next/jest");

// Create Next.js Jest config for pre-commit (run from web directory)
const createJestConfig = nextJest({
  dir: path.resolve(__dirname, "../../"), // Point to web directory
});

// Import the main Jest configuration to get the base settings
const mainConfig = require(path.resolve(__dirname, "../../jest.config.cjs"));

// Pre-commit specific configuration - inherit from main config
const preCommitConfig = {
  // Get all the base configuration from main config
  ...mainConfig,

  // Set the root directory to the web folder (parent of src/config)
  rootDir: path.resolve(__dirname, "../../"), // Absolute path to web/

  // Explicitly set test environment
  testEnvironment: "jest-environment-jsdom",

  // Disable coverage collection for faster pre-commit runs
  collectCoverage: false,

  // Explicitly set setup files using absolute paths
  setupFilesAfterEnv: [path.join("<rootDir>", "jest.setup.ts"), path.join("<rootDir>", "__tests__/setup.ts")],

  // Skip site_specific tests and other slow tests in pre-commit hook
  testPathIgnorePatterns: [
    ...(mainConfig.testPathIgnorePatterns || []),
    path.join("<rootDir>", "__tests__/site_specific/"),
    // Also skip some slower integration tests
    path.join("<rootDir>", "__tests__/api/chat/v1/route.test.ts"),
    path.join("<rootDir>", "__tests__/pages/admin/users.test.tsx"),
  ],

  // Faster test execution for pre-commit
  maxWorkers: 2,

  // Shorter timeout for pre-commit
  testTimeout: 10000,

  // Bail on first failure for faster feedback
  bail: true,
};

// Export the configuration using Next.js Jest config creator
module.exports = createJestConfig(preCommitConfig);
