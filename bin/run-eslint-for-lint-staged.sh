#!/bin/bash

# Script to run ESLint on changed TypeScript/JavaScript files
# This catches linting errors and TypeScript-specific issues
# Used by lint-staged during git commits

set -e

# Change to the web directory
cd "$(dirname "$0")/../web" || exit 1

echo "🔍 Running ESLint check on changed files..."
echo "Current directory: $(pwd)"
echo "Files to check: $*"

# Check if we have any files to lint
if [ $# -eq 0 ]; then
    echo "No files provided to lint"
    exit 0
fi

# Convert file paths to be relative to web directory
web_relative_files=()
for file in "$@"; do
    # Remove 'web/' prefix if present, since we're running from web directory
    relative_file="${file#web/}"
    web_relative_files+=("$relative_file")
done

# Run ESLint on the provided files
# Use --max-warnings 0 to treat warnings as errors for commit hooks
if npx eslint --max-warnings 0 "${web_relative_files[@]}"; then
    echo "✅ ESLint check passed!"
    exit 0
else
    echo "❌ ESLint errors found!"
    echo ""
    echo "Please fix the linting errors before committing."
    echo ""
    echo "To auto-fix some issues, run:"
    echo "  cd web && npx eslint --fix [file]"
    exit 1
fi
