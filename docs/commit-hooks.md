# Commit Hooks Documentation

## Overview

This project uses **Husky** and **lint-staged** to run intelligent tests on commit, ensuring code quality while
maintaining fast commit times (≤20-30 seconds).

## Current Setup

### Pre-commit Hook Configuration

The commit hook system automatically runs comprehensive checks based on the files you're committing:

- **JavaScript/TypeScript files** → TypeScript compilation check + ESLint + Jest tests (client + server if needed)
- **Python files** → pytest tests (targeted to changed modules)
- **Build safety** → Catches errors that would break Vercel deployments
- **Warning-only mode** → Tests run but don't block commits on failure

### Files Involved

```text
.husky/pre-commit                    # Git hook entry point
.lintstagedrc.json                  # File pattern → script mapping
bin/run-typescript-check.sh         # TypeScript compilation check
bin/run-eslint-for-lint-staged.sh   # ESLint linting check
bin/run-jest-for-lint-staged.sh     # JavaScript/TypeScript test runner
bin/run-pytest-for-lint-staged.sh   # Python test runner
```

## Smart Test Selection

### JavaScript/TypeScript Files

When you change files in `web/`, the system runs checks in this order:

1. **TypeScript compilation check** - Catches build-breaking type errors (same as Vercel)
2. **ESLint check** - Enforces code quality and catches additional TypeScript issues
3. **Jest tests** - Runs client tests for all changed files using `--findRelatedTests`
4. **Server tests** - Detects server files (API routes, server utilities) and runs server tests
5. **Timeout protection** - Ensures all checks complete within reasonable time limits
6. **Clear feedback** - Provides actionable error messages and suggestions

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
  "web/**/*.{js,jsx,ts,tsx}": [
    "./bin/run-typescript-check.sh",
    "./bin/run-eslint-for-lint-staged.sh",
    "./bin/run-jest-for-lint-staged.sh"
  ],
  "data_ingestion/**/*.py": ["./bin/run-pytest-for-lint-staged.sh"],
  "pyutil/**/*.py": ["./bin/run-pytest-for-lint-staged.sh"],
  "*.py": ["./bin/run-pytest-for-lint-staged.sh"]
}
```

### Customizing Test Selection

To modify which checks run for specific files, edit the scripts:

- `bin/run-typescript-check.sh` - TypeScript compilation check
- `bin/run-eslint-for-lint-staged.sh` - ESLint configuration and rules
- `bin/run-jest-for-lint-staged.sh` - JavaScript/TypeScript test mapping
- `bin/run-pytest-for-lint-staged.sh` - Python test mapping

## Build Safety Features

### TypeScript Compilation Check

The most important addition to the commit hooks is the **TypeScript compilation check** that runs the same validation as Vercel builds:

```bash
# Runs this command to catch build-breaking errors:
npx tsc --noEmit --project tsconfig.json
```

**What it catches:**
- Type assignment errors (like the Firestore Query/CollectionReference issue)
- Missing imports and undefined variables
- Interface violations and type mismatches
- Generic type errors and constraint violations

**Why it's critical:**
- **Prevents Vercel build failures** - catches the exact same errors that would break deployment
- **Fast feedback** - shows errors locally instead of discovering them in CI/CD
- **Same validation** - uses identical TypeScript compiler settings as production builds

### ESLint Integration

ESLint runs with strict settings to catch additional issues:

```bash
# Runs with zero tolerance for warnings:
npx eslint --max-warnings 0 [changed-files]
```

**What it catches:**
- TypeScript-specific linting rules
- Code quality issues and anti-patterns
- Import/export problems
- Unused variables and dead code

### Error Examples

**Before (would break Vercel):**
```typescript
let query = db.collection("test");
query = query.where("field", "==", "value"); // Type error!
```

**After (caught by commit hook):**
```bash
❌ TypeScript compilation errors found!
These errors would cause the Vercel build to fail.
Please fix the TypeScript errors before committing.
```

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
