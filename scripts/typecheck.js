#!/usr/bin/env node

// A script to type-check staged files using a specific tsconfig file
// This gets around the limitation where TypeScript cannot accept both
// file paths and a project flag at the same time

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get files from command line arguments
const files = process.argv.slice(2);

// Filter TypeScript files
const tsFiles = files.filter((file) => /\.(ts|tsx)$/.test(file));

if (tsFiles.length === 0) {
  console.log('No TypeScript files to check');
  process.exit(0);
}

try {
  console.log(
    `Type checking ${tsFiles.length} file(s) with tsconfig.test.json`,
  );

  // Using the include directive in compiler options to only check the staged files
  // Create a temporary tsconfig that extends the test config but only includes staged files
  const tempConfigPath = path.join(__dirname, '../.temp-tsconfig.json');

  const tempConfig = {
    extends: './tsconfig.test.json',
    include: tsFiles,
    exclude: ['node_modules'],
  };

  fs.writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));

  // Execute TypeScript compiler with the temporary config
  execSync(`npx tsc --noEmit --skipLibCheck --project ${tempConfigPath}`, {
    stdio: 'inherit',
  });

  // Clean up
  fs.unlinkSync(tempConfigPath);
  console.log('Type check complete');
} catch (error) {
  // The exec already printed the error through stdio: 'inherit'
  process.exit(1);
}
