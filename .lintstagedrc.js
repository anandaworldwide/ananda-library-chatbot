/**
 * Pre-commit hook configuration
 * Runs tests on staged files to prevent regression
 */

module.exports = {
  // For all TypeScript files
  '**/*.{ts,tsx}': [
    // Run TypeScript type check once for all TypeScript files
    () => 'npx tsc --noEmit',

    // Run tests for specific files
    (filenames) => {
      // For logging only
      const fileList = filenames
        .map((file) => file.split('/').pop())
        .join(', ');
      console.log(
        `🧪 Testing ${filenames.length} changed file(s): ${fileList}`,
      );

      return filenames.map((filename) => {
        // Direct test run for test files
        if (filename.includes('__tests__') || filename.includes('.test.')) {
          return `npx jest ${filename} --passWithNoTests`;
        }

        // Run related tests for source files
        return `npx jest --findRelatedTests ${filename} --passWithNoTests`;
      });
    },
  ],

  // For JavaScript files (if any)
  '**/*.{js,jsx}': [
    (filenames) =>
      filenames.map((filename) => {
        if (filename.includes('__tests__') || filename.includes('.test.')) {
          return `npx jest ${filename} --passWithNoTests`;
        }
        return `npx jest --findRelatedTests ${filename} --passWithNoTests`;
      }),
  ],
};
