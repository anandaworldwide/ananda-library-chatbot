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
#
# Example usage:
#   website_crawler.py --site ananda-public
#   website_crawler.py --site ananda-public --retry-failed

# Standard library imports
import argparse
import hashlib
import logging
import os
import re
import signal
import sqlite3
import sys
import time
import traceback
import json
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse, urlunparse

# Third party imports
import pinecone
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pinecone.exceptions import NotFoundException
from pinecone import ServerlessSpec
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright
from readability import Document  # Added import

# Configure logging with timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Suppress INFO messages from the underlying HTTP library (often httpx)
httpx_logger = logging.getLogger("httpx")
httpx_logger.setLevel(logging.WARNING)

# Define User-Agent constant
USER_AGENT = 'Ananda Chatbot Crawler'

# --- Configuration Loading ---
def load_config(site_id: str) -> Optional[Dict]:
    """Load site configuration from JSON file."""
    config_dir = Path(__file__).parent / 'crawler_config'
    config_file = config_dir / f"{site_id}-config.json"
    if not config_file.exists():
        logging.error(f"Configuration file not found: {config_file}")
        return None
    try:
        with open(config_file, 'r') as f:
            config_data = json.load(f)
        logging.info(f"Loaded configuration from {config_file}")
        # Basic validation (add more as needed)
        if 'domain' not in config_data or 'skip_patterns' not in config_data:
             logging.error("Config file is missing required keys ('domain', 'skip_patterns').")
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
    metadata: Dict

# Function to split content into overlapping chunks by word count
def chunk_content(content: str, target_words: int = 150, overlap_words: int = 75) -> List[str]:
    """Split content into overlapping chunks by word count"""
    words = content.split()
    chunks = []
    start = 0
    total_words = len(words)
    
    logging.debug(f"Starting chunking of {total_words} words")
    
    while start < total_words:
        # Calculate end position
        end = min(start + target_words, total_words)
        
        # If not at the end, look for a good break point
        if end < total_words:
            # Look back up to 20 words for a sentence end
            look_back = min(20, target_words)
            search_text = ' '.join(words[end - look_back:end])
            
            # Find last sentence break
            last_period = search_text.rfind('.')
            if last_period > 0:
                # Count words before the period
                words_to_period = len(search_text[:last_period].split())
                end = end - look_back + words_to_period + 1  # +1 to include the period
        
        # Create chunk
        chunk = ' '.join(words[start:end]).strip()
        if chunk:
            chunks.append(chunk)
            logging.debug(f"Created chunk {len(chunks)}: words {start}-{end} ({end-start} words)")
        
        # Move start position for next chunk with safety check
        new_start = end - overlap_words
        if new_start <= start:  # If we're not making progress
            new_start = end  # Skip overlap and continue from end
            logging.warning(f"Reset overlap calculation at word {end} to avoid infinite loop")
        start = new_start
        
        # Extra safety check
        if len(chunks) > total_words / 50:  # No more than 1 chunk per 50 words
            logging.warning("Too many chunks created, likely an issue with content or chunking logic. Breaking chunk loop.")
            break
    
    logging.debug(f"Chunking complete: {len(chunks)} chunks created")
    return chunks

def ensure_scheme(url: str, default_scheme: str = "https") -> str:
    """Ensure a URL has a scheme, adding a default if missing."""
    parsed = urlparse(url)
    if not parsed.scheme:
        # Reconstruct with default scheme, preserving path, query, etc.
        # Handle schemeless absolute paths like 'domain.com/path'
        if not parsed.netloc and parsed.path:
            parts = parsed.path.split('/', 1)
            netloc = parts[0]
            path = '/' + parts[1] if len(parts) > 1 else ''
            parsed = parsed._replace(scheme=default_scheme, netloc=netloc, path=path)
        else:
            # Standard case
            parsed = parsed._replace(scheme=default_scheme)
        return urlunparse(parsed)
    return url

