# Project.md

## Current project

See @crawler-TODO.md

## S3 Bucket Policy for Public Access

The user wants to restrict public access to a specific path within the S3 bucket.

**Previous Policy Snippet (PublicReadGetObject Statement)**:

```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ananda-chatbot/*"
}
```

**Current Preference (PublicReadGetObject Statement)**:
The `Resource` should be restricted to a specific path, e.g., `public/audio/*`.

```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ananda-chatbot/public/audio/*"
}
```

### Dependency Version Alignment

- All shared dependencies across web and data_ingestion must match the versions in web/package.json. Web versions take priority.
- If adding or updating a dependency in any package, ensure the version matches web/package.json if it exists there.

### Vercel Monorepo Local Package Build Order Fix

**Problem:** When building a monorepo subdirectory (e.g., web/) in Vercel, ensure all dependencies are properly configured and any local package references are removed.

**Fix:** If you have removed a local package from the project:

1. Remove any direct dependencies on the package from `package.json`
2. Remove any build or install scripts that reference the package
3. Update any import statements to use the new location of the code

### Browserslist Error in Next.js Build

**Problem:** Vercel build fails with `Cannot find module 'browserslist'` during the Next.js build process. This happens when processing CSS files with autoprefixer in the Next.js application.

**Fix:**

- Add browserslist directly to the devDependencies of the package running Next.js (web/package.json):

  ```
  "browserslist": "^4.23.0"
  ```

- Run `npm install` to update the lockfile.

### TypeScript Configuration for Test Files

To prevent test files from being included in production builds while maintaining proper type checking for tests:

1. Create a separate `tsconfig.test.json` that extends the base config and includes test-specific files:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node", "@testing-library/jest-dom"]
  },
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "__tests__/**/*.ts",
    "__tests__/**/*.tsx",
    "jest.setup.ts",
    "jest.config.cjs"
  ]
}
```

2. Update the main `tsconfig.json` to exclude test files:

```json
{
  "exclude": [
    "node_modules",
    "**/*.test.ts",
    "**/*.test.tsx",
    "jest.setup.ts",
    "jest.config.cjs"
  ]
}
```

3. Configure Jest to use the test-specific TypeScript config:

```js
{
  "transform": {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        "tsconfig": "<rootDir>/tsconfig.test.json"
      }
    ]
  }
}
```

This setup ensures that:

- Test files are properly type-checked during development and testing
- Test files and configurations are excluded from production builds
- Jest uses the correct TypeScript configuration for running tests

### Monorepo Package Structure Update

**Previous Structure**: The project used a local package `shared-utils` for shared utilities between web and data_ingestion.

**Current Structure**:

- Shared utilities have been moved directly into their respective packages
- No local package dependencies are used
- Each package (web, data_ingestion) maintains its own independent utilities
- When adding new shared functionality, duplicate it in both packages rather than creating a shared package

This change was made to:

1. Simplify the build process
2. Remove complexity from package management
3. Eliminate potential circular dependencies
4. Make each package more self-contained and independently deployable

When adding new shared functionality:

- Copy the code to both packages if needed
- Maintain version alignment for any npm dependencies used in both packages
- Keep the implementations as similar as possible while allowing for package-specific optimizations

### Markdown Formatting

- Markdown files should adhere to a 120-character line limit.

### Script Argument for Environment Loading

**Situation**: Scripts like `bin/evaluate_rag_system.py` that need to access environment-specific configurations (e.g., API keys for different sites like 'ananda' or 'crystal') should use a consistent mechanism for loading these configurations.

**Previous (Problematic)**: Some scripts might hardcode the environment file (e.g., `.env.ananda`) or lack a way to specify the target site, making them less flexible.

**Correct (Preferred)**:

1.  Add a command-line argument, typically `--site`, to the script using `argparse`.
2.  Utilize a shared utility function, like `pyutil.env_utils.load_env(site_name)`, to load the appropriate `.env.<site_name>` file.
3.  Ensure that functions relying on environment variables (e.g., `initialize_pinecone`, `load_environment`) fetch these variables _after_ `load_env` has been called.

**Example Snippet (`bin/evaluate_rag_system.py`)**:

```python
import argparse
from pyutil.env_utils import load_env
import os

def load_environment(site: str):
    """Load environment variables based on the site."""
    load_env(site)
    if not os.getenv("PINECONE_API_KEY") or not os.getenv("OPENAI_API_KEY"):
        raise ValueError("PINECONE_API_KEY or OPENAI_API_KEY not found after loading environment. Check .env.<site> file.")

# ... other helper functions ...

def main():
    parser = argparse.ArgumentParser(description='Evaluate RAG system performance.')
    parser.add_argument('--site', required=True, help='Site ID to load environment variables (e.g., ananda, crystal)')
    args = parser.parse_args()

    try:
        load_environment(args.site)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR loading environment: {e}")
        return

    openai.api_key = os.getenv("OPENAI_API_KEY")
    # ... rest of main

if __name__ == "__main__":
    main()
```

This approach standardizes how scripts handle site-specific configurations, improving maintainability and usability across different environments/sites.
