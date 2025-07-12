# Bin Directory

This directory contains utility scripts for the Ananda Library Chatbot project.

## Available Scripts

### `migrate_pinecone.py`

Migrates vectors between Pinecone indexes. It connects to source and target instances, queries vectors, transforms
metadata (e.g., updating library names), uploads to the target, and provides progress/error handling.

#### Usage of migrate_pinecone.py

```bash
python3 scripts/migrate_pinecone.py --source-key <key> --target-key <key> --source-index <name> --target-index <name>
```

#### How migrate_pinecone.py works

1. Connects to both source and target Pinecone instances
2. Queries vectors from the source index
3. Transforms metadata (e.g., updating library names)
4. Uploads vectors to the target index
5. Provides progress tracking and error handling

### `evaluate_rag_system.py`

Evaluates the RAG (Retrieval Augmented Generation) system's performance. It compares the current system with a new
system (e.g., different chunking or embedding model) using a human judgment dataset to measure retrieval quality (e.g.,
using NDCG scores).

### `clean_pinecone_authors.py`

Standardizes author names in Pinecone metadata. It takes a configuration file specifying alternative author name
variants and a canonical name, then updates records in Pinecone to use the canonical name. Supports dry-run mode.

### `count_hallucinated_urls.py`

Analyzes Firestore chat logs to find URLs in "answer" fields. It checks these URLs for validity (2xx status codes) and
reports on invalid or "hallucinated" URLs, broken down by configurable time intervals.

### `run-jest-for-lint-staged.sh`

A shell script used by `lint-staged` to run Jest tests. It changes to the `web` directory and executes Jest with
specific options for pre-commit checks, targeting only files staged for commit.

### `find_records_by_category.py`

Queries a Pinecone index to find records matching a specific category in their metadata. It prints the title, permalink,
and categories for each matching record.

### `delete_all_pinecone_vectors.py`

Deletes all vectors from a specified Pinecone index. It prompts for confirmation before performing the deletion.

### `delete_pinecone_data.py`

Deletes records from a Pinecone index based on various criteria:

- Media type (audio, text, youtube_video) with optional library and title filters.
- Source name with optional subsource filter.
- Custom ID prefix. It lists matching record IDs and prompts for confirmation before deletion.

### `vector_db_stats.py`

Generates statistics about vectors in a Pinecone index. It counts occurrences of metadata fields like 'author',
'library', and 'type', processing vectors in batches. Can filter by an ID prefix.

### `count_questions.py`

Counts the total number of documents (chat logs) in a specified Firestore collection (`<env_prefix>_chatLogs`).

### `process_anandalib_dump.py`

Processes a WordPress MySQL dump file. It modifies the dump to use a new, date-based database name, adds SQL commands
for character set conversion and table modifications (e.g., for `wp_posts`), and then imports it into a new MySQL
database.

### `firestore_utils.py`

A utility module providing a function `initialize_firestore` to connect to Google Firestore using service account
credentials loaded from environment variables. It handles unsetting the emulator host for production.

### `cancel-other-deployments.py`

Cancels all 'Building' or 'Queued' Vercel deployments for the current Vercel team/account, except for a specified
project. It includes a safety check for recent Git commits by other users.

### `test_api_security.sh`

A shell script to test the security of API endpoints (assumed to be running on `http://localhost:3000`). It performs
various checks, including:

- Access without authentication.
- Access with invalid tokens/cookies.
- Obtaining a JWT token using a site authentication cookie.
- Accessing protected and admin-only endpoints with the JWT token. Requires a password and site authentication cookie as
  arguments.

### `recreate_github_environments.sh`

Recreates specified GitHub environments for a given repository (`anandaworldwide/ananda-library-chatbot` by default). It
uses the `gh` CLI to PUT environment configurations, effectively resetting them or creating them if they don't exist.

### `upload_secrets_to_github.py`

Uploads environment variables from a site-specific `.env.<site>` file to GitHub secrets. It can target specific
environments (Preview and Production for a given site) or repository-level secrets. Handles multiline values and creates
environments if they don't exist.

### `generateHashedPassword.js`

A Node.js script to generate a bcrypt-hashed password and the current timestamp. It takes a plain-text password as a
command-line argument and outputs environment variable strings for `SITE_PASSWORD` and `LAST_PASSWORD_CHANGE_TIMESTAMP`.

### `generateRandomQA.js`

Generates random Question/Answer pairs and saves them to a JSON file. This is likely used for testing or seeding data.
It uses a predefined list of questions and context snippets.

### `fetch_and_print_question.py`

Fetches and prints a specific question document from a Firestore `questions` collection based on a provided document ID.

### `crawl_authors.py`

Crawls author information from a WordPress database (presumably the one set up by `process_anandalib_dump.py`). It
extracts author names and associated post IDs.

### `flatten-dir-structure.py`

Flattens a directory structure by moving all files from subdirectories into a specified target top-level directory. It
can handle filename conflicts by appending a counter.

### `combine_partial_subdirs.py`

Combines subtitle files (e.g., VTT or SRT) from subdirectories that represent partial segments of a larger audio/video
file. It orders them and concatenates them into a single file in a target directory.
