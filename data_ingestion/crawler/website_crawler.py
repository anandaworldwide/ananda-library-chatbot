#! /usr/bin/env python
#
# This script is a web crawler designed to scrape content from a specified domain and store it in a Pinecone index.
# It uses Playwright for browser automation and BeautifulSoup for HTML parsing.
# The crawler maintains state using a SQLite database and can resume from where it left off.
# It filters out unwanted URLs and media files, focusing on text content.
# The script also handles exit signals gracefully, committing database changes before shutting down.
#
# Command line arguments:
#   --site: Site ID for environment variables (e.g., ananda-public).
#           Loads config from crawler_config/[site]-config.json and .env.[site]. REQUIRED.
#   --retry-failed: Retry URLs marked as 'permanent' failed in the database.
#   --fresh-start: Delete the existing SQLite database and start from a clean slate.
#   -c, --clear-vectors: Clear existing web content vectors for this site before crawling.
#   --stop-after: Stop crawling after processing this many pages (useful for testing).
#
# Example usage:
#   website_crawler.py --site ananda-public
#   website_crawler.py --site ananda-public --retry-failed
#   website_crawler.py --site ananda-public --clear-vectors
#   website_crawler.py --site ananda-public --stop-after 5

# Standard library imports
import argparse
import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from urllib.robotparser import RobotFileParser

# Third party imports
import pinecone
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright
from readability import Document  # Added import

# Import shared utility
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.embeddings_utils import OpenAIEmbeddings
from utils.pinecone_utils import (
    clear_library_vectors,
    create_pinecone_index_if_not_exists,
    generate_vector_id,
    get_pinecone_client,
    get_pinecone_ingest_index_name,
)
from utils.progress_utils import is_exiting, setup_signal_handlers
from utils.text_splitter_utils import SpacyTextSplitter

# Configure logging with timestamps
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

# Suppress INFO messages from the underlying HTTP library (often httpx)
httpx_logger = logging.getLogger("httpx")
httpx_logger.setLevel(logging.WARNING)

# Define User-Agent constant
USER_AGENT = "Ananda Chatbot Crawler"


# --- Configuration Loading ---
def load_config(site_id: str) -> dict | None:
    """Load site configuration from JSON file."""
    config_dir = Path(__file__).parent / "crawler_config"
    config_file = config_dir / f"{site_id}-config.json"
    if not config_file.exists():
        logging.error(f"Configuration file not found: {config_file}")
        return None
    try:
        with open(config_file) as f:
            config_data = json.load(f)
        logging.info(f"Loaded configuration from {config_file}")
        # Basic validation (add more as needed)
        if "domain" not in config_data or "skip_patterns" not in config_data:
            logging.error(
                "Config file is missing required keys ('domain', 'skip_patterns')."
            )
            return None
        return config_data
    except json.JSONDecodeError as e:
        logging.error(f"Error decoding JSON from {config_file}: {e}")
        return None
    except Exception as e:
        logging.error(f"Error loading config file {config_file}: {e}")
        return None


@dataclass
class PageContent:
    url: str
    title: str
    content: str
    metadata: dict


def ensure_scheme(url: str, default_scheme: str = "https") -> str:
    """Ensure a URL has a scheme, adding a default if missing."""
    parsed = urlparse(url)
    if not parsed.scheme:
        # Reconstruct with default scheme, preserving path, query, etc.
        # Handle schemeless absolute paths like 'domain.com/path'
        if not parsed.netloc and parsed.path:
            parts = parsed.path.split("/", 1)
            netloc = parts[0]
            path = "/" + parts[1] if len(parts) > 1 else ""
            parsed = parsed._replace(scheme=default_scheme, netloc=netloc, path=path)
        else:
            # Standard case
            parsed = parsed._replace(scheme=default_scheme)
        return urlunparse(parsed)
    return url


