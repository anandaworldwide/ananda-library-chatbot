#!/bin/bash

# Script to run jest in the web directory with the correct arguments
# This is used by lint-staged during git commits

set -e

# Change to the web directory
cd "$(dirname "$0")/../web" || exit 1

# Print debugging information
echo "🧪 Running JavaScript/TypeScript tests for changed files..."
echo "Current directory: $(pwd)"
echo "Arguments received: $*"

# Check if we have any files to test
if [ $# -eq 0 ]; then
    echo "No files provided to test"
    exit 0
fi

# Function to determine if we need to run server tests
needs_server_tests() {
    local files=("$@")
    for file in "${files[@]}"; do
        case "$file" in
            */pages/api/*|*/utils/server/*|*/services/*)
                return 0
                ;;
        esac
    done
    return 1
}

# Determine test strategy based on changed files
run_server_tests=false
if needs_server_tests "$@"; then
    run_server_tests=true
    echo "📡 Server-side files detected - will run server tests"
fi

# Use timeout to ensure we don't exceed 25 seconds
timeout_cmd=""
if command -v timeout >/dev/null 2>&1; then
    timeout_cmd="timeout 25s"
elif command -v gtimeout >/dev/null 2>&1; then
    # macOS with coreutils installed via brew
    timeout_cmd="gtimeout 25s"
fi

# Run client tests first (always run these)
echo "Running client tests..."
client_cmd="npx jest --bail --passWithNoTests --no-coverage --config=src/config/jest.pre-commit.cjs --findRelatedTests"

# Add all files to client test command
for file in "$@"; do
    client_cmd="$client_cmd \"$file\""
done

# Run client tests (allow failures but capture exit code)
set +e
if [ -n "$timeout_cmd" ]; then
    eval "$timeout_cmd $client_cmd"
else
    eval "$client_cmd"
fi
client_exit_code=$?
set -e

# Run server tests if needed
server_exit_code=0
if [ "$run_server_tests" = true ]; then
    echo "Running server tests..."
    server_cmd="npx jest --selectProjects=server --bail --passWithNoTests --no-coverage --findRelatedTests"
    
    # Add server-related files to server test command
    for file in "$@"; do
        case "$file" in
            */pages/api/*|*/utils/server/*|*/services/*)
                server_cmd="$server_cmd \"$file\""
                ;;
        esac
    done
    
    # Run server tests
    set +e
    if [ -n "$timeout_cmd" ]; then
        eval "$timeout_cmd $server_cmd"
    else
        eval "$server_cmd"
    fi
    server_exit_code=$?
    set -e
fi

# Handle results
overall_success=true

if [ $client_exit_code -eq 0 ]; then
    echo "✅ Client tests passed!"
elif [ $client_exit_code -eq 124 ]; then
    echo "⚠️  Client tests timed out (>25s)"
    overall_success=false
else
    echo "⚠️  Client tests failed (exit code: $client_exit_code)"
    overall_success=false
fi

if [ "$run_server_tests" = true ]; then
    if [ $server_exit_code -eq 0 ]; then
        echo "✅ Server tests passed!"
    elif [ $server_exit_code -eq 124 ]; then
        echo "⚠️  Server tests timed out (>25s)"
        overall_success=false
    else
        echo "⚠️  Server tests failed (exit code: $server_exit_code)"
        overall_success=false
    fi
fi

if [ "$overall_success" = false ]; then
    echo ""
    echo "⚠️  Some tests failed - this is a warning, commit will proceed"
    echo "   Consider running full test suite before pushing:"
    echo "   cd web && npm run test:all"
fi

# Always exit 0 to allow commit (warning-only mode)
exit 0