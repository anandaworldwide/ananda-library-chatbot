#!/bin/bash

# Script to run TypeScript compilation check
# This catches TypeScript errors that would break the build
# Used by lint-staged during git commits

set -e

# Change to the web directory
cd "$(dirname "$0")/../web" || exit 1

echo "🔍 Running TypeScript compilation check..."
echo "Current directory: $(pwd)"

# Run TypeScript compiler in no-emit mode to check for type errors
# This catches the same errors that would break Vercel builds
if npx tsc --noEmit --project tsconfig.json; then
    echo "✅ TypeScript compilation check passed!"
    exit 0
else
    echo "❌ TypeScript compilation errors found!"
    echo ""
    echo "These errors would cause the Vercel build to fail."
    echo "Please fix the TypeScript errors before committing."
    echo ""
    echo "To see detailed errors, run:"
    echo "  cd web && npx tsc --noEmit"
    exit 1
fi