class WebsiteCrawler:
    def __init__(self, site_id: str, site_config: dict, retry_failed: bool = False):
        self.site_id = site_id
        self.config = site_config
        self.domain = self.config["domain"]
        self.start_url = ensure_scheme(self.domain)  # Start URL is now just the domain
        self.skip_patterns = self.config.get("skip_patterns", [])
        self.crawl_frequency_days = self.config.get("crawl_frequency_days", 14)
        self.crawl_delay_seconds = self.config.get("crawl_delay_seconds", 1)

        # Initialize robots.txt parser
        self.robots_parser = RobotFileParser()
        robots_url = f"{self.start_url.rstrip('/')}/robots.txt"
        self.robots_parser.set_url(robots_url)
        try:
            self.robots_parser.read()
            logging.info(f"Successfully loaded robots.txt from {robots_url}")
        except Exception as e:
            logging.warning(f"Could not load robots.txt from {robots_url}: {e}")
            # Set to None to indicate robots.txt couldn't be loaded
            self.robots_parser = None

        # Initialize shared text splitter with consistent configuration
        self.text_splitter = SpacyTextSplitter()

        # Set up SQLite database for crawl queue
        db_dir = Path(__file__).parent / "db"
        db_dir.mkdir(exist_ok=True)
        self.db_file = db_dir / f"crawler_queue_{self.site_id}.db"
        self.conn = sqlite3.connect(str(self.db_file))
        self.conn.row_factory = sqlite3.Row  # Allow dictionary-like access to rows
        self.cursor = self.conn.cursor()

        # Create crawl_queue table if it doesn't exist
        self.cursor.execute("""
        CREATE TABLE IF NOT EXISTS crawl_queue (
            url TEXT PRIMARY KEY,
            last_crawl TIMESTAMP,
            next_crawl TIMESTAMP,
            crawl_frequency INTEGER,
            content_hash TEXT,
            last_error TEXT,
            status TEXT DEFAULT 'pending',
            retry_count INTEGER DEFAULT 0,
            retry_after TIMESTAMP,
            failure_type TEXT
        )""")
        self.conn.commit()

        # Track URL being processed
        self.current_processing_url: str | None = None

        # Handle --retry-failed flag
        if retry_failed:
            self.retry_failed_urls()

        # If queue is empty, seed with start URL
        self.cursor.execute("SELECT COUNT(*) FROM crawl_queue WHERE status = 'pending'")
        pending_count = self.cursor.fetchone()[0]

        if pending_count == 0:
            logging.info(
                f"No pending URLs found. Seeding with start URL: {self.start_url}"
            )
            self.add_url_to_queue(self.start_url, priority=1)
            self.conn.commit()

    def close(self):
        """Close database connection and print chunking metrics"""
        # Print chunking metrics summary before closing
        if hasattr(self, "text_splitter") and self.text_splitter:
            logging.info("=== WEBSITE CRAWLER CHUNKING METRICS ===")
            self.text_splitter.metrics.print_summary()

        if hasattr(self, "conn") and self.conn:
            self.conn.close()

    def add_url_to_queue(self, url: str, priority: int = 0):
        """Add URL to crawl queue if not already present"""
        normalized_url = self.normalize_url(url)

        try:
            # Use INSERT OR IGNORE to avoid errors if URL already exists
            self.cursor.execute(
                """
            INSERT OR IGNORE INTO crawl_queue 
            (url, next_crawl, crawl_frequency, status) 
            VALUES (?, datetime('now'), ?, 'pending')
            """,
                (normalized_url, self.crawl_frequency_days),
            )
            return True
        except Exception as e:
            logging.error(f"Error adding URL to queue: {e}")
            return False

    def retry_failed_urls(self):
        """Reset failed URLs to pending status for retry"""
        try:
            self.cursor.execute("""
            UPDATE crawl_queue 
            SET status = 'pending', next_crawl = datetime('now'), 
                last_error = NULL, retry_count = 0,
                retry_after = NULL, failure_type = NULL
            WHERE status = 'failed' 
            AND (failure_type = 'permanent' OR failure_type IS NULL)
            """)
            self.conn.commit()
            logging.info(
                f"Reset {self.cursor.rowcount} previously failed URLs for retry"
            )
        except Exception as e:
            logging.error(f"Error retrying failed URLs: {e}")

    def is_url_visited(self, url: str) -> bool:
        """Check if URL has already been successfully visited"""
        normalized_url = self.normalize_url(url)
        self.cursor.execute(
            "SELECT status FROM crawl_queue WHERE url = ? AND status = 'visited'",
            (normalized_url,),
        )
        return bool(self.cursor.fetchone())

    def get_next_url_to_crawl(self) -> str | None:
        """Get the next URL to crawl from the queue"""
        try:
            # Get URLs that are due for crawling, respecting retry_after for temporary failures
            self.cursor.execute("""
            SELECT url FROM crawl_queue 
            WHERE status = 'pending' 
            AND (next_crawl IS NULL OR next_crawl <= datetime('now'))
            AND (retry_after IS NULL OR retry_after <= datetime('now'))
            ORDER BY last_crawl IS NULL DESC, retry_count ASC, next_crawl ASC, url ASC
            LIMIT 1
            """)
            result = self.cursor.fetchone()
            return result[0] if result else None
        except Exception as e:
            logging.error(f"Error getting next URL to crawl: {e}")
            return None

    def mark_url_status(
        self,
        url: str,
        status: str,
        error_msg: str | None = None,
        content_hash: str | None = None,
    ):
        """Update URL status in the database"""
        normalized_url = self.normalize_url(url)
        now = datetime.now().isoformat()

        try:
            if status == "visited":
                # Calculate next crawl time based on frequency
                next_crawl = (
                    datetime.now() + timedelta(days=self.crawl_frequency_days)
                ).isoformat()
                self.cursor.execute(
                    """
                UPDATE crawl_queue 
                SET status = ?, last_crawl = ?, next_crawl = ?, content_hash = ?,
                    retry_count = 0, retry_after = NULL, failure_type = NULL
                WHERE url = ?
                """,
                    (status, now, next_crawl, content_hash, normalized_url),
                )
            elif status == "failed":
                # Determine if failure is temporary or permanent
                is_temporary = False

                # Check for typical temporary failure patterns
                temporary_patterns = [
                    "timeout",
                    "timed out",
                    "connection",
                    "reset",
                    "refused",
                    "network",
                    "unreachable",
                    "server error",
                    "5",
                    "503",
                    "502",
                    "overloaded",
                    "too many requests",
                    "429",
                    "temporarily",
                    "try again",
                ]

                if error_msg:
                    error_lower = error_msg.lower()
                    is_temporary = any(
                        pattern in error_lower for pattern in temporary_patterns
                    )

                failure_type = "temporary" if is_temporary else "permanent"

                # For temporary failures, set up retry with backoff
                if is_temporary:
                    retry_count = 0
                    self.cursor.execute(
                        "SELECT retry_count FROM crawl_queue WHERE url = ?",
                        (normalized_url,),
                    )
                    result = self.cursor.fetchone()
                    if result and result[0] is not None:
                        retry_count = result[0] + 1

                    # Exponential backoff: wait longer between retries
                    # Cap at 10 retries (retry_count starts at 1 for first retry)
                    if retry_count <= 10:
                        # 5min, 15min, 1hr, 4hr, 12hr, 24hr, 48hr, 72hr, 96hr, 120hr
                        minutes_to_wait = 5 * (3 ** min(retry_count, 9))
                        retry_after = (
                            datetime.now() + timedelta(minutes=minutes_to_wait)
                        ).isoformat()

                        self.cursor.execute(
                            """
                        UPDATE crawl_queue 
                        SET status = 'pending', last_crawl = ?, last_error = ?, 
                            retry_count = ?, retry_after = ?, failure_type = ?
                        WHERE url = ?
                        """,
                            (
                                now,
                                error_msg,
                                retry_count,
                                retry_after,
                                failure_type,
                                normalized_url,
                            ),
                        )

                        logging.info(
                            f"Temporary failure for {url} (retry {retry_count}/10): Will retry in {minutes_to_wait} minutes"
                        )
                    else:
                        # After 10 retries, mark as permanent failure
                        self.cursor.execute(
                            """
                        UPDATE crawl_queue 
                        SET status = 'failed', last_crawl = ?, last_error = ?, 
                            retry_count = ?, failure_type = 'permanent'
                        WHERE url = ?
                        """,
                            (
                                now,
                                f"{error_msg} [Exceeded max retries]",
                                retry_count,
                                normalized_url,
                            ),
                        )

                        logging.warning(
                            f"Failed URL {url} exceeded maximum retry attempts (10): {error_msg}"
                        )
                else:
                    # Permanent failure, don't retry automatically
                    self.cursor.execute(
                        """
                    UPDATE crawl_queue 
                    SET status = ?, last_crawl = ?, last_error = ?, 
                        retry_count = 0, retry_after = NULL, failure_type = ?
                    WHERE url = ?
                    """,
                        (status, now, error_msg, failure_type, normalized_url),
                    )

                    logging.info(f"Permanent failure for {url}: {error_msg}")
            else:
                # Other status updates (like setting to 'pending')
                self.cursor.execute(
                    """
                UPDATE crawl_queue 
                SET status = ?, last_crawl = ? 
                WHERE url = ?
                """,
                    (status, now, normalized_url),
                )

            self.conn.commit()
            return True
        except Exception as e:
            logging.error(f"Error updating URL status: {e}")
            return False

    def commit_db_changes(self):
        """Commit any pending database changes"""
        try:
            self.conn.commit()
            logging.debug("Database changes committed")
            return True
        except Exception as e:
            logging.error(f"Error committing database changes: {e}")
            return False

    def get_queue_stats(self) -> dict:
        """Get statistics about the crawl queue"""
        stats = {
            "pending": 0,
            "visited": 0,
            "failed": 0,
            "total": 0,
            "pending_retry": 0,  # URLs waiting to be retried
            "avg_retry_count": 0,  # Average retry count for URLs with retries
        }
        try:
            # Get counts by status
            self.cursor.execute("""
            SELECT status, COUNT(*) as count 
            FROM crawl_queue 
            GROUP BY status
            """)
            for row in self.cursor.fetchall():
                status, count = row["status"], row["count"]
                if status in stats:
                    stats[status] = count
                stats["total"] += count

            # Count pending URLs with retry_after in the future
            self.cursor.execute("""
            SELECT COUNT(*) FROM crawl_queue 
            WHERE status = 'pending' 
            AND retry_after IS NOT NULL 
            AND retry_after > datetime('now')
            """)
            stats["pending_retry"] = self.cursor.fetchone()[0]

            # Get average retry count for URLs with retries
            self.cursor.execute("""
            SELECT AVG(retry_count) as avg_retries 
            FROM crawl_queue 
            WHERE retry_count > 0
            """)
            avg_result = self.cursor.fetchone()
            if avg_result and avg_result[0]:
                stats["avg_retry_count"] = round(avg_result[0], 1)

            # Count by failure type
            self.cursor.execute("""
            SELECT failure_type, COUNT(*) as count 
            FROM crawl_queue 
            WHERE failure_type IS NOT NULL
            GROUP BY failure_type
            """)
            for row in self.cursor.fetchall():
                failure_type, count = row["failure_type"], row["count"]
                if failure_type:
                    stats[f"{failure_type}_failures"] = count

            return stats
        except Exception as e:
            logging.error(f"Error getting queue stats: {e}")
            return stats

    def get_failed_urls(self) -> list[tuple[str, str]]:
        """Get list of failed URLs with error messages"""
        failed_urls = []
        try:
            self.cursor.execute("""
            SELECT url, last_error 
            FROM crawl_queue 
            WHERE status = 'failed'
            ORDER BY last_crawl DESC
            """)
            failed_urls = [
                (row["url"], row["last_error"] or "Unknown error")
                for row in self.cursor.fetchall()
            ]
            return failed_urls
        except Exception as e:
            logging.error(f"Error getting failed URLs: {e}")
            return []

    def normalize_url(self, url: str) -> str:
        """Normalize URL for comparison."""
        parsed = urlparse(url)
        # Strip www and fragments
        normalized = parsed.netloc.replace("www.", "") + parsed.path.rstrip("/")
        return normalized.lower()

    def should_skip_url(self, url: str) -> bool:
        """Check if URL should be skipped based on patterns"""
        return any(re.search(pattern, url) for pattern in self.skip_patterns)

    def is_valid_url(self, url: str) -> bool:
        """Check if URL should be crawled."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.replace("www.", "")
            path = parsed.path.lower()

            # Only follow links from the same domain
            if domain != self.domain:
                logging.debug(f"Skipping external domain: {domain}")
                return False

            # Check robots.txt compliance
            if self.robots_parser:
                if not self.robots_parser.can_fetch(USER_AGENT, url):
                    logging.debug(f"Robots.txt disallows crawling: {url}")
                    return False
            else:
                # If robots.txt couldn't be loaded, log warning but continue
                logging.debug(
                    f"No robots.txt loaded, proceeding with caution for: {url}"
                )

            # Skip non-http(s) URLs
            if parsed.scheme not in ["http", "https"]:
                return False

            # Skip media files and other non-HTML content
            skip_extensions = [
                ".jpg",
                ".jpeg",
                ".png",
                ".gif",
                ".svg",
                ".pdf",
                ".doc",
                ".docx",
                ".xls",
                ".xlsx",
                ".zip",
                ".rar",
                ".mp3",
                ".mp4",
                ".avi",
                ".mov",
                ".wmv",
                ".flv",
                ".webp",
                ".rss",
                ".xml",  # Added feed types
            ]
            # Added '/feed/' path check
            if any(path.endswith(ext) for ext in skip_extensions) or "/feed/" in path:
                logging.debug(f"Skipping non-HTML content: {url}")
                return False

            # Skip wp-content uploads directory
            if "/wp-content/uploads/" in path:
                logging.debug(f"Skipping uploads directory: {url}")
                return False

            # Skip anchor-only URLs or root path (already handled by crawler logic, but explicit check is fine)
            if not parsed.path or parsed.path == "/":
                # Allow root path only if it's the start URL, otherwise usually redundant
                # Note: Crawler logic might already handle this implicitly by checking visited_urls
                # Let's keep it simple: if path is empty or just '/', consider invalid for *discovery*
                # The start URL case is handled separately at the beginning.
                logging.debug(f"Skipping root or anchor-only URL: {url}")
                return False

            return True
        except Exception as e:
            logging.debug(f"Invalid URL {url}: {e}")
            return False

    def clean_content(self, html_content: str) -> str:
        logging.debug(f"Cleaning HTML content (length: {len(html_content)})")
        soup = BeautifulSoup(html_content, "html.parser")

        for element in soup.select(
            "header, footer, nav, script, style, iframe, .sidebar"
        ):
            element.decompose()

        main_content = soup.select_one(
            "main, article, .content, #content, .entry-content, .main-content, .post-content"
        )
        text = ""
        if main_content:
            text = main_content.get_text(separator=" ", strip=True)
        elif (
            html_content
        ):  # Only try readability if we couldn't find a specific area AND have html
            logging.warning(
                "No specific content area found, attempting readability fallback"
            )
            try:
                doc = Document(html_content)
                # Use the cleaned summary HTML from readability
                summary_html = doc.summary()
                # Parse the summary HTML back into BeautifulSoup to extract text
                summary_soup = BeautifulSoup(summary_html, "html.parser")
                text = summary_soup.get_text(separator=" ", strip=True)
            except Exception as e:
                logging.error(f"Readability fallback failed: {e}")
                # Fallback to body text if readability fails
                body_content = soup.body
                if body_content:
                    text = body_content.get_text(separator=" ", strip=True)

        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            logging.warning("No content extracted after fallback attempts")
        else:
            logging.debug(f"Extracted text length: {len(text)}")
        return text

    async def reveal_nav_items(self, page):
        """Reveal all navigation menu items by triggering hover events"""
        try:
            # Click all menu toggles
            await page.click("button.menu-toggle", timeout=1000)

            # Find all top-level nav items
            nav_items = await page.query_selector_all("li.menu-item-has-children")

            for item in nav_items:
                try:
                    # Hover over each nav item to reveal submenus
                    await item.hover()
                    await page.wait_for_timeout(500)  # Wait for animation

                    # Click to expand if needed (some menus might need click instead of hover)
                    await item.click()
                    await page.wait_for_timeout(500)
                except Exception as e:
                    logging.debug(f"Error revealing menu item: {e}")
                    continue

        except Exception as e:
            logging.debug(f"Error in reveal_nav_items: {e}")

    def _validate_response(self, response, url: str) -> tuple[bool, Exception | None]:
        """Validate page response and return (should_continue, exception)."""
        if not response:
            logging.error(f"Failed to get response object from {url}")
            return False, Exception("No response object")

        if response.status >= 400:
            error_msg = f"HTTP {response.status}"
            logging.error(f"{error_msg} error for {url}")
            return False, Exception(error_msg)

        content_type = response.header_value("content-type")
        if content_type and not content_type.lower().startswith("text/html"):
            logging.info(f"Skipping non-HTML content ({content_type}) at {url}")
            self.mark_url_status(url, "visited", content_hash="non_html")
            return False, None  # None indicates successful skip, not error

        return True, None

    def _extract_page_content(
        self, page, url: str
    ) -> tuple[PageContent | None, list[str]]:
        """Extract content and links from page."""
        page.wait_for_selector("body", timeout=15000)

        # Handle menu expansion
        try:
            page.evaluate("""() => {
                document.querySelectorAll('.menu-item-has-children:not(.active)').forEach((item) => {
                    if (!item.closest('.sub-menu')) { 
                        item.classList.add('active');
                        const submenu = item.querySelector(':scope > .sub-menu'); 
                        if (submenu) {
                            submenu.style.display = 'block';
                            submenu.style.visibility = 'visible';
                            submenu.style.opacity = '1';
                        }
                    }
                });
            }""")
        except Exception as menu_e:
            logging.debug(f"Non-critical menu handling failed for {url}: {menu_e}")

        # Extract links and content
        links = page.evaluate(
            """() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(href => href && !href.endsWith('#') && !href.includes('/#'))"""
        )
        valid_links = [link for link in links if self.is_valid_url(link)]
        if len(links) != len(valid_links):
            logging.debug(
                f"Filtered out {len(links) - len(valid_links)} external/invalid links"
            )

        title = page.title() or "No Title Found"
        logging.debug(f"Page title: {title}")
        html_content = page.content()
        clean_text = self.clean_content(html_content)
        logging.debug(f"Cleaned text length: {len(clean_text)}")

        schemed_valid_links = [ensure_scheme(link) for link in valid_links]

        if not clean_text.strip() and title == "No Title Found":
            logging.warning(f"No content or title extracted from {url}")
            return None, schemed_valid_links

        page_content = PageContent(
            url=url,
            title=title,
            content=clean_text,
            metadata={"type": "text", "source": url},
        )
        return page_content, schemed_valid_links

    def _handle_crawl_exception(self, e: Exception, url: str) -> tuple[bool, bool]:
        """Handle exceptions during crawling. Returns (restart_needed, should_retry)."""
        if isinstance(e, PlaywrightTimeout):
            logging.warning(
                f"Timeout error crawling {url}: {e}. Flagging for browser restart."
            )
            return True, False

        error_str = str(e)
        if "Target page, context or browser has been closed" in error_str:
            logging.warning(
                f"Target closed error for {url}: {e}. Flagging for browser restart."
            )
            return True, False

        if "playwright" in repr(e).lower() and (
            "NS_ERROR_ABORT" in error_str
            or "Navigation failed because browser has disconnected" in error_str
        ):
            logging.warning(
                f"Browser/Navigation error encountered for {url}: {e}. Flagging for browser restart."
            )
            return True, False

        if isinstance(e, RuntimeError) and "no running event loop" in error_str:
            logging.error(
                f"Caught 'no running event loop' error for {url}. Flagging for browser restart."
            )
            return True, False

        # For other unexpected errors, log and stop retrying this URL
        logging.error(f"Unexpected error crawling {url}: {e}")
        logging.error(traceback.format_exc())
        return False, False

    def crawl_page(
        self, browser, page, url: str
    ) -> tuple[PageContent | None, list[str], bool]:
        """Crawl a single page and return content, links, and restart flag."""
        retries = 2
        last_exception = None
        restart_needed = False

        url = ensure_scheme(url)

        while retries > 0:
            try:
                logging.debug(
                    f"Attempting to navigate to {url} (Attempts left: {retries})"
                )
                page.set_default_timeout(30000)

                response = page.goto(url, wait_until="commit")

                should_continue, exception = self._validate_response(response, url)
                if not should_continue:
                    if exception is None:  # Successful skip (non-HTML content)
                        return None, [], False
                    last_exception = exception
                    retries = 0
                    continue

                content, links = self._extract_page_content(page, url)
                return content, links, False

            except Exception as e:
                restart_needed, should_retry = self._handle_crawl_exception(e, url)
                last_exception = e

                if restart_needed or not should_retry:
                    retries = 0
                elif retries > 1:
                    retries -= 1
                    logging.info(f"Waiting 5s before next retry for {url}...")
                    time.sleep(5)
                else:
                    retries = 0

        if not restart_needed:
            error_message = (
                str(last_exception)
                if last_exception
                else "Unknown error during crawl attempt"
            )
            logging.error(
                f"Giving up on {url} after exhausting retries or encountering fatal error. Last error: {last_exception}"
            )
            self.mark_url_status(url, "failed", error_message)

        return None, [], restart_needed

    def create_embeddings(
        self, chunks: list[str], url: str, page_title: str
    ) -> list[dict]:
        """Create embeddings for text chunks using shared utilities."""
        # Use shared embeddings utility
        model_name = os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL")
        if not model_name:
            raise ValueError(
                "OPENAI_INGEST_EMBEDDINGS_MODEL environment variable not set"
            )
        embeddings = OpenAIEmbeddings(model=model_name, chunk_size=1000)
        vectors = []

        for i, chunk in enumerate(chunks):
            vector = embeddings.embed_query(chunk)
            chunk_id = generate_vector_id(
                library_name=self.domain,
                title=page_title,
                chunk_index=i,
                source_location="web",
                source_identifier=url,
                content_type="text",
            )

            chunk_metadata = {
                "type": "text",
                "url": url,
                "source": url,
                "title": page_title,
                "library": self.domain,
                "text": chunk,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "crawl_timestamp": datetime.now().isoformat(),
            }

            vectors.append(
                {"id": chunk_id, "values": vector, "metadata": chunk_metadata}
            )

            logging.debug(
                f"Vector {i + 1}/{len(chunks)} - ID: {chunk_id} - Preview: {chunk[:100]}..."
            )

        return vectors

    def should_process_content(self, url: str, current_hash: str) -> bool:
        """Check if content has changed and should be processed"""
        self.cursor.execute(
            "SELECT content_hash FROM crawl_queue WHERE url = ? AND status = 'visited'",
            (self.normalize_url(url),),
        )
        result = self.cursor.fetchone()

        # If never seen before or hash has changed, process it
        return bool(not result or not result[0] or result[0] != current_hash)


def sanitize_for_id(text: str) -> str:
    """Sanitize text for use in Pinecone vector IDs"""
    # Replace non-ASCII chars with ASCII equivalents
    text = text.replace("—", "-").replace("'", "'").replace('"', '"').replace('"', '"')
    # Remove any remaining non-ASCII chars
    text = "".join(c for c in text if ord(c) < 128)
    # Replace special chars with underscores, preserving spaces
    text = re.sub(r"[^a-zA-Z0-9\s-]", "_", text)
    return text


def create_chunks_from_page(page_content, text_splitter=None) -> list[str]:
    """Create text chunks from page content using spaCy with built-in dynamic sizing."""

    # Combine title and content
    full_text = f"{page_content.title}\n\n{page_content.content}"

    # Create text splitter using built-in dynamic sizing
    if text_splitter is None:
        text_splitter = SpacyTextSplitter()

    # Use URL as document ID for metrics tracking
    document_id = page_content.url
    chunks = text_splitter.split_text(full_text, document_id=document_id)

    logging.debug(
        f"Created {len(chunks)} chunks from page using spaCy dynamic chunking"
    )
    return chunks


def upsert_to_pinecone(vectors: list[dict], index: pinecone.Index, index_name: str):
    """Upsert vectors to Pinecone index."""
    if vectors:
        batch_size = 100  # Pinecone recommends batches of 100 or less
        total_vectors = len(vectors)
        logging.debug(
            f"Upserting {total_vectors} vectors to Pinecone index '{index_name}' in batches of {batch_size}..."
        )

        for i in range(0, total_vectors, batch_size):
            batch = vectors[i : i + batch_size]
            logging.debug(
                f"Upserting batch {i // batch_size + 1}/{(total_vectors + batch_size - 1) // batch_size} (size: {len(batch)})..."
            )
            try:
                index.upsert(vectors=batch)
                if i > 2:
                    print(".", end="", flush=True)
            except Exception as e:
                error_msg = str(e)
                logging.error(f"Error upserting batch starting at index {i}: {e}")

                # Check for vector ID sanitization errors that should be treated as temporary failures
                if (
                    "Vector ID must be ASCII" in error_msg
                    or "must be ASCII" in error_msg
                ):
                    logging.warning(
                        "Vector ID sanitization error detected - this should be fixed by updated sanitization logic"
                    )
                    raise Exception(f"Vector ID sanitization error: {error_msg}") from e

                # For other errors, continue with next batch
                pass
        logging.info(f"Upsert of {total_vectors} vectors complete.")


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Crawl a website and store in Pinecone"
    )
    parser.add_argument(
        "--site",
        required=True,  # Make site ID required
        help="Site ID for environment variables (e.g., ananda-public). Loads config from crawler_config/[site]-config.json. REQUIRED.",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Retry URLs marked as 'permanent' failed in the database.",
    )
    parser.add_argument(
        "--fresh-start",
        action="store_true",
        help="Delete the existing SQLite database and start from a clean slate.",
    )
    parser.add_argument(
        "-c",
        "--clear-vectors",
        action="store_true",
        help="Clear existing web content vectors for this site before crawling.",
    )
    parser.add_argument(
        "--stop-after",
        type=int,
        help="Stop crawling after processing this many pages (useful for testing).",
    )
    return parser.parse_args()


def initialize_pinecone(env_file: str) -> pinecone.Index | None:
    """Load environment, connect to Pinecone, and create index using shared utilities."""
    if not os.path.exists(env_file):
        logging.error(f"Environment file {env_file} not found.")
        print(f"Error: Environment file {env_file} not found.")
        return None

    load_dotenv(env_file)
    logging.info(f"Loaded environment from: {os.path.abspath(env_file)}")

    try:
        # Use shared utilities for Pinecone setup
        pinecone_client = get_pinecone_client()
        index_name = get_pinecone_ingest_index_name()

        # Create index if it doesn't exist
        create_pinecone_index_if_not_exists(pinecone_client, index_name)

        # Get the index
        pinecone_index = pinecone_client.Index(index_name)
        logging.info(f"Successfully connected to Pinecone index '{index_name}'.")

        return pinecone_index

    except ValueError as e:
        logging.error(f"Pinecone configuration error: {e}")
        print(f"Error: {e}")
        print(f"Please check your {env_file} file.")
        return None
    except Exception as e:
        logging.error(f"Error connecting to Pinecone: {e}")
        print(f"Error connecting to Pinecone: {e}")
        return None


def _handle_browser_restart(
    p,
    page,
    browser,
    pages_since_restart: int,
    batch_results: list,
    batch_start_time: float,
    crawler: WebsiteCrawler,
) -> tuple:
    """Handle browser restart logic and stats calculation."""
    batch_attempts = len(batch_results)
    batch_successes = batch_results.count(True)
    batch_success_rate = (
        (batch_successes / batch_attempts * 100) if batch_attempts > 0 else 0
    )

    batch_elapsed_time = time.time() - batch_start_time
    pages_per_minute = (
        (pages_since_restart / batch_elapsed_time * 60)
        if batch_elapsed_time > 0
        else float("inf")
    )

    stats = crawler.get_queue_stats()
    stats_message = (
        f"\n--- Stats at {pages_since_restart} page boundary ---\n"
        f"- Processing {pages_per_minute:.1f} pages/minute (last {pages_since_restart} pages)\n"
        f"- Total {stats['visited']} visited pages of {stats['total']} total ({round(stats['visited'] / stats['total'] * 100 if stats['total'] > 0 else 0)}% success)\n"
        f"- Success rate last {batch_attempts} attempts: {round(batch_success_rate)}%\n"
        f"- Total {stats['pending']} pending, {stats['failed']} failed, {stats['pending_retry']} awaiting retry\n"
        f"- Average retries per URL with retries: {stats['avg_retry_count']}\n"
        f"--- End Stats ---"
    )
    for line in stats_message.split("\n"):
        logging.info(line)

    logging.info(
        f"Restarting browser after {pages_since_restart} pages (or due to error)..."
    )
    try:
        if page and not page.is_closed():
            page.close()
        if browser and browser.is_connected():
            browser.close()
    except Exception as close_err:
        logging.warning(f"Error closing browser during restart: {close_err}")

    browser = p.firefox.launch(
        headless=True, firefox_user_prefs={"media.volume_scale": "0.0"}
    )
    page = browser.new_page()
    page.set_extra_http_headers({"User-Agent": USER_AGENT})
    logging.info("Browser restarted successfully.")

    return browser, page, time.time(), []


def _process_page_content(
    content,
    new_links: list,
    url: str,
    crawler: WebsiteCrawler,
    pinecone_index,
    index_name: str,
) -> tuple[int, int]:
    """Process page content and return (pages_processed_increment, pages_since_restart_increment)."""
    if not content:
        error_msg = f"No content extracted from {url}"
        crawler.mark_url_status(url, "failed", error_msg)
        return 0, 0

    try:
        chunks = create_chunks_from_page(content, crawler.text_splitter)
        if chunks:
            content_hash = hashlib.sha256(content.content.encode()).hexdigest()

            if crawler.should_process_content(url, content_hash):
                embeddings = crawler.create_embeddings(chunks, url, content.title)
                upsert_to_pinecone(embeddings, pinecone_index, index_name)
                logging.debug(f"Successfully processed and upserted: {url}")
                logging.debug(
                    f"Created {len(chunks)} chunks, {len(embeddings)} embeddings."
                )
            else:
                logging.info(
                    f"Content unchanged for {url}, skipping embeddings creation"
                )

            crawler.mark_url_status(url, "visited", content_hash=content_hash)
        else:
            crawler.mark_url_status(url, "visited", content_hash="no_content")
            logging.warning(f"No content chunks created for {url}")

        # Add new links to queue
        for link in new_links:
            if (
                crawler.is_valid_url(link)
                and not crawler.should_skip_url(link)
                and not crawler.is_url_visited(link)
            ):
                crawler.add_url_to_queue(link)

        return 1, 1  # Increment both counters for successful processing

    except Exception as e:
        logging.error(f"Failed to process page content {url}: {e}")
        logging.error(traceback.format_exc())
        crawler.mark_url_status(
            url, "failed", f"Failed during content processing: {str(e)}"
        )
        return 0, 0


def _cleanup_browser(page, browser) -> None:
    """Clean up browser resources."""
    if not is_exiting():
        logging.info("Closing browser cleanly...")
        try:
            if "page" in locals() and page and not page.is_closed():
                page.close()
            if "browser" in locals() and browser and browser.is_connected():
                browser.close()
                logging.info("Browser closed.")
        except Exception as e:
            logging.warning(f"Error during clean browser close: {e}")
    else:
        logging.info(
            "Exit requested via signal, skipping potentially blocking browser close."
        )


def _handle_url_processing(url: str, crawler: WebsiteCrawler, browser, page) -> bool:
    """Handle URL processing setup and skip checks. Returns True if restart needed."""
    crawler.current_processing_url = url
    logging.info(f"Processing URL: {url}")

    if crawler.should_skip_url(url):
        logging.info(f"Skipping URL based on skip patterns: {url}")
        crawler.mark_url_status(url, "failed", "Skipped by pattern rule")
        crawler.current_processing_url = None
        return False

    content, new_links, restart_needed = crawler.crawl_page(browser, page, url)

    if restart_needed:
        logging.warning(f"Browser restart requested after attempting {url}.")
        crawler.mark_url_status(url, "pending")
        crawler.current_processing_url = None
        return True

    return False


def _should_stop_crawling(stop_after: int | None, pages_processed: int) -> bool:
    """Check if crawling should stop due to page limit."""
    if stop_after and pages_processed >= stop_after:
        logging.info(f"Reached stop limit of {stop_after} pages. Stopping crawl.")
        return True
    return False


def _process_crawl_iteration(
    url: str,
    crawler: WebsiteCrawler,
    browser,
    page,
    pinecone_index,
    index_name: str,
) -> tuple[int, int, bool]:
    """Process a single crawl iteration. Returns (pages_inc, restart_inc, should_continue)."""
    restart_needed = _handle_url_processing(url, crawler, browser, page)
    if restart_needed:
        return 0, 0, False  # Signal restart needed

    content, new_links, _ = crawler.crawl_page(browser, page, url)

    if is_exiting():
        logging.info(
            "Exit requested after crawling page, stopping before processing/saving."
        )
        return 0, 0, True  # Signal exit

    pages_inc, restart_inc = _process_page_content(
        content, new_links, url, crawler, pinecone_index, index_name
    )

    crawler.commit_db_changes()

    if is_exiting():
        logging.info("Exit requested after saving checkpoint, stopping loop.")
        return 0, 0, True  # Signal exit

    # Rate limiting: Sleep between requests to be respectful to the server
    if pages_inc > 0:  # Only delay if page was successfully processed
        delay = crawler.crawl_delay_seconds
        if delay > 0:
            logging.debug(f"Rate limiting: sleeping for {delay} seconds")
            time.sleep(delay)

    return pages_inc, restart_inc, False  # Continue normally


def _setup_browser(p) -> tuple:
    """Setup and return browser and page."""
    browser = p.firefox.launch(
        headless=True, firefox_user_prefs={"media.volume_scale": "0.0"}
    )
    page = browser.new_page()
    page.set_extra_http_headers({"User-Agent": USER_AGENT})
    return browser, page


def _initialize_crawl_loop(
    args: argparse.Namespace, crawler: WebsiteCrawler
) -> tuple[str, int, int, int, list, float]:
    """Initialize crawl loop variables and return setup values."""
    index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")
    if not index_name:
        logging.error(
            "PINECONE_INGEST_INDEX_NAME not found in environment during loop start."
        )
        return None, 0, 0, 0, [], 0.0

    pages_processed = 0
    pages_since_restart = 0
    batch_results = []
    batch_start_time = time.time()
    PAGES_PER_RESTART = 50
    stop_after = args.stop_after

    if stop_after:
        logging.info(f"Will stop crawling after processing {stop_after} pages")

    stats = crawler.get_queue_stats()
    logging.info(
        f"Initial queue stats: {stats['pending']} pending, {stats['visited']} visited, {stats['failed']} failed"
    )

    return (
        index_name,
        pages_processed,
        pages_since_restart,
        PAGES_PER_RESTART,
        batch_results,
        batch_start_time,
    )


def run_crawl_loop(
    crawler: WebsiteCrawler, pinecone_index: pinecone.Index, args: argparse.Namespace
):
    """Run the main crawling loop."""
    setup_result = _initialize_crawl_loop(args, crawler)
    if setup_result[0] is None:  # index_name is None, error occurred
        return

    (
        index_name,
        pages_processed,
        pages_since_restart,
        PAGES_PER_RESTART,
        batch_results,
        batch_start_time,
    ) = setup_result
    stop_after = args.stop_after

    with sync_playwright() as p:
        browser, page = _setup_browser(p)

        try:
            while not is_exiting():
                if _should_stop_crawling(stop_after, pages_processed):
                    break

                url = crawler.get_next_url_to_crawl()
                if not url:
                    logging.info(
                        "No URLs ready for processing. Sleeping for 60 seconds..."
                    )
                    time.sleep(60)
                    continue

                if pages_since_restart >= PAGES_PER_RESTART:
                    browser, page, batch_start_time, batch_results = (
                        _handle_browser_restart(
                            p,
                            page,
                            browser,
                            pages_since_restart,
                            batch_results,
                            batch_start_time,
                            crawler,
                        )
                    )
                    pages_since_restart = 0
                    continue

                pages_inc, restart_inc, should_exit = _process_crawl_iteration(
                    url, crawler, browser, page, pinecone_index, index_name
                )

                if should_exit:
                    break

                if restart_inc == 0 and pages_inc == 0:  # Restart needed
                    pages_since_restart = PAGES_PER_RESTART
                    continue

                pages_processed += pages_inc
                pages_since_restart += restart_inc
                batch_results.append(pages_inc > 0)

            crawler.current_processing_url = None

        except Exception as e:
            logging.error(f"Browser or main loop error: {e}")
            logging.error(traceback.format_exc())
        finally:
            _cleanup_browser(page, browser)

    if pages_processed == 0:
        logging.warning("No pages were crawled successfully in this run.")
    logging.info(f"Completed processing {pages_processed} pages during this run.")


def handle_fresh_start(args: argparse.Namespace) -> None:
    """Handle --fresh-start flag by deleting existing database."""
    if not args.fresh_start:
        return

    script_dir = Path(__file__).resolve().parent
    db_dir = script_dir / "db"
    db_file_to_delete = db_dir / f"crawler_queue_{args.site}.db"

    if db_file_to_delete.exists():
        try:
            os.remove(db_file_to_delete)
            logging.info(
                f"Successfully deleted database file for fresh start: {db_file_to_delete}"
            )
        except OSError as e:
            logging.error(f"Error deleting database file {db_file_to_delete}: {e}")
            print(
                f"Error: Could not delete database file {db_file_to_delete} for fresh start. Please check permissions or delete manually. Exiting."
            )
            sys.exit(1)
    else:
        logging.info(
            f"--fresh-start specified, but no existing database file found at {db_file_to_delete}. Proceeding with new database."
        )


def handle_clear_vectors(
    args: argparse.Namespace,
    pinecone_index: pinecone.Index,
    domain: str,
    crawler: WebsiteCrawler,
) -> None:
    """Handle --clear-vectors flag by clearing existing vectors."""
    if not args.clear_vectors:
        return

    try:
        logging.info(f"Clearing existing web content vectors for domain '{domain}'...")
        success = clear_library_vectors(
            pinecone_index, domain, dry_run=False, ask_confirmation=True
        )
        if not success:
            logging.error("Vector clearing was cancelled or failed.")
            crawler.close()
            sys.exit(1)
        logging.info("Vector clearing completed successfully.")
    except Exception as e:
        logging.error(f"Error clearing vectors: {e}")
        crawler.close()
        sys.exit(1)


def cleanup_and_exit(crawler: WebsiteCrawler) -> None:
    """Perform final cleanup and exit with appropriate code."""
    if "crawler" in locals() and crawler:
        logging.info("Performing final database commit and cleanup...")
        crawler.commit_db_changes()
        crawler.close()

    if is_exiting():
        logging.info("Exiting script now due to signal request.")
        exit_code = 1
    else:
        logging.info("Script finished normally.")
        exit_code = 0

    sys.exit(exit_code)


def main():
    args = parse_arguments()

    # Load Site Configuration
    site_config = load_config(args.site)
    if not site_config:
        print(
            f"Error: Failed to load configuration for site '{args.site}'. See logs for details."
        )
        sys.exit(1)

    # Environment File
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent.parent
    env_file = project_root / f".env.{args.site}"

    handle_fresh_start(args)

    env_file_str = str(env_file)
    if not os.path.exists(env_file_str):
        print(
            f"Error: Environment file {env_file_str} not found. Pinecone/OpenAI keys required. Exiting."
        )
        sys.exit(1)
    else:
        logging.info(
            f"Will load environment variables from: {os.path.abspath(env_file_str)}"
        )

    # Get Domain & Start URL from Config
    domain = site_config.get("domain")
    if not domain:
        logging.error(
            f"Domain not found in configuration for site '{args.site}'. Exiting."
        )
        print(
            f"Error: Domain not found in configuration for site '{args.site}'. Exiting."
        )
        sys.exit(1)
    start_url = ensure_scheme(domain)
    logging.info(f"Configured domain: {domain}")

    setup_signal_handlers()

    crawler = WebsiteCrawler(
        site_id=args.site, site_config=site_config, retry_failed=args.retry_failed
    )

    pinecone_index = initialize_pinecone(env_file)
    if not pinecone_index:
        crawler.close()
        sys.exit(1)

    handle_clear_vectors(args, pinecone_index, domain, crawler)

    try:
        logging.info(f"Starting crawl of {start_url} for site '{args.site}'")
        run_crawl_loop(crawler, pinecone_index, args)
    except SystemExit:
        logging.info("Exiting due to SystemExit signal.")
    except Exception as e:
        logging.error(f"Unexpected error in main execution: {e}")
        logging.error(traceback.format_exc())
    finally:
        cleanup_and_exit(crawler)


if __name__ == "__main__":
    main()
