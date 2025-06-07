# Phased Custom Crawler Enhancement To-Do List

## Objective

Enhance the existing Python-based web crawler to support periodic re-crawling, avoid re-ingesting unchanged content,
operate as a long-running daemon process, and be configurable for individual sites (single-tenancy). Develop a test
suite using the `unittest` framework with `unittest.mock`, running tests with `pytest`.

From <https://grok.com/chat/03d2d2d8-1b90-4d19-8c61-a0b5b7d3010c>

## Test Suite Guidelines

- Tests are organized in classes inheriting from `unittest.TestCase`.
- Assertions use `self.assert...` methods.
- Dependencies are mocked using `unittest.mock`.
- Tests are compatible with `pytest`.
- Test file: `data_ingestion/tests/test_crawler.py`.

## Phase 1: Core Functionality for Periodic Re-crawling and Change Detection

**Goal**: Implement a persistent crawl queue, change detection, and basic daemon functionality for a single site.

### Tasks

- ✓ Ensure `load_config` in the crawler correctly loads a single site's configuration from
  `crawler_config/{site_id}-config.json` (where `{site_id}` is a command-line argument). This file should contain
  `domain`, `start_url`, `skip_patterns`, and `crawl_frequency_days`.
- ✓ Set up a SQLite `crawl_queue` table with columns: `url`, `last_crawl`, `next_crawl`, `crawl_frequency`,
  `content_hash`, `last_error`. The SQLite database file should be named `crawler_queue_{site_id}.db` (where `{site_id}`
  corresponds to the currently running crawler's site ID) and stored in a `db/` subdirectory (e.g.,
  `db/crawler_queue_{site_id}.db`).
- ✓ Seed initial URLs for the configured site using `start_url` and `crawl_frequency_days` from its specific
  configuration.
- ✓ Implement change detection by computing a SHA-256 hash in `clean_content` and checking it in `should_process`.
- ✓ Update `crawl_queue` after crawling with `last_crawl`, `next_crawl`, and `content_hash`.
- ✓ Implement a basic daemon loop in `main()` that polls `crawl_queue` for URLs where `next_crawl <= now` and sleeps
  when idle.
- ✓ BONUS: Implement intelligent retry mechanism with exponential backoff for temporary failures.

### Core Crawler Logic Enhancements (Phase 1) - SQLite Integration

- [x] **Database Initialization**:
  - [x] Create/connect to `db/crawler_queue_{site_id}.db`.
  - [x] Define `crawl_queue` table schema:
    - `url TEXT PRIMARY KEY`
    - `last_crawl TIMESTAMP`
    - `next_crawl TIMESTAMP` (calculated based on `crawl_frequency_days`)
    - `crawl_frequency INTEGER` (in days, from site config)
    - `content_hash TEXT` (SHA-256 of key content)
    - `last_error TEXT`
    - `status TEXT DEFAULT 'pending'` (pending, visited, failed)
    - `retry_count INTEGER DEFAULT 0`
    - `retry_after TIMESTAMP` (for exponential backoff)
    - `failure_type TEXT` ('temporary', 'permanent')
  - [x] Seed `start_url` into `crawl_queue` if empty.
- [x] **URL Management**:
  - [x] `add_url_to_queue(url)`: Add new URLs, normalize, and ensure `site_id` matches.
  - [x] `get_next_url_to_crawl()`: Fetch oldest, pending URL respecting `next_crawl` and `retry_after`.
  - [x] `mark_url_status(url, status, error_msg=None, content_hash=None)`: Update status, timestamps, hash.
- [x] **Change Detection**:
  - [x] `should_process_content(url, current_hash)`: Compare new hash with stored hash.
- [x] **Failure Handling & Retry**:
  - [x] Distinguish temporary (e.g., timeout, 503) vs. permanent (e.g., 404) failures.
  - [x] Implement exponential backoff for temporary failures (update `retry_count`, `retry_after`, `failure_type`).
  - [x] `--retry-failed` flag: Reset 'permanent' failed URLs to 'pending'.
