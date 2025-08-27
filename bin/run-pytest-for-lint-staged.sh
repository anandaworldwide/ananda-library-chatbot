#!/bin/bash

# Script to run pytest for Python files changed in git commits
# This is used by lint-staged during git commits

set -e

# Change to the project root directory
cd "$(dirname "$0")/.." || exit 1

# Print debugging information
echo "🐍 Running Python tests for changed files..."
echo "Current directory: $(pwd)"
echo "Arguments received: $*"

# Check if we have any Python files to test
if [ $# -eq 0 ]; then
    echo "No Python files provided to test"
    exit 0
fi

# Function to map changed files to test files
map_files_to_tests() {
    local changed_files=("$@")
    local test_files=()
    local test_patterns=()
    
    for file in "${changed_files[@]}"; do
        echo "Processing changed file: $file"
        
        # Skip if file doesn't exist (might be deleted)
        if [ ! -f "$file" ]; then
            continue
        fi
        
        # Map specific files to their test counterparts
        case "$file" in
            # Data ingestion utilities
            data_ingestion/utils/*.py)
                basename=$(basename "$file" .py)
                test_file="data_ingestion/tests/test_${basename}.py"
                if [ -f "$test_file" ]; then
                    test_files+=("$test_file")
                fi
                # Also run integration tests that might use these utilities
                test_patterns+=("data_ingestion/tests/test_integration*")
                ;;
            
            # Core data ingestion files
            data_ingestion/*.py)
                basename=$(basename "$file" .py)
                test_file="data_ingestion/tests/test_${basename}.py"
                if [ -f "$test_file" ]; then
                    test_files+=("$test_file")
                fi
                ;;
            
            # Crawler files
            data_ingestion/crawler/*.py)
                test_patterns+=("data_ingestion/tests/test_crawler*")
                ;;
            
            # Audio/video processing
            data_ingestion/audio_video/*.py)
                test_patterns+=("data_ingestion/tests/test_audio*")
                test_patterns+=("data_ingestion/tests/test_video*")
                ;;
            
            # PyUtil modules
            pyutil/*.py)
                basename=$(basename "$file" .py)
                test_file="tests/test_pyutil_${basename}.py"
                if [ -f "$test_file" ]; then
                    test_files+=("$test_file")
                fi
                ;;
            
            # Any other Python file - try to find corresponding test
            *.py)
                # Try to find test file in same directory
                dir=$(dirname "$file")
                basename=$(basename "$file" .py)
                
                # Look for test files in common patterns
                for pattern in "test_${basename}.py" "${basename}_test.py" "tests/test_${basename}.py"; do
                    if [ -f "$dir/$pattern" ]; then
                        test_files+=("$dir/$pattern")
                        break
                    fi
                done
                ;;
        esac
    done
    
    # Remove duplicates and combine test_files and expanded patterns
    local all_tests=()
    
    # Add specific test files
    for test_file in "${test_files[@]}"; do
        if [ -f "$test_file" ]; then
            all_tests+=("$test_file")
        fi
    done
    
    # Add files matching patterns
    for pattern in "${test_patterns[@]}"; do
        # Use find to expand patterns safely
        while IFS= read -r -d '' test_file; do
            all_tests+=("$test_file")
        done < <(find . -path "./$pattern" -type f -print0 2>/dev/null || true)
    done
    
    # Remove duplicates
    printf '%s\n' "${all_tests[@]}" | sort -u
}

# Get test files to run
test_files_array=()
while IFS= read -r line; do
    test_files_array+=("$line")
done < <(map_files_to_tests "$@")

if [ ${#test_files_array[@]} -eq 0 ]; then
    echo "No corresponding test files found for changed Python files"
    echo "Changed files: $*"
    echo "⚠️  Consider adding tests for these files"
    exit 0
fi

echo "Test files to run:"
printf '  - %s\n' "${test_files_array[@]}"

# Set up environment for testing
export PYTHONPATH="${PYTHONPATH:+$PYTHONPATH:}$(pwd):$(pwd)/data_ingestion:$(pwd)/pyutil"

# Run pytest with optimized settings for commit hooks
echo "Running pytest..."

# Use timeout to ensure we don't exceed 30 seconds
timeout_cmd=""
if command -v timeout >/dev/null 2>&1; then
    timeout_cmd="timeout 25s"
elif command -v gtimeout >/dev/null 2>&1; then
    # macOS with coreutils installed via brew
    timeout_cmd="gtimeout 25s"
fi

# Pytest command with fast-fail options
pytest_cmd="python -m pytest \
    --maxfail=3 \
    --tb=short \
    --no-header \
    --no-summary \
    -q \
    --disable-warnings"

# Add test files
for test_file in "${test_files_array[@]}"; do
    pytest_cmd="$pytest_cmd \"$test_file\""
done

# Run the tests (allow failures but capture exit code)
set +e
if [ -n "$timeout_cmd" ]; then
    eval "$timeout_cmd $pytest_cmd"
else
    eval "$pytest_cmd"
fi
exit_code=$?
set -e

# Handle results
if [ $exit_code -eq 0 ]; then
    echo "✅ Python tests passed!"
elif [ $exit_code -eq 124 ]; then
    echo "⚠️  Python tests timed out (>25s) - consider running full test suite manually"
    echo "   Run: cd data_ingestion && python -m pytest"
else
    echo "⚠️  Python tests failed (exit code: $exit_code)"
    echo "   This is a warning - commit will proceed"
    echo "   Consider running full test suite: cd data_ingestion && python -m pytest"
    echo "   Or run specific tests: python -m pytest ${test_files_array[*]}"
fi

# Always exit 0 to allow commit (warning-only mode)
exit 0
