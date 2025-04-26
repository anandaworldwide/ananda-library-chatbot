/** @type {import('jest').Config} */
const config = {
  // Extend from the main Jest configuration (if it exists)
  // If you don't have a main jest.config.js, you can remove this line
  // and add the necessary configuration directly here
  // preset: '../jest.config.js',

  // Skip the site_specific tests in pre-commit hook
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/site_specific/'],
};

module.exports = config;
