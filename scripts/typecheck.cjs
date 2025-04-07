#!/usr/bin/env node

// A script to type-check staged files using a specific tsconfig file
// This gets around the limitation where TypeScript cannot accept both
// file paths and a project flag at the same time

/* eslint-disable @typescript-eslint/no-var-requires */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-var-requires */

// Get files from command line arguments
const files = process.argv.slice(2);

// Filter TypeScript files that are in the __tests__ directory
const testFiles = files.filter(
  (file) => /\.(ts|tsx)$/.test(file) && file.includes('__tests__'),
);

console.log(`Received ${files.length} files, ${testFiles.length} test files`);

// If we have test files, check them with the test config
if (testFiles.length > 0) {
  try {
    console.log(
      `Type checking ${testFiles.length} test file(s) with tsconfig.test.json`,
    );

    // Create a temporary tsconfig that extends the test config but only includes staged test files
    const tempConfigPath = path.join(__dirname, '../.temp-tsconfig.json');

    const tempConfig = {
      extends: './tsconfig.test.json',
      include: [
        ...testFiles,
        'components/**/*',
        'styles/**/*',
        'types/**/*.d.ts',
      ],
      exclude: ['node_modules'],
      compilerOptions: {
        moduleResolution: 'node',
        allowJs: true,
        resolveJsonModule: true,
      },
    };

    fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));

    // Execute TypeScript compiler with the temporary config
    execSync(`npx tsc --noEmit --project ${tempConfigPath}`, {
      stdio: 'inherit',
    });

    // Clean up
    fs.unlinkSync(tempConfigPath);
    console.log('Test file type check complete');
  } catch (error) {
    // The exec already printed the error through stdio: 'inherit'
    process.exit(1);
  }
}

// Always succeed for now, since we're only checking test files
console.log('Type check complete');
process.exit(0);