class WebsiteCrawler:
    def __init__(self, site_id: str, site_config: Dict, retry_failed: bool = False):
        self.site_id = site_id
        self.config = site_config
        self.domain = self.config['domain'] 
        self.start_url = ensure_scheme(self.domain) # Start URL is now just the domain
        self.skip_patterns = self.config.get('skip_patterns', [])
        self.crawl_frequency_days = self.config.get('crawl_frequency_days', 14)
        
        # Set up SQLite database for crawl queue
        db_dir = Path(__file__).parent / 'db'
        db_dir.mkdir(exist_ok=True)
        self.db_file = db_dir / f"crawler_queue_{self.site_id}.db"
        self.conn = sqlite3.connect(str(self.db_file))
        self.conn.row_factory = sqlite3.Row  # Allow dictionary-like access to rows
        self.cursor = self.conn.cursor()
        
        # Create crawl_queue table if it doesn't exist
        self.cursor.execute('''
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
        )''')
        self.conn.commit()
        
        # Track URL being processed
        self.current_processing_url: Optional[str] = None
        
        # Handle --retry-failed flag
        if retry_failed:
            self.retry_failed_urls()
            
        # If queue is empty, seed with start URL
        self.cursor.execute("SELECT COUNT(*) FROM crawl_queue WHERE status = 'pending'")
        pending_count = self.cursor.fetchone()[0]
        
        if pending_count == 0:
            logging.info(f"No pending URLs found. Seeding with start URL: {self.start_url}")
            self.add_url_to_queue(self.start_url, priority=1)
            self.conn.commit()

    def close(self):
        """Close database connection"""
        if hasattr(self, 'conn') and self.conn:
            self.conn.close()
            
    def add_url_to_queue(self, url: str, priority: int = 0):
        """Add URL to crawl queue if not already present"""
        normalized_url = self.normalize_url(url)
        
        try:
            # Use INSERT OR IGNORE to avoid errors if URL already exists
            self.cursor.execute('''
            INSERT OR IGNORE INTO crawl_queue 
            (url, next_crawl, crawl_frequency, status) 
            VALUES (?, datetime('now'), ?, 'pending')
            ''', (normalized_url, self.crawl_frequency_days))
            return True
        except Exception as e:
            logging.error(f"Error adding URL to queue: {e}")
            return False
            
    def retry_failed_urls(self):
        """Reset failed URLs to pending status for retry"""
        try:
            self.cursor.execute('''
            UPDATE crawl_queue 
            SET status = 'pending', next_crawl = datetime('now'), 
                last_error = NULL, retry_count = 0,
                retry_after = NULL, failure_type = NULL
            WHERE status = 'failed' 
            AND (failure_type = 'permanent' OR failure_type IS NULL)
            ''')
            self.conn.commit()
            logging.info(f"Reset {self.cursor.rowcount} previously failed URLs for retry")
        except Exception as e:
            logging.error(f"Error retrying failed URLs: {e}")
            
    def is_url_visited(self, url: str) -> bool:
        """Check if URL has already been successfully visited"""
        normalized_url = self.normalize_url(url)
        self.cursor.execute("SELECT status FROM crawl_queue WHERE url = ? AND status = 'visited'", (normalized_url,))
        return bool(self.cursor.fetchone())
        
    def get_next_url_to_crawl(self) -> Optional[str]:
        """Get the next URL to crawl from the queue"""
        try:
            # Get URLs that are due for crawling, respecting retry_after for temporary failures
            self.cursor.execute('''
            SELECT url FROM crawl_queue 
            WHERE status = 'pending' 
            AND (next_crawl IS NULL OR next_crawl <= datetime('now'))
            AND (retry_after IS NULL OR retry_after <= datetime('now'))
            ORDER BY last_crawl IS NULL DESC, retry_count ASC, next_crawl ASC, url ASC
            LIMIT 1
            ''')
            result = self.cursor.fetchone()
            return result[0] if result else None
        except Exception as e:
            logging.error(f"Error getting next URL to crawl: {e}")
            return None
            
    def mark_url_status(self, url: str, status: str, error_msg: Optional[str] = None, content_hash: Optional[str] = None):
        """Update URL status in the database"""
        normalized_url = self.normalize_url(url)
        now = datetime.now().isoformat()
        
        try:
            if status == 'visited':
                # Calculate next crawl time based on frequency
                next_crawl = (datetime.now() + timedelta(days=self.crawl_frequency_days)).isoformat()
                self.cursor.execute('''
                UPDATE crawl_queue 
                SET status = ?, last_crawl = ?, next_crawl = ?, content_hash = ?,
                    retry_count = 0, retry_after = NULL, failure_type = NULL
                WHERE url = ?
                ''', (status, now, next_crawl, content_hash, normalized_url))
            elif status == 'failed':
                # Determine if failure is temporary or permanent
                is_temporary = False
                
                # Check for typical temporary failure patterns
                temporary_patterns = [
                    'timeout', 'timed out', 
                    'connection', 'reset', 'refused', 
                    'network', 'unreachable',
                    'server error', '5', '503', '502',
                    'overloaded', 'too many requests', '429',
                    'temporarily', 'try again'
                ]
                
                if error_msg:
                    error_lower = error_msg.lower()
                    is_temporary = any(pattern in error_lower for pattern in temporary_patterns)
                
                failure_type = "temporary" if is_temporary else "permanent"
                
                # For temporary failures, set up retry with backoff
                if is_temporary:
                    retry_count = 0
                    self.cursor.execute("SELECT retry_count FROM crawl_queue WHERE url = ?", (normalized_url,))
                    result = self.cursor.fetchone()
                    if result and result[0] is not None:
                        retry_count = result[0] + 1
                    
                    # Exponential backoff: wait longer between retries
                    # Cap at 10 retries (retry_count starts at 1 for first retry)
                    if retry_count <= 10:
                        # 5min, 15min, 1hr, 4hr, 12hr, 24hr, 48hr, 72hr, 96hr, 120hr
                        minutes_to_wait = 5 * (3 ** min(retry_count, 9))
                        retry_after = (datetime.now() + timedelta(minutes=minutes_to_wait)).isoformat()
                        
                        self.cursor.execute('''
                        UPDATE crawl_queue 
                        SET status = 'pending', last_crawl = ?, last_error = ?, 
                            retry_count = ?, retry_after = ?, failure_type = ?
                        WHERE url = ?
                        ''', (now, error_msg, retry_count, retry_after, failure_type, normalized_url))
                        
                        logging.info(f"Temporary failure for {url} (retry {retry_count}/10): Will retry in {minutes_to_wait} minutes")
                    else:
                        # After 10 retries, mark as permanent failure
                        self.cursor.execute('''
                        UPDATE crawl_queue 
                        SET status = 'failed', last_crawl = ?, last_error = ?, 
                            retry_count = ?, failure_type = 'permanent'
                        WHERE url = ?
                        ''', (now, f"{error_msg} [Exceeded max retries]", retry_count, normalized_url))
                        
                        logging.warning(f"Failed URL {url} exceeded maximum retry attempts (10): {error_msg}")
                else:
                    # Permanent failure, don't retry automatically
                    self.cursor.execute('''
                    UPDATE crawl_queue 
                    SET status = ?, last_crawl = ?, last_error = ?, 
                        retry_count = 0, retry_after = NULL, failure_type = ?
                    WHERE url = ?
                    ''', (status, now, error_msg, failure_type, normalized_url))
                    
                    logging.info(f"Permanent failure for {url}: {error_msg}")
            else:
                # Other status updates (like setting to 'pending')
                self.cursor.execute('''
                UPDATE crawl_queue 
                SET status = ?, last_crawl = ? 
                WHERE url = ?
                ''', (status, now, normalized_url))
                
            self.conn.commit()
            return True
        except Exception as e:
            logging.error(f"Error updating URL status: {e}")
            return False
    
    def commit_db_changes(self):
        """Commit any pending database changes"""
        try:
            self.conn.commit()
            logging.debug(f"Database changes committed")
            return True
        except Exception as e:
            logging.error(f"Error committing database changes: {e}")
            return False

    def get_queue_stats(self) -> Dict:
        """Get statistics about the crawl queue"""
        stats = {
            'pending': 0, 
            'visited': 0, 
            'failed': 0, 
            'total': 0,
            'pending_retry': 0,  # URLs waiting to be retried
            'avg_retry_count': 0  # Average retry count for URLs with retries
        }
        try:
            # Get counts by status
            self.cursor.execute('''
            SELECT status, COUNT(*) as count 
            FROM crawl_queue 
            GROUP BY status
            ''')
            for row in self.cursor.fetchall():
                status, count = row['status'], row['count']
                if status in stats:
                    stats[status] = count
                stats['total'] += count
            
            # Count pending URLs with retry_after in the future
            self.cursor.execute('''
            SELECT COUNT(*) FROM crawl_queue 
            WHERE status = 'pending' 
            AND retry_after IS NOT NULL 
            AND retry_after > datetime('now')
            ''')
            stats['pending_retry'] = self.cursor.fetchone()[0]
            
            # Get average retry count for URLs with retries
            self.cursor.execute('''
            SELECT AVG(retry_count) as avg_retries 
            FROM crawl_queue 
            WHERE retry_count > 0
            ''')
            avg_result = self.cursor.fetchone()
            if avg_result and avg_result[0]:
                stats['avg_retry_count'] = round(avg_result[0], 1)
            
            # Count by failure type
            self.cursor.execute('''
            SELECT failure_type, COUNT(*) as count 
            FROM crawl_queue 
            WHERE failure_type IS NOT NULL
            GROUP BY failure_type
            ''')
            for row in self.cursor.fetchall():
                failure_type, count = row['failure_type'], row['count']
                if failure_type:
                    stats[f'{failure_type}_failures'] = count
            
            return stats
        except Exception as e:
            logging.error(f"Error getting queue stats: {e}")
            return stats

    def get_failed_urls(self) -> List[Tuple[str, str]]:
        """Get list of failed URLs with error messages"""
        failed_urls = []
        try:
            self.cursor.execute('''
            SELECT url, last_error 
            FROM crawl_queue 
            WHERE status = 'failed'
            ORDER BY last_crawl DESC
            ''')
            failed_urls = [(row['url'], row['last_error'] or 'Unknown error') 
                          for row in self.cursor.fetchall()]
            return failed_urls
        except Exception as e:
            logging.error(f"Error getting failed URLs: {e}")
            return []

    def normalize_url(self, url: str) -> str:
        """Normalize URL for comparison."""
        parsed = urlparse(url)
        # Strip www and fragments
        normalized = parsed.netloc.replace('www.', '') + parsed.path.rstrip('/')
        return normalized.lower()

    def should_skip_url(self, url: str) -> bool:
        """Check if URL should be skipped based on patterns"""
        return any(re.search(pattern, url) for pattern in self.skip_patterns)

    def is_valid_url(self, url: str) -> bool:
        """Check if URL should be crawled."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.replace('www.', '')
            path = parsed.path.lower()
            
            # Only follow links from the same domain
            if domain != self.domain:
                logging.debug(f"Skipping external domain: {domain}")
                return False
                
            # Skip non-http(s) URLs
            if parsed.scheme not in ['http', 'https']:
                return False
                
            # Skip media files and other non-HTML content
            skip_extensions = [
                '.jpg', '.jpeg', '.png', '.gif', '.svg',
                '.pdf', '.doc', '.docx', '.xls', '.xlsx',
                '.zip', '.rar', '.mp3', '.mp4', '.avi',
                '.mov', '.wmv', '.flv', '.webp',
                '.rss', '.xml' # Added feed types
            ]
            # Added '/feed/' path check
            if any(path.endswith(ext) for ext in skip_extensions) or '/feed/' in path:
                logging.debug(f"Skipping non-HTML content: {url}")
                return False
                
            # Skip wp-content uploads directory
            if '/wp-content/uploads/' in path:
                logging.debug(f"Skipping uploads directory: {url}")
                return False
                
            # Skip anchor-only URLs or root path (already handled by crawler logic, but explicit check is fine)
            if not parsed.path or parsed.path == '/':
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
        soup = BeautifulSoup(html_content, 'html.parser')

        for element in soup.select('header, footer, nav, script, style, iframe, .sidebar'):
            element.decompose()

        main_content = soup.select_one(
            'main, article, .content, #content, .entry-content, .main-content, .post-content'
        )
        text = ""
        if main_content:
            text = main_content.get_text(separator=' ', strip=True)
        elif html_content: # Only try readability if we couldn't find a specific area AND have html
            logging.warning("No specific content area found, attempting readability fallback")
            try:
                doc = Document(html_content)
                # Use the cleaned summary HTML from readability
                summary_html = doc.summary()
                # Parse the summary HTML back into BeautifulSoup to extract text
                summary_soup = BeautifulSoup(summary_html, 'html.parser')
                text = summary_soup.get_text(separator=' ', strip=True)
            except Exception as e:
                logging.error(f"Readability fallback failed: {e}")
                # Fallback to body text if readability fails
                body_content = soup.body
                if body_content:
                    text = body_content.get_text(separator=' ', strip=True)

        text = re.sub(r'\s+', ' ', text).strip()
        if not text:
            logging.warning("No content extracted after fallback attempts")
        else:
            logging.debug(f"Extracted text length: {len(text)}")
        return text

    async def reveal_nav_items(self, page):
        """Reveal all navigation menu items by triggering hover events"""
        try:
            # Click all menu toggles
            await page.click('button.menu-toggle', timeout=1000)
            
            # Find all top-level nav items
            nav_items = await page.query_selector_all('li.menu-item-has-children')
            
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

    def crawl_page(self, browser, page, url: str) -> Tuple[Optional[PageContent], List[str], bool]:
        # Added bool return value: restart_needed
        retries = 2
        last_exception = None # Keep track of the last error
        restart_needed = False # Initialize restart flag

        # Ensure the URL has a scheme before attempting to navigate
        url = ensure_scheme(url) # Overwrite url parameter

        while retries > 0:
            try:
                logging.debug(f"Attempting to navigate to {url} (Attempts left: {retries})")
                page.set_default_timeout(30000) # 30 seconds page timeout

                # --- Navigation Attempt ---
                response = page.goto(url, wait_until='commit')
                # --- Check Response ---
                if not response:
                    logging.error(f"Failed to get response object from {url}")
                    last_exception = Exception("No response object")
                    retries = 0 # Fail immediately if no response object
                    continue
                if response.status >= 400:
                    error_msg = f"HTTP {response.status}"
                    logging.error(f"{error_msg} error for {url}")
                    last_exception = Exception(error_msg)
                    retries = 0 # Don't retry HTTP errors generally
                    continue
                
                # --- Check Content-Type before proceeding ---
                content_type = response.header_value('content-type')
                if content_type and not content_type.lower().startswith('text/html'):
                    logging.info(f"Skipping non-HTML content ({content_type}) at {url}")
                    # Mark as visited because we successfully reached it, even if not processing
                    self.mark_url_status(url, 'visited', content_hash="non_html")
                    return None, [], False # Return no content, no links, no restart needed

                # --- Wait and Extract (Only for HTML) ---
                page.wait_for_selector('body', timeout=15000) # Shorter wait for body after load

                # Evaluate menu handling script (reverting to more complex version)
                try:
                    page.evaluate("""() => {
                        document.querySelectorAll('.menu-item-has-children:not(.active)').forEach((item) => {
                            // Only target top-level items, not items already within an expanded submenu
                            if (!item.closest('.sub-menu')) { 
                                item.classList.add('active'); // Add active class
                                // Attempt to find the direct child submenu
                                const submenu = item.querySelector(':scope > .sub-menu'); 
                                if (submenu) {
                                    // Directly set styles to ensure visibility
                                    submenu.style.display = 'block';
                                    submenu.style.visibility = 'visible';
                                    submenu.style.opacity = '1'; // Add opacity for good measure
                                }
                            }
                        });
                    }""")
                except Exception as menu_e:
                    logging.debug(f"Non-critical menu handling failed for {url}: {menu_e}")

                links = page.evaluate("""() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(href => href && !href.endsWith('#') && !href.includes('/#'))""") # Added check for href existence
                valid_links = [link for link in links if self.is_valid_url(link)]
                if len(links) != len(valid_links):
                     logging.debug(f"Filtered out {len(links) - len(valid_links)} external/invalid links")

                title = page.title() or "No Title Found"
                logging.debug(f"Page title: {title}")
                html_content = page.content()
                clean_text = self.clean_content(html_content)
                logging.debug(f"Cleaned text length: {len(clean_text)}")

                # Ensure links have schemes before returning
                schemed_valid_links = [ensure_scheme(link) for link in valid_links]

                if not clean_text.strip() and title == "No Title Found": # Be more specific about failure
                    logging.warning(f"No content or title extracted from {url}")
                    # Don't retry if no content, just mark as success with no data
                    return None, schemed_valid_links, False # Return links found (with schemes), but no PageContent

                # --- Success ---
                return PageContent(
                    url=url,
                    title=title,
                    content=clean_text,
                    metadata={'type': 'text', 'source': url}
                ), schemed_valid_links, False

            # --- Exception Handling within Retry Loop ---
            except PlaywrightTimeout as e:
                logging.warning(f"Timeout error crawling {url}: {e}. Flagging for browser restart.")
                last_exception = e
                restart_needed = True
                retries = 0 # Abort retries for this URL, trigger restart

            except Exception as e: # Catch other potential Playwright errors or general exceptions
                 # Check if it's the "Target page/context/browser closed" error
                 if "Target page, context or browser has been closed" in str(e):
                      logging.warning(f"Target closed error for {url}: {e}. Flagging for browser restart.")
                      last_exception = e
                      restart_needed = True
                      retries = 0 # Abort retries for this URL, trigger restart

                 # Check for NS_ERROR_ABORT or similar navigation errors
                 elif "playwright" in repr(e).lower() and ("NS_ERROR_ABORT" in str(e) or "Navigation failed because browser has disconnected" in str(e)):
                     logging.warning(f"Browser/Navigation error encountered for {url}: {e}. Flagging for browser restart.")
                     last_exception = e
                     restart_needed = True
                     retries = 0 # Abort retries for this URL, trigger restart
                 
                 # Handle potential asyncio runtime error directly
                 elif isinstance(e, RuntimeError) and "no running event loop" in str(e):
                     logging.error(f"Caught 'no running event loop' error for {url}. Flagging for browser restart.")
                     last_exception = e
                     restart_needed = True
                     retries = 0 # Abort retries for this URL, trigger restart

                 else:
                      # For other unexpected errors, log and stop retrying this URL
                      logging.error(f"Unexpected error crawling {url}: {e}")
                      logging.error(traceback.format_exc())
                      last_exception = e
                      retries = 0 # Stop retrying on unexpected errors

            # Decrement retries only if we are going to loop again and didn't flag for restart
            if retries > 0 and not restart_needed:
                retries -= 1
                if retries > 0:
                     logging.info(f"Waiting 5s before next retry for {url}...")
                     time.sleep(5) # Add a small delay before retrying

        # If loop finishes without success (or flagged for restart)
        if not restart_needed:
             logging.error(f"Giving up on {url} after exhausting retries or encountering fatal error. Last error: {last_exception}")
             # Add to attempted URLs only on normal failure, not restart failure (handled in run_crawl_loop)
             # Store the error message as well
             error_message = str(last_exception) if last_exception else "Unknown error during crawl attempt"
             self.mark_url_status(url, 'failed', error_message)

        # Return based on whether restart is needed
        return None, [], restart_needed # Return restart flag

    def create_embeddings(self, chunks: List[str], url: str, page_title: str) -> List[Dict]:
        """Create embeddings for text chunks."""
        model_name = os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL")
        if not model_name:
            raise ValueError("OPENAI_INGEST_EMBEDDINGS_MODEL environment variable not set")
        embeddings = OpenAIEmbeddings(model=model_name, chunk_size=1000)
        vectors = []
        
        clean_title = sanitize_for_id(page_title)
        url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
        
        for i, chunk in enumerate(chunks):
            vector = embeddings.embed_query(chunk)
            chunk_id = f"text||{self.domain}||{clean_title}||{url_hash}||chunk{i}"

            chunk_metadata = {
                'type': 'text',
                'source': url,
                'title': page_title,
                'library': self.domain,
                'text': chunk,
                'chunk_index': i,
                'total_chunks': len(chunks),
                'crawl_timestamp': datetime.now().isoformat()
            }

            vectors.append({
                'id': chunk_id,
                'values': vector,
                'metadata': chunk_metadata
            })

            logging.debug(f"Vector {i+1}/{len(chunks)} - ID: {chunk_id} - Preview: {chunk[:100]}...")
        
        return vectors
    
    def should_process_content(self, url: str, current_hash: str) -> bool:
        """Check if content has changed and should be processed"""
        self.cursor.execute(
            "SELECT content_hash FROM crawl_queue WHERE url = ? AND status = 'visited'", 
            (self.normalize_url(url),)
        )
        result = self.cursor.fetchone()
        
        # If never seen before or hash has changed, process it
        if not result or not result[0] or result[0] != current_hash:
            return True
        return False

def sanitize_for_id(text: str) -> str:
    """Sanitize text for use in Pinecone vector IDs"""
    # Replace non-ASCII chars with ASCII equivalents
    text = text.replace('—', '-').replace("'", "'").replace('"', '"').replace('"', '"')
    # Remove any remaining non-ASCII chars
    text = ''.join(c for c in text if ord(c) < 128)
    # Replace special chars with underscores, preserving spaces
    text = re.sub(r'[^a-zA-Z0-9\s-]', '_', text)
    return text

def handle_exit(signum, frame):
    """Handle exit signals gracefully"""
    if not hasattr(handle_exit, 'counter'):
        handle_exit.counter = 0
        handle_exit.exit_requested = False # Initialize flag
    handle_exit.counter += 1
    handle_exit.exit_requested = True # Set flag to request graceful exit

    logging.warning(f"Received exit signal ({handle_exit.counter}). Will exit gracefully after current operation. Committing database changes...")

    # Attempt to commit database changes
    if hasattr(handle_exit, 'crawler') and handle_exit.crawler:
        crawler = handle_exit.crawler
        # Put the URL currently being processed back in the queue
        if crawler.current_processing_url:
            try:
                # Mark it as pending to process again
                crawler.mark_url_status(crawler.current_processing_url, 'pending')
                logging.debug(f"Re-queued current URL for next run: {crawler.current_processing_url}")
            except Exception as e:
                logging.error(f"Error re-queuing current URL: {e}")

        try:
            crawler.commit_db_changes()
            logging.info("Database changes committed successfully during exit handler.")
        except Exception as e:
            logging.error(f"Error committing database changes during exit: {e}")

def create_chunks_from_page(page_content) -> List[str]:
    """Create text chunks from page content."""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
        separators=["\n\n", "\n", " ", ""]
    )
    
    # Combine title and content, using the correct attribute name
    full_text = f"{page_content.title}\n\n{page_content.content}"
    chunks = text_splitter.split_text(full_text)
    
    logging.debug(f"Created {len(chunks)} chunks from page")
    return chunks

def upsert_to_pinecone(vectors: List[Dict], index: pinecone.Index, index_name: str):
    """Upsert vectors to Pinecone index."""
    if vectors:
        batch_size = 100  # Pinecone recommends batches of 100 or less
        total_vectors = len(vectors)
        logging.debug(f"Upserting {total_vectors} vectors to Pinecone index '{index_name}' in batches of {batch_size}...")
        
        for i in range(0, total_vectors, batch_size):
            batch = vectors[i:i + batch_size]
            logging.debug(f"Upserting batch {i // batch_size + 1}/{(total_vectors + batch_size - 1) // batch_size} (size: {len(batch)})...")
            try:
                index.upsert(vectors=batch)
                if i > 2:
                    print(".", end="", flush=True)
            except Exception as e:
                logging.error(f"Error upserting batch starting at index {i}: {e}")
                pass # Continue with next batch
        logging.info(f"Upsert of {total_vectors} vectors complete.")

def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description='Crawl a website and store in Pinecone')
    parser.add_argument(
        '--site',
        required=True, # Make site ID required
        help='Site ID for environment variables (e.g., ananda-public). Loads config from crawler_config/[site]-config.json. REQUIRED.'
    )
    parser.add_argument('--retry-failed', action='store_true', help="Retry URLs marked as 'permanent' failed in the database.")
    parser.add_argument('--fresh-start', action='store_true', help="Delete the existing SQLite database and start from a clean slate.")
    return parser.parse_args()

def initialize_pinecone(env_file: str) -> Optional[pinecone.Index]:
    """Load environment, connect to Pinecone, and create index if needed."""
    if not os.path.exists(env_file):
        logging.error(f"Environment file {env_file} not found.")
        print(f"Error: Environment file {env_file} not found.")
        return None
    
    load_dotenv(env_file)
    logging.info(f"Loaded environment from: {os.path.abspath(env_file)}")
    logging.info(f"Using environment from {env_file}")

    # Verify required environment variables
    required_vars = ['PINECONE_API_KEY', 'PINECONE_INGEST_INDEX_NAME', 'OPENAI_API_KEY']
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        error_msg = f"Missing required environment variables: {', '.join(missing_vars)}"
        logging.error(error_msg)
        print(f"Error: {error_msg}")
        print(f"Please check your {env_file} file.")
        return None

    # Initialize Pinecone with new API
    pc = pinecone.Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
    index_name = os.getenv('PINECONE_INGEST_INDEX_NAME')
    if not index_name:
        logging.error("PINECONE_INGEST_INDEX_NAME environment variable is not set.")
        print("Error: PINECONE_INGEST_INDEX_NAME environment variable is not set.")
        return None
    
    logging.info(f"Target Pinecone index: {index_name}")
    pinecone_index = None 
    try:
        pinecone_index = pc.Index(index_name)
        logging.debug(f"Successfully connected to existing Pinecone index '{index_name}'.")

    except NotFoundException:
        logging.warning(f"Pinecone index '{index_name}' not found.")
        user_input = input(f"Index '{index_name}' does not exist. Create it now? (y/N): ").strip().lower()

        if user_input == 'y':
            try:
                dimension_str = os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION")
                if not dimension_str:
                    raise ValueError("OPENAI_INGEST_EMBEDDINGS_DIMENSION environment variable not set")
                dimension = int(dimension_str)
                metric = 'cosine' # Standard metric for semantic search
                spec = ServerlessSpec(
                    cloud='aws', 
                    region='us-west-2'
                )
                logging.info(f"Creating Pinecone index '{index_name}' with dimension={dimension}, metric='{metric}', spec={spec}...")
                pc.create_index(
                    name=index_name, 
                    dimension=dimension, 
                    metric=metric,
                    spec=spec
                )

                # Wait for the index to be ready
                wait_time = 10 # seconds - adjust as needed
                logging.info(f"Waiting {wait_time} seconds for index '{index_name}' to initialize...")
                time.sleep(wait_time)

                # Try connecting again
                pinecone_index = pc.Index(index_name)
                logging.info(f"Successfully created and connected to Pinecone index '{index_name}'.")

            except Exception as create_e:
                # Log the full error for detailed debugging
                logging.error(f"Failed to create or connect to Pinecone index '{index_name}' after user confirmation: {create_e}")

                # Try to extract a more user-friendly message for the print statement
                pinecone_specific_error = ""
                error_status_code = None
                try:
                    # Pinecone API exceptions (like ApiException) often have a 'body' attribute with JSON
                    # and a 'status' attribute for the HTTP status code.
                    if hasattr(create_e, 'status'):
                        error_status_code = create_e.status
                    
                    if hasattr(create_e, 'body') and isinstance(create_e.body, str):
                        error_data = json.loads(create_e.body)
                        if isinstance(error_data, dict):
                            if 'error' in error_data and isinstance(error_data['error'], dict) and 'message' in error_data['error']:
                                pinecone_specific_error = error_data['error']['message']
                            elif 'message' in error_data: # Sometimes the message is at the top level
                                pinecone_specific_error = error_data['message']
                            
                            # If status code wasn't directly on create_e, try to get it from body
                            if error_status_code is None and 'status' in error_data:
                                error_status_code = error_data['status']
                
                except json.JSONDecodeError:
                    logging.debug(f"Could not parse Pinecone error body for detailed message: {getattr(create_e, 'body', 'N/A')}")
                except Exception as e_parse: # Catch any other error during parsing details
                    logging.debug(f"An error occurred while parsing Pinecone exception details: {e_parse}")

                # Construct the user-facing error message
                user_message_parts = [f"Error: Failed to create Pinecone index '{index_name}'."]
                if pinecone_specific_error:
                    user_message_parts.append(f"Reason: {pinecone_specific_error}.")
                else:
                    # Fallback detail if specific message wasn't extracted but we have the original exception
                    user_message_parts.append(f"Details: {str(create_e)[:200]}...")


                if error_status_code:
                    user_message_parts.append(f"(Status Code: {error_status_code})")
                
                user_message_parts.append("Please check logs for full details or the Pinecone console. Exiting.")
                final_user_message = " ".join(user_message_parts)
                
                print(final_user_message)
                return None # Indicate failure
        else:
            logging.info("User declined to create the index. Exiting.")
            print("Operation aborted by user. Index not found.")
            return None # Indicate failure

    except Exception as e:
        # Catch other potential connection errors
        logging.error(f"Error connecting to Pinecone index '{index_name}': {e}")
        print(f"Error connecting to Pinecone index '{index_name}': {e}")
        return None # Indicate failure
        
    return pinecone_index

def run_crawl_loop(crawler: WebsiteCrawler, pinecone_index: pinecone.Index, args: argparse.Namespace):
    """Run the main crawling loop."""
    # Get index name (needed for upsert)
    index_name = os.getenv('PINECONE_INGEST_INDEX_NAME')
    if not index_name:
        logging.error("PINECONE_INGEST_INDEX_NAME not found in environment during loop start.")
        return # Should not happen if initialize_pinecone succeeded

    pages_processed = 0
    pages_since_restart = 0
    batch_results = [] # Track success/failure for the current batch
    batch_start_time = time.time()
    PAGES_PER_RESTART = 50

    # Log queue stats at start
    stats = crawler.get_queue_stats()
    logging.info(f"Initial queue stats: {stats['pending']} pending, {stats['visited']} visited, {stats['failed']} failed")
        
    with sync_playwright() as p:
        browser = p.firefox.launch(
            headless=True, 
            firefox_user_prefs={"media.volume_scale": "0.0"} # Mute audio
        )
        page = browser.new_page() # Create page initially
        page.set_extra_http_headers({'User-Agent': USER_AGENT})
        should_continue_loop = True # Flag to control the main loop
        
        try:
            start_run_time = time.time()

            # Modified loop condition to check exit flag
            while should_continue_loop and not handle_exit.exit_requested:
                # Get next URL to process
                url = crawler.get_next_url_to_crawl()
                if not url:
                    # No URLs ready to process, sleep then check again
                    logging.info("No URLs ready for processing. Sleeping for 60 seconds...")
                    time.sleep(60)
                    continue
                
                # --- Browser Restart Logic ---
                if pages_since_restart >= PAGES_PER_RESTART:
                    # Calculate batch success rate
                    batch_attempts = len(batch_results)
                    batch_successes = batch_results.count(True)
                    batch_success_rate = (batch_successes / batch_attempts * 100) if batch_attempts > 0 else 0

                    # Calculate and log stats
                    batch_elapsed_time = time.time() - batch_start_time
                    # Avoid division by zero if batch_elapsed_time is very small
                    if batch_elapsed_time > 0:
                        pages_per_minute = (pages_since_restart / batch_elapsed_time * 60)
                    else:
                        pages_per_minute = float('inf') # Or some other indicator
                    
                    stats = crawler.get_queue_stats()
                    
                    stats_message = (
                        f"\n--- Stats at {pages_since_restart} page boundary ---\n"
                        f"- Processing {pages_per_minute:.1f} pages/minute (last {pages_since_restart} pages)\n"
                        f"- Total {stats['visited']} visited pages of {stats['total']} total ({round(stats['visited']/stats['total']*100 if stats['total'] > 0 else 0)}% success)\n"
                        f"- Success rate last {batch_attempts} attempts: {round(batch_success_rate)}%\n"
                        f"- Total {stats['pending']} pending, {stats['failed']} failed, {stats['pending_retry']} awaiting retry\n"
                        f"- Average retries per URL with retries: {stats['avg_retry_count']}\n"
                        f"--- End Stats ---"
                    )
                    for line in stats_message.split('\n'):
                        logging.info(line)

                    # Restart Browser
                    logging.info(f"Restarting browser after {pages_since_restart} pages (or due to error)...")
                    try:
                        if page and not page.is_closed():
                            page.close()
                        if browser and browser.is_connected():
                            browser.close()
                    except Exception as close_err:
                        logging.warning(f"Error closing browser during restart: {close_err}")
                    
                    browser = p.firefox.launch(
                        headless=True,
                        firefox_user_prefs={"media.volume_scale": "0.0"}
                    )
                    page = browser.new_page()
                    page.set_extra_http_headers({'User-Agent': USER_AGENT})
                    pages_since_restart = 0
                    batch_start_time = time.time()
                    batch_results = [] # Reset batch results for new batch
                    logging.info("Browser restarted successfully.")
                    # Skip to next iteration to avoid processing URL with potentially old page object
                    # Continue is important here to ensure the loop condition re-evaluates
                    continue 

                crawler.current_processing_url = url # Track current URL
                                
                logging.info(f"Processing URL: {url}")
                
                # --- Add skip pattern check ---
                if crawler.should_skip_url(url):
                    logging.info(f"Skipping URL based on skip patterns: {url}")
                    crawler.mark_url_status(url, 'failed', "Skipped by pattern rule")
                    crawler.current_processing_url = None # Reset since we're skipping
                    continue
                # --- End skip pattern check ---
                
                # Reset processing URL before crawl attempt
                crawler.current_processing_url = url # Track current URL
                content, new_links, restart_needed = crawler.crawl_page(browser, page, url) # Capture restart flag
                
                # --- Handle Restart Request ---
                if restart_needed:
                    logging.warning(f"Browser restart requested after attempting {url}.")
                    crawler.mark_url_status(url, 'pending')  # Mark as pending to try again
                    # Force restart by setting counter past the limit
                    pages_since_restart = PAGES_PER_RESTART 
                    crawler.commit_db_changes() # Save state before forcing restart
                    crawler.current_processing_url = None
                    continue # Skip rest of loop, trigger restart block at the top of the next iteration

                # --- Process Normal Result ---
                is_success = content is not None
                batch_results.append(is_success)

                if handle_exit.exit_requested:
                    logging.info("Exit requested after crawling page, stopping before processing/saving.")
                    break

                if content: # Page crawled successfully
                    pages_processed += 1
                    pages_since_restart += 1 # Increment only on successful crawl

                    try:
                        chunks = create_chunks_from_page(content)
                        if chunks:
                            # Calculate content hash for change detection
                            content_hash = hashlib.sha256(content.content.encode()).hexdigest()
                            
                            # Check if content has changed (if we've seen this URL before)
                            if crawler.should_process_content(url, content_hash):
                                embeddings = crawler.create_embeddings(chunks, url, content.title)
                                upsert_to_pinecone(embeddings, pinecone_index, index_name)
                                logging.debug(f"Successfully processed and upserted: {url}")
                                logging.debug(f"Created {len(chunks)} chunks, {len(embeddings)} embeddings.")
                            else:
                                logging.info(f"Content unchanged for {url}, skipping embeddings creation")

                            # Mark URL as visited with content hash
                            crawler.mark_url_status(url, 'visited', content_hash=content_hash)
                        else:
                            # No chunks created, still mark as visited but note the issue
                            crawler.mark_url_status(url, 'visited', content_hash="no_content")
                            logging.warning(f"No content chunks created for {url}")
                        
                        # Add new links to queue
                        for link in new_links:
                            if crawler.is_valid_url(link) and not crawler.should_skip_url(link) and not crawler.is_url_visited(link):
                                crawler.add_url_to_queue(link)

                    except Exception as e:
                        logging.error(f"Failed to process page content {url}: {e}")
                        logging.error(traceback.format_exc())
                        crawler.mark_url_status(url, 'failed', f"Failed during content processing: {str(e)}")

                else: # Page crawl failed normally
                    # Get error message from attempted_urls if it was set there
                    error_msg = f"No content extracted from {url}"
                    crawler.mark_url_status(url, 'failed', error_msg)

                # Save changes after processing URL
                crawler.commit_db_changes()

                if handle_exit.exit_requested:
                    logging.info("Exit requested after saving checkpoint, stopping loop.")
                    break

            crawler.current_processing_url = None

        except Exception as e:
            logging.error(f"Browser or main loop error: {e}")
            logging.error(traceback.format_exc())
        finally:
            # Ensure browser is closed cleanly unless exit was requested
            if not handle_exit.exit_requested:
                logging.info("Closing browser cleanly...")
                try:
                    if 'page' in locals() and page and not page.is_closed():
                         page.close()
                    if 'browser' in locals() and browser and browser.is_connected():
                         browser.close()
                         logging.info("Browser closed.")
                except Exception as e:
                    logging.warning(f"Error during clean browser close: {e}")
            else:
                logging.info("Exit requested via signal, skipping potentially blocking browser close.")
                
    if pages_processed == 0:
        logging.warning("No pages were crawled successfully in this run.")
    logging.info(f"Completed processing {pages_processed} pages during this run.")

def main():
    # Reset exit counter at start
    handle_exit.counter = 0
    handle_exit.exit_requested = False
    
    args = parse_arguments()

    # --- Load Site Configuration ---
    site_config = load_config(args.site)
    if not site_config:
        print(f"Error: Failed to load configuration for site '{args.site}'. See logs for details.")
        sys.exit(1)

    # --- Environment File ---
    # Construct path relative to the script's location
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent.parent  # Go up two levels for project root
    env_file = project_root / f".env.{args.site}"

    # --- Handle --fresh-start ---    
    if args.fresh_start:
        db_dir = script_dir / 'db' # Path to db directory within crawler script's directory
        db_file_to_delete = db_dir / f"crawler_queue_{args.site}.db"
        if db_file_to_delete.exists():
            try:
                os.remove(db_file_to_delete)
                logging.info(f"Successfully deleted database file for fresh start: {db_file_to_delete}")
            except OSError as e:
                logging.error(f"Error deleting database file {db_file_to_delete}: {e}")
                print(f"Error: Could not delete database file {db_file_to_delete} for fresh start. Please check permissions or delete manually. Exiting.")
                sys.exit(1)
        else:
            logging.info(f"--fresh-start specified, but no existing database file found at {db_file_to_delete}. Proceeding with new database.")

    # Convert Path object to string for os.path.exists
    env_file_str = str(env_file)
    if not os.path.exists(env_file_str):
        print(f"Error: Environment file {env_file_str} not found. Pinecone/OpenAI keys required. Exiting.")
        sys.exit(1)
    else:
        logging.info(f"Will load environment variables from: {os.path.abspath(env_file_str)}")

    # --- Get Domain & Start URL from Config ---
    domain = site_config.get('domain')
    if not domain:
        logging.error(f"Domain not found in configuration for site '{args.site}'. Exiting.")
        print(f"Error: Domain not found in configuration for site '{args.site}'. Exiting.")
        sys.exit(1)
    start_url = ensure_scheme(domain)
    logging.info(f"Configured domain: {domain}")

    # Set up signal handlers
    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    # Initialize crawler, passing site_id, config, and retry flag.
    crawler = WebsiteCrawler(site_id=args.site, site_config=site_config, retry_failed=args.retry_failed)
    handle_exit.crawler = crawler  # Store crawler reference for signal handler

    # Initialize Pinecone
    pinecone_index = initialize_pinecone(env_file)
    if not pinecone_index:
        crawler.close()  # Close database connection
        sys.exit(1) # Exit if Pinecone initialization failed

    # --- Start Crawl ---
    try:
        logging.info(f"Starting crawl of {start_url} for site '{args.site}'")

        # Run the main crawl loop
        run_crawl_loop(crawler, pinecone_index, args)
        
    except SystemExit:
        logging.info("Exiting due to SystemExit signal.")
    except Exception as e:
        logging.error(f"Unexpected error in main execution: {e}")
        logging.error(traceback.format_exc())
    finally:
        if 'crawler' in locals():
            logging.info("Performing final database commit and cleanup...")
            crawler.commit_db_changes() # Ensure final save
            crawler.close()  # Close database connection
        if handle_exit.exit_requested:
            logging.info("Exiting script now due to signal request.")
        else:
             logging.info("Script finished normally.") 
        # Use explicit exit code
        exit_code = 1 if handle_exit.exit_requested else 0
        sys.exit(exit_code)

if __name__ == "__main__":
    main()
