#!/bin/bash

# Script to run jest in the web directory with the correct arguments
# This is used by lint-staged during git commits

# Change to the web directory
cd "$(dirname "$0")/../web" || exit 1

# Print debugging information (can be removed later)
echo "Current directory: $(pwd)"
echo "Arguments received: $*"

# Run jest with the required options and pass all arguments received
npx jest --bail --passWithNoTests --no-coverage --config=src/config/jest.pre-commit.cjs --findRelatedTests "$@" 