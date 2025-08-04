# Website Crawler

A robust, production-ready website crawler designed for the Ananda Library Chatbot project. The crawler extracts content
from websites, processes it using spaCy-based semantic chunking, and stores embeddings in Pinecone for
retrieval-augmented generation (RAG) systems.

## Features

### Core Functionality

- **Intelligent Crawling**: Respects robots.txt, implements rate limiting, and handles failures gracefully
- **Content Processing**: Uses spaCy for semantic text chunking with 300-500 token targets and 20% overlap
- **Vector Storage**: Automatically generates and stores embeddings in Pinecone vector database
- **Multi-Site Support**: Configurable for different domains with site-specific settings
- **Change Detection**: Only processes content when it has actually changed (SHA-256 hash comparison)
- **CSV Mode**: High-priority processing of URLs from CSV exports with modification date tracking

### Reliability & Monitoring

- **Database-Driven Queue**: SQLite-based crawl queue with retry logic and exponential backoff
- **Health Check Server**: Flask-based monitoring endpoint with detailed statistics
- **Daemon Support**: macOS LaunchAgent integration for automatic startup and restart
- **Log Rotation**: Uses macOS newsyslog for automatic log management with compression
- **Graceful Shutdown**: Proper signal handling and state preservation

### Advanced Features

- **Priority System**: High-priority URLs (e.g., from CSV) are processed first
- **Failure Classification**: Distinguishes between temporary and permanent failures
- **Menu Expansion**: JavaScript-based menu interaction for comprehensive link discovery
- **Content Extraction**: Multiple fallback methods including readability library
- **Robots.txt Compliance**: Automatic robots.txt checking with 24-hour caching

## Installation

### Prerequisites

- Python 3.10+
- Required Python packages (see requirements.txt)
- macOS (for daemon support)
- Access to Pinecone and OpenAI APIs

### Setup

1. **Install Dependencies**

   ```bash
   cd data_ingestion
   pip install -r requirements.txt
   ```

2. **Configure Environment** Create a `.env.{site_id}` file in the project root:

   ```bash
   # Example: .env.ananda-public
   OPENAI_API_KEY=your_openai_api_key
   OPENAI_INGEST_EMBEDDINGS_MODEL=text-embedding-3-large
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_ENVIRONMENT=your_pinecone_environment
   PINECONE_INGEST_INDEX_NAME=your_index_name
   ```

3. **Create Site Configuration** Create `crawler_config/{site_id}-config.json`:

   ```json
   {
     "domain": "example.com",
     "skip_patterns": ["/admin/", "/wp-admin/", "\\.pdf$", "/feed/"],
     "crawl_frequency_days": 14,
     "crawl_delay_seconds": 1,
     "csv_export_url": "https://example.com/export.csv",
     "csv_modified_days_threshold": 1
   }
   ```

## Usage

### Basic Crawling

```bash
# Start crawling a site
python website_crawler.py --site ananda-public

# Start with debug logging and screenshots
python website_crawler.py --site ananda-public --debug

# Clear existing vectors and start fresh
python website_crawler.py --site ananda-public --clear-vectors

# Process only 10 pages (for testing)
python website_crawler.py --site ananda-public --stop-after 10

# Retry previously failed URLs
python website_crawler.py --site ananda-public --retry-failed

# Start with a clean database
python website_crawler.py --site ananda-public --fresh-start
```

### Health Monitoring

```bash
# Start health check server
python health_server.py --site ananda-public --port 8080

# Check health status
curl http://localhost:8080/health

# Get quick statistics
curl http://localhost:8080/stats
```

### Daemon Management

```bash
# Install crawler as a daemon (auto-starts on login)
python daemon/daemon_manager.py --site ananda-public install

# Check daemon status
python daemon/daemon_manager.py --site ananda-public status

# View logs
python daemon/daemon_manager.py --site ananda-public logs

# Follow logs in real-time
python daemon/daemon_manager.py --site ananda-public logs --follow

# Control daemon
python daemon/daemon_manager.py --site ananda-public start
python daemon/daemon_manager.py --site ananda-public stop
python daemon/daemon_manager.py --site ananda-public restart

# Uninstall daemon
python daemon/daemon_manager.py --site ananda-public uninstall
```

### Log Management

```bash
# Rotate logs manually
python daemon/logrotate.py --site ananda-public

# Check log statistics
python daemon/logrotate.py --site ananda-public --stats

# Dry run (see what would be rotated)
python daemon/logrotate.py --site ananda-public --dry-run

# Custom rotation settings
python daemon/logrotate.py --site ananda-public --max-size 100MB --keep 10
```

## Configuration

### Site Configuration Options

| Option                        | Description                                  | Default  |
| ----------------------------- | -------------------------------------------- | -------- |
| `domain`                      | Target domain to crawl                       | Required |
| `skip_patterns`               | Regex patterns for URLs to skip              | `[]`     |
| `crawl_frequency_days`        | Days between re-crawling visited pages       | `14`     |
| `crawl_delay_seconds`         | Delay between requests (rate limiting)       | `1`      |
| `csv_export_url`              | URL for CSV export (optional)                | `null`   |
| `csv_modified_days_threshold` | Only process CSV URLs modified within N days | `1`      |