- [x] **Configuration**:
  - [x] Ensure `site_id` is used for `.env.{site_id}` and `crawler_config/{site_id}-config.json`.
  - [x] `crawl_frequency_days` from config used to set `next_crawl`.
- [x] **Graceful Exit**:
  - [x] `handle_exit`: Ensure current URL is re-queued as 'pending', DB connection closed. DB changes are committed.
- [x] **Checkpointing Removal**:
  - [x] Remove old pickle-based checkpointing (`CrawlerState`, `load_checkpoint`, file-based `save_checkpoint`).
  - [x] Rename `save_checkpoint` to `commit_db_changes` to only reflect DB commits.
  - [x] Remove `--continue` CLI argument as DB state is persistent.
- [x] **Reporting**:
  - [x] `--report`: Query SQLite for failed URLs and their errors.

### Testing for Phase 1

- ✓ Create `data_ingestion/tests/test_crawler.py`.
- Write tests for:
  - ✓ Configuration loading from a `{site_id}-config.json` file.
  - ✓ SQLite queue seeding and updating for a single site database.
  - ✓ Change detection logic (`clean_content` and `should_process`).
  - ✓ Daemon loop behavior with no URLs (mocked crawling).
  - ✓ BONUS: Temporary vs. permanent failure detection and retry scheduling.
- ✓ Run tests with `pytest data_ingestion/tests/test_crawler.py -v`.

## Phase 2: Multi-Domain Support, Rate Limiting, and Robustness

**Goal**: Ensure the crawler is robustly configurable for any single domain, add rate limiting and `robots.txt`
compliance, and enhance error handling and monitoring.

### Tasks for phase 2

- ✓ Solidify single-tenancy support by ensuring all site-specific data (e.g., checkpoint files, SQLite DB as defined in
  Phase 1) is correctly isolated per `site_id`.
- ✓ Implement rate limiting with a configurable `crawl_delay_seconds` in the site's `{site_id}-config.json` (default: 1
  second).
- ✓ Add `robots.txt` compliance using `urllib.robotparser` to check permissions before crawling.
- ✓ Enhance error handling by storing error messages in `crawl_queue.last_error`.
- ✓ Add monitoring by logging crawl statistics (e.g., pages crawled, success rate).
- ✓ Implement graceful shutdown in `handle_exit` to save checkpoints and close SQLite connection.

### Testing for Phase 2

- ✓ Update `data_ingestion/tests/test_crawler.py`.
- Write tests for:
- ✓ Site-specific data isolation (e.g., distinct checkpoint and DB files are used for different `site_id`s, no
  cross-site interference).
- ✓ Rate limiting enforcement.
- ✓ `robots.txt` compliance.
- ✓ Error handling (storing errors in `crawl_queue`).
- ✓ Monitoring (logging stats).
- ✓ Run tests with `pytest data_ingestion/tests/test_crawler.py -v`.

## Phase 3: Optimization and Polish

**Goal**: Optimize performance, add health checks, and finalize documentation.

### Tasks for phase 3

- Implement batch database operations for `crawl_queue` updates using `cursor.executemany`.
- Add a Flask-based health check endpoint (`/health`) returning crawler status and stats.
- Update README to document new features, setup, and usage.
- Write integration tests for a full crawl cycle using a mocked server.

### Testing for Phase 3

- Finalize `data_ingestion/tests/test_crawler.py`.
- Write tests for:
- Batch database operations.
- Health check endpoint response.
- Integration test for a full crawl cycle (mocked Playwright and server).
- Run tests with `pytest data_ingestion/tests/test_crawler.py -v`.

## Notes

- Run `pytest` after each task to catch regressions.
- Mock external services (e.g., Pinecone, Playwright) in tests.
- Back up `crawler_queue_{site_id}.db` regularly (filename now site-specific).
- Monitor Pinecone usage to avoid quota issues.
