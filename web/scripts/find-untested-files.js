#!/usr/bin/env node

// Find files with no unit test coverage
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const coveragePath = path.join(
  projectRoot,
  'coverage',
  'coverage-summary.json',
);

// Source code directories to check
const dirsToCheck = [
  'app',
  'components',
  'pages',
  'services',
  'utils',
  'contexts',
  'hooks',
];

// File extensions to include
const extensions = ['.ts', '.tsx', '.js', '.jsx'];

// Files to ignore (e.g., type definitions, test files, etc.)
const ignorePatterns = [
  /\.d\.ts$/,
  /\.test\./,
  /\.spec\./,
  /\/node_modules\//,
  /\/__tests__\//,
  /\/\.next\//,
];

// Load coverage data
const loadCoverageData = () => {
  try {
    const coverageData = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    return Object.keys(coverageData)
      .filter((key) => key !== 'total')
      .map((key) => key.replace(projectRoot + '/', ''));
  } catch (error) {
    console.error('Error loading coverage data:', error.message);
    return [];
  }
};

// Find all source files
const findSourceFiles = (dir, fileList = []) => {
  const fullDir = path.join(projectRoot, dir);
  if (!fs.existsSync(fullDir)) return fileList;

  const files = fs.readdirSync(fullDir);

  files.forEach((file) => {
    const filePath = path.join(fullDir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findSourceFiles(path.join(dir, file), fileList);
    } else if (
      extensions.includes(path.extname(file)) &&
      !ignorePatterns.some((pattern) => pattern.test(filePath))
    ) {
      fileList.push(path.join(dir, file));
    }
  });

  return fileList;
};

// Main function
const findUntestedFiles = () => {
  const coveredFiles = loadCoverageData();
  const allSourceFiles = [];

  // Find all source files
  dirsToCheck.forEach((dir) => {
    findSourceFiles(dir, allSourceFiles);
  });

  // Find files without coverage
  const untestedFiles = allSourceFiles.filter((file) => {
    // Need to convert Windows paths for comparison if needed
    const normalizedPath = file.replace(/\\/g, '/');

    return !coveredFiles.some((coveredFile) => {
      return (
        coveredFile.endsWith(normalizedPath) ||
        normalizedPath.endsWith(coveredFile.replace(projectRoot, ''))
      );
    });
  });

  console.log('\nFiles with no test coverage:');
  console.log('==========================');

  if (untestedFiles.length === 0) {
    console.log('All files have some test coverage. Great job!');
  } else {
    // Group by directory for better organization
    const filesByDir = {};

    untestedFiles.forEach((file) => {
      const dir = path.dirname(file);
      if (!filesByDir[dir]) {
        filesByDir[dir] = [];
      }
      filesByDir[dir].push(path.basename(file));
    });

    // Print the results
    Object.keys(filesByDir)
      .sort()
      .forEach((dir) => {
        console.log(`\n${dir}/`);
        filesByDir[dir].sort().forEach((file) => {
          console.log(`  - ${file}`);
        });
      });

    console.log(`\nTotal: ${untestedFiles.length} untested files`);

    // Print additional stats
    console.log(`\nCovered files: ${coveredFiles.length}`);
    console.log(`Source files: ${allSourceFiles.length}`);
    console.log(
      `Coverage percentage: ${((coveredFiles.length / allSourceFiles.length) * 100).toFixed(2)}%`,
    );
  }
};

findUntestedFiles();