### Environment Variables

| Variable                         | Description                   | Required |
| -------------------------------- | ----------------------------- | -------- |
| `OPENAI_API_KEY`                 | OpenAI API key for embeddings | Yes      |
| `OPENAI_INGEST_EMBEDDINGS_MODEL` | Embedding model to use        | Yes      |
| `PINECONE_API_KEY`               | Pinecone API key              | Yes      |
| `PINECONE_ENVIRONMENT`           | Pinecone environment          | Yes      |
| `PINECONE_INGEST_INDEX_NAME`     | Pinecone index name           | Yes      |

## Architecture

### Components

```text
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Crawler   │    │  Health Server  │    │ Daemon Manager  │
│                 │    │                 │    │                 │
│ • Content fetch │    │ • Status check  │    │ • Install/start │
│ • Link discovery│    │ • Statistics    │    │ • Log rotation  │
│ • Queue mgmt    │    │ • Process info  │    │ • Auto-restart  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │ SQLite Database │
                    │                 │
                    │ • crawl_queue   │
                    │ • csv_tracking  │
                    └─────────────────┘
```

### Data Flow

1. **URL Discovery**: Extract links from crawled pages
2. **Queue Management**: Add new URLs to SQLite queue with priority
3. **Content Processing**: Extract and clean HTML content
4. **Text Chunking**: Use spaCy for semantic chunking (300-500 tokens)
5. **Embedding Generation**: Create vectors using OpenAI embeddings
6. **Vector Storage**: Store in Pinecone with metadata
7. **Status Tracking**: Update database with crawl status and next crawl time

### Database Schema

```sql
-- Main crawl queue
CREATE TABLE crawl_queue (
    url TEXT PRIMARY KEY,
    last_crawl TIMESTAMP,
    next_crawl TIMESTAMP,
    crawl_frequency INTEGER,
    content_hash TEXT,
    last_error TEXT,
    status TEXT DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    retry_after TIMESTAMP,
    failure_type TEXT,
    priority INTEGER DEFAULT 0,
    modified_date TIMESTAMP
);

-- CSV tracking
CREATE TABLE csv_tracking (
    id INTEGER PRIMARY KEY,
    initial_crawl_completed BOOLEAN DEFAULT 0,
    last_check_time TEXT,
    last_error TEXT
);
```

## Monitoring

### Health Check Endpoints

- **GET /health** - Comprehensive health check with database stats, process info, and configuration
- **GET /stats** - Quick statistics summary
- **GET /** - Service information and available endpoints

### Health Status Levels

- **healthy** - All systems operational
- **warning** - Minor issues (e.g., no crawler processes detected)
- **degraded** - Major issues (e.g., database unavailable)

### Log Files

Daemon logs are stored in `~/Library/Logs/AnandaCrawler/`:

- `crawler-{site_id}.log` - Standard output
- `crawler-{site_id}-error.log` - Error output
- `crawler-{site_id}.log.N.gz` - Rotated logs (compressed)

## Development

### Running Tests

```bash
# Run all crawler tests
cd data_ingestion
python -m pytest tests/test_crawler.py -v

# Run health server tests
python -m pytest tests/test_health_server.py -v

# Run with coverage
python -m pytest tests/ --cov=crawler --cov-report=html
```

### Adding New Sites

1. Create environment file: `.env.{site_id}`
2. Create configuration: `crawler_config/{site_id}-config.json`
3. Test configuration: `python website_crawler.py --site {site_id} --stop-after 5`
4. Install daemon: `python daemon/daemon_manager.py --site {site_id} install`
5. Set up log rotation: `./daemon/setup_logrotate.sh {site_id}`

### Debugging

Use the `--debug` flag for detailed logging and screenshots:

```bash
python website_crawler.py --site ananda-public --debug --stop-after 1
```

This will:

- Enable DEBUG level logging
- Save screenshots of crawled pages
- Show detailed HTML processing information
- Display menu expansion attempts

### Performance Tuning

#### Crawl Speed

- Adjust `crawl_delay_seconds` in site config
- Increase browser restart frequency (modify `PAGES_PER_RESTART`)
- Use `--stop-after` for testing

#### Memory Usage

- Configure log rotation via newsyslog (see setup_logrotate.sh)
- Set resource limits in LaunchAgent plist
- Monitor with health check endpoint

#### Storage Optimization

- Regular database cleanup of old failed URLs
- Compress rotated logs
- Monitor Pinecone usage

## Contributing

1. Follow existing code patterns and documentation standards
2. Add tests for new functionality
3. Update this README for new features
4. Test with multiple sites before submitting changes

## License

This crawler is part of the Ananda Library Chatbot project and follows the project's licensing terms.
