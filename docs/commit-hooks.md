# Commit Hooks Documentation

## Overview

This project uses **Husky** and **lint-staged** to run intelligent tests on commit, ensuring code quality while
maintaining fast commit times (≤20-30 seconds).

## Current Setup

### Pre-commit Hook Configuration

The commit hook system automatically runs relevant tests based on the files you're committing:

- **JavaScript/TypeScript files** → Jest tests (client + server if needed)
- **Python files** → pytest tests (targeted to changed modules)
- **Warning-only mode** → Tests run but don't block commits on failure

### Files Involved

```text
.husky/pre-commit              # Git hook entry point
.lintstagedrc.json            # File pattern → script mapping
bin/run-jest-for-lint-staged.sh     # JavaScript/TypeScript test runner
bin/run-pytest-for-lint-staged.sh   # Python test runner
```

## Smart Test Selection

### JavaScript/TypeScript Files

When you change files in `web/`, the system:

1. **Runs client tests** for all changed files using `--findRelatedTests`
2. **Detects server files** (API routes, server utilities) and runs server tests
3. **Uses timeouts** to ensure tests complete within 25 seconds
4. **Provides clear feedback** with emojis and actionable suggestions

#### Server Test Triggers

Server tests run automatically when you change:

- `*/pages/api/*` - Next.js API routes
- `*/utils/server/*` - Server-side utilities
- `*/services/*` - Service layer files

### Python Files

When you change Python files, the system intelligently maps them to tests:

```bash
# Examples of smart mapping:
data_ingestion/utils/text_processing.py → tests/test_text_processing.py
data_ingestion/crawler/website_crawler.py → tests/test_crawler*.py
pyutil/email_ops.py → tests/test_pyutil_email_ops.py
```

#### Python Test Patterns

- **Direct mapping**: `file.py` → `test_file.py`
- **Module mapping**: `utils/*.py` → integration tests + unit tests
- **Pattern matching**: `crawler/*.py` → all crawler-related tests
- **Cross-module**: Changes to utilities trigger integration tests

## Performance Optimizations

### Timeouts

- **25-second timeout** for each test suite
- **Fast-fail** on first few failures (`--maxfail=3`)
- **Parallel execution** when both JS and Python files change

### Test Scope

- **Targeted testing**: Only run tests related to changed files
- **Skip expensive tests**: No coverage reports or slow integration tests
- **Minimal output**: Concise reporting for faster feedback

## Warning-Only Mode

**Key Feature**: Tests provide feedback but never block commits.

### When Tests Fail

```bash
⚠️  Some tests failed - this is a warning, commit will proceed
   Consider running full test suite before pushing:
   cd web && npm run test:all
   cd data_ingestion && python -m pytest
```

### Benefits

- **Never blocks workflow** - you can always commit
- **Provides immediate feedback** - know about issues right away
- **Encourages good practices** - reminds you to run full tests
- **Flexible development** - commit WIP without test pressure

## Configuration

### Lint-staged Configuration (`.lintstagedrc.json`)

```json
{
  "web/**/*.{js,jsx,ts,tsx}": ["./bin/run-jest-for-lint-staged.sh"],
  "data_ingestion/**/*.py": ["./bin/run-pytest-for-lint-staged.sh"],
  "pyutil/**/*.py": ["./bin/run-pytest-for-lint-staged.sh"],
  "*.py": ["./bin/run-pytest-for-lint-staged.sh"]
}
```

### Customizing Test Selection

To modify which tests run for specific files, edit the mapping logic in:

- `bin/run-jest-for-lint-staged.sh` - JavaScript/TypeScript mapping
- `bin/run-pytest-for-lint-staged.sh` - Python mapping

## Performance Metrics

### Target Performance

- **Total time**: ≤20-30 seconds
- **JavaScript tests**: ≤15 seconds
- **Python tests**: ≤15 seconds
- **Parallel execution**: When both languages change

### Monitoring

The scripts provide timing feedback and suggest manual testing when timeouts occur.

## Future Enhancements

### Potential Improvements

- **Dependency graph analysis** - Run tests for files that import changed modules
- **Test result caching** - Skip tests for unchanged code
- **Parallel test execution** - Run JS and Python tests simultaneously
- **Smart integration tests** - Run integration tests only for cross-module changes

### Configuration Options

- **Strict mode** - Block commits on test failures
- **Performance mode** - Skip all tests for faster commits
- **Custom timeout** - Adjust time limits per project needs
