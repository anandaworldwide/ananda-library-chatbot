#! /usr/bin/env python
#
# This script is a web crawler designed to scrape content from a specified domain and store it in a Pinecone index.
# It uses Playwright for browser automation and BeautifulSoup for HTML parsing.
# The crawler maintains state across runs using checkpoints and can resume from where it left off.
# It filters out unwanted URLs and media files, focusing on text content.
# The script also handles exit signals gracefully, saving its state before shutting down.
#
# Command line arguments:
#   --site: Site ID for environment variables (e.g., ananda-public). Will load from .env.[site]
#           Default: 'ananda-public'
#   --domain: Domain to crawl (e.g., ananda.org)
#             Default: 'ananda.org'
#   --continue: Continue from previous checkpoint (if available)
#               Default: False (start fresh)
#   --active-hours: Optional active time range (e.g., "9pm-6am" or "21:00-06:00"). 
#                   Crawler pauses outside this window.
#   --retry-failed: Retry URLs marked as failed in the previous checkpoint.
#   --report: Generate a report of failed URLs from the last checkpoint and exit.
#
# Example usage:
#   python website_crawler.py --domain ananda.org
#   python website_crawler.py --site ananda-public --continue
#   python website_crawler.py --domain crystalclarity.com --site crystal-clarity

# Standard library imports
import argparse
import hashlib
import logging
import os
import pickle
import re
import signal
import sys
import time
import traceback
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

@dataclass
class CrawlerState:
    visited_urls: Set[str]
    attempted_urls: Dict[str, str]  # URLs we've tried but failed. Changed from Set[str] to Dict[str, str].
    pending_urls: List[str]   # Queue of URLs to visit

class WebsiteCrawler:
    def __init__(self, start_url: str = "https://ananda.org", retry_failed: bool = False):
        self.start_url = start_url
        self.domain = urlparse(start_url).netloc.replace('www.', '')
        checkpoint_dir = Path(__file__).parent / 'checkpoints'
        checkpoint_dir.mkdir(exist_ok=True)
        self.checkpoint_file = checkpoint_dir / f"crawler_checkpoint_{self.domain}.pkl"
        self.current_processing_url: Optional[str] = None # Track URL being processed
        
        # Initialize state
        self.state = CrawlerState(
            visited_urls=set(),
            attempted_urls={},
            pending_urls=[start_url]
        )
        
        # Load previous checkpoint if exists
        if self.checkpoint_file.exists():
            try:
                with open(self.checkpoint_file, 'rb') as f:
                    loaded_state = pickle.load(f)
                    # Load visited URLs
                    self.state.visited_urls = loaded_state.visited_urls

                    # Filter and load pending URLs, ensuring scheme
                    filtered_urls = [ensure_scheme(url) for url in loaded_state.pending_urls if self.is_valid_url(url)]
                    initial_pending = [ensure_scheme(self.start_url)] if ensure_scheme(self.start_url) not in self.state.visited_urls else []
                    self.state.pending_urls = filtered_urls or initial_pending
                    logging.info(f"Loaded checkpoint: {len(self.state.visited_urls)} visited, {len(self.state.pending_urls)} pending URLs")
                    if len(loaded_state.pending_urls) != len(filtered_urls):
                        logging.debug(f"Filtered out {len(loaded_state.pending_urls) - len(filtered_urls)} invalid pending URLs")

                    # --- Handle attempted_urls (including migration) ---
                    if hasattr(loaded_state, 'attempted_urls'):
                        # @TODO: Remove this migration logic after a few runs
                        if isinstance(loaded_state.attempted_urls, set):
                            # Migrate from Set to Dict
                            logging.warning("Migrating attempted_urls from old set format to new dictionary format.")
                            self.state.attempted_urls = {ensure_scheme(url): "Failure recorded in previous version" for url in loaded_state.attempted_urls}
                            logging.info(f"Migrated {len(self.state.attempted_urls)} URLs from old attempted_urls format.")
                        elif isinstance(loaded_state.attempted_urls, dict):
                            # Load existing Dict, ensuring keys have schemes
                            self.state.attempted_urls = {ensure_scheme(url): msg for url, msg in loaded_state.attempted_urls.items()}
                        else:
                            logging.warning(f"Unexpected type for attempted_urls in checkpoint: {type(loaded_state.attempted_urls)}. Initializing as empty.")
                            self.state.attempted_urls = {}
                    else:
                         # Checkpoint existed but had no attempted_urls attribute
                         self.state.attempted_urls = {}

                    # Handle --retry-failed flag passed from main
                    if retry_failed and self.state.attempted_urls:
                        # Ensure scheme when creating retry list from keys
                        retry_urls = list(self.state.attempted_urls.keys()) # Already have schemes due to loading logic
                        logging.info(f"Retry requested: Re-queuing {len(retry_urls)} previously failed URLs.")
                        # Prepend failed URLs to the front of the queue
                        # Filter out any retry URLs that might already be pending (unlikely but safe)
                        existing_pending_set = set(self.state.pending_urls)
                        unique_retry_urls = [url for url in retry_urls if url not in existing_pending_set]
                        self.state.pending_urls = unique_retry_urls + self.state.pending_urls
                        # Clear attempted URLs for this run to avoid immediate re-marking on failure
                        self.state.attempted_urls = {}
                    # No 'else' needed here, attempted_urls already loaded/migrated correctly

            except Exception as e:
                logging.error(f"Failed to load checkpoint: {e}")
                # Initialize fresh state if loading fails
                self.state = CrawlerState(
                    visited_urls=set(),
                    attempted_urls={},
                    pending_urls=[self.start_url] if self.is_valid_url(self.start_url) else []
                )

        # Skip patterns for URLs
        self.skip_patterns = [
            r'/search/',
            r'/login/',
            r'/cart/',
            r'/account/',
            r'/checkout/',
            r'/wp-admin/',
            r'\?',  # Skip URLs with query parameters
            # --- Specific Exclusions ---
            r'/online-courses/lessons-in-meditation-reviews/',
            r'/autobiography',
            r'/free-inspiration/books/efl' # Added due to redirect timeout loop
        ]

    def save_checkpoint(self):
        """Save crawler state to checkpoint file"""
        try:
            with open(self.checkpoint_file, 'wb') as f:
                pickle.dump(self.state, f)
            logging.info(f"Saved checkpoint: {len(self.state.visited_urls)} visited, {len(self.state.pending_urls)} pending")
        except Exception as e:
            logging.error(f"Failed to save checkpoint: {e}")

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

    def wait_if_inactive(self, start_time_obj: Optional[dt_time], end_time_obj: Optional[dt_time], active_hours_str: Optional[str]):
        """Checks if current time is outside active hours and sleeps if needed. Returns False if exit requested during sleep, True otherwise."""
        is_active, sleep_duration_seconds = is_within_time_range(start_time_obj, end_time_obj)
        if not is_active and sleep_duration_seconds is not None and sleep_duration_seconds > 0:
            sleep_hours = sleep_duration_seconds / 3600
            wake_time = (datetime.now() + timedelta(seconds=sleep_duration_seconds)).strftime('%Y-%m-%d %H:%M:%S')
            logging.info(f"Outside active hours ({active_hours_str}). Sleeping for {sleep_hours:.2f} hours until {wake_time}. Saving checkpoint.")
            self.save_checkpoint() # Use self.save_checkpoint
            try:
                # Sleep in shorter intervals to allow faster exit if signal received
                sleep_interval = 60 # Sleep for 1 minute at a time
                remaining_sleep = sleep_duration_seconds
                while remaining_sleep > 0:
                    if handle_exit.exit_requested:
                        logging.info("Exit signal received during sleep. Stopping.")
                        return False # Indicates sleep was interrupted by exit request
                    sleep_this_interval = min(sleep_interval, remaining_sleep)
                    time.sleep(sleep_this_interval)
                    remaining_sleep -= sleep_this_interval
                logging.info("Woke up. Resuming crawl.")
            except KeyboardInterrupt:
                logging.info("Keyboard interrupt during sleep. Stopping.")
                handle_exit.exit_requested = True # Ensure graceful shutdown
                return False # Indicates sleep was interrupted by exit request
        # Return True if active, no sleep needed, or sleep completed normally
        return True

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

        while retries > 0:
            try:
                logging.debug(f"Navigating to {url} (Attempts left: {retries})")
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
                    logging.error(f"HTTP {response.status} error for {url}")
                    last_exception = Exception(f"HTTP {response.status}")
                    retries = 0 # Don't retry HTTP errors generally
                    continue
                
                # --- Check Content-Type before proceeding ---
                content_type = response.header_value('content-type')
                if content_type and not content_type.lower().startswith('text/html'):
                    logging.info(f"Skipping non-HTML content ({content_type}) at {url}")
                    # Mark as visited because we successfully reached it, even if not processing
                    self.state.visited_urls.add(self.normalize_url(url))
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
             self.state.attempted_urls[self.normalize_url(url)] = error_message

        # Return based on whether restart is needed
        return None, [], restart_needed # Return restart flag

    def create_embeddings(self, chunks: List[str], url: str, page_title: str) -> List[Dict]:
        """Create embeddings for text chunks."""
        embeddings = OpenAIEmbeddings()
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

    logging.warning(f"Received exit signal ({handle_exit.counter}). Will exit gracefully after current operation. Saving checkpoint...")

    # Attempt to save checkpoint
    if hasattr(handle_exit, 'crawler') and handle_exit.crawler:
        crawler = handle_exit.crawler
        # Put the URL currently being processed back in the queue
        if crawler.current_processing_url and crawler.current_processing_url not in crawler.state.pending_urls:
            # Insert at the beginning to retry it first on resume
            logging.debug(f"Re-queuing URL in progress: {crawler.current_processing_url}")
            crawler.state.pending_urls.insert(0, crawler.current_processing_url)

        try:
            crawler.save_checkpoint()
            logging.info("Checkpoint saved successfully during exit handler.")
        except Exception as e:
            logging.error(f"Error saving checkpoint during exit: {e}")

    # No longer force immediate exit - allow main loop to terminate
    # os._exit(1)

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

def parse_time_string(time_str: str) -> Optional[dt_time]:
    """Parse HH:MM (24hr) or H:MMam/pm time string into a time object."""
    time_str = time_str.strip().lower()
    # Added %I%p for cases like "9pm"
    formats_to_try = [
        '%H:%M',       # 24-hour (e.g., 14:30)
        '%I:%M%p',     # 12-hour AM/PM (e.g., 2:30pm)
        '%I%p',        # 12-hour AM/PM no minutes (e.g., 9pm)
    ]
    for fmt in formats_to_try:
        try:
             # No change needed here, strptime handles the format directly
             parsed_time = datetime.strptime(time_str, fmt).time()
             return parsed_time
        except ValueError:
            continue # Try next format

    logging.error(f"Invalid time format: '{time_str}'. Use HH:MM (24hr) or H:MMam/pm (e.g., 9:00pm, 14:30).")
    return None

def parse_time_range_string(range_str: Optional[str]) -> Tuple[Optional[dt_time], Optional[dt_time]]:
    """Parse 'START-END' time range string into start and end time objects."""
    if not range_str:
        return None, None
    parts = range_str.split('-')
    if len(parts) != 2:
        logging.error(f"Invalid time range format: {range_str}. Use START-END format (e.g., 9:00pm-5:00am).")
        return None, None
    start_str, end_str = parts
    start_time = parse_time_string(start_str)
    end_time = parse_time_string(end_str)
    return start_time, end_time

def is_within_time_range(start_time_obj: Optional[dt_time], end_time_obj: Optional[dt_time]) -> Tuple[bool, Optional[float]]:
    """Check if the current time is within the specified range. Handles overnight ranges. Returns (is_within, sleep_seconds)."""
    if not start_time_obj or not end_time_obj:
        return True, None  # No range specified, always within

    now = datetime.now()
    current_time = now.time()

    # Check if range spans midnight (e.g., 21:00 to 05:00)
    if start_time_obj <= end_time_obj:
        # Normal range (e.g., 09:00 to 17:00)
        is_within = start_time_obj <= current_time <= end_time_obj
    else:
        # Overnight range (e.g., 21:00 to 05:00)
        is_within = current_time >= start_time_obj or current_time <= end_time_obj

    if is_within:
        return True, None
    else:
        # Calculate time until the next start time
        start_datetime_today = now.replace(hour=start_time_obj.hour, minute=start_time_obj.minute, second=0, microsecond=0)

        next_start_datetime = start_datetime_today
        # If current time is past today's end time (for overnight) OR past today's start time (for same day)
        if (start_time_obj > end_time_obj and current_time > end_time_obj) or \
           (start_time_obj <= end_time_obj and current_time > start_time_obj): 
             if now >= start_datetime_today:
                 next_start_datetime += timedelta(days=1)
        # Handle case where it's before the start time on the same day (for overnight range)
        elif start_time_obj > end_time_obj and current_time < start_time_obj:
             # next_start_datetime is already correctly set to today's start time
             pass 

        sleep_duration_seconds = max(0, (next_start_datetime - now).total_seconds())
        return False, sleep_duration_seconds

def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description='Crawl a website and store in Pinecone')
    parser.add_argument(
        '--site', 
        default='ananda-public',
        help='Site ID for environment variables (e.g., ananda-public). Will load from .env.[site]'
    )
    parser.add_argument('--domain', default='ananda.org', help='Domain to crawl (e.g., ananda.org)')
    parser.add_argument('--continue', action='store_true', help='Continue from previous checkpoint')
    parser.add_argument(
        '--active-hours',
        type=str,
        default=None,
        help='Optional active time range (e.g., "9pm-5am" or "21:00-05:00"). Crawler pauses outside this window.'
    )
    parser.add_argument('--retry-failed', action='store_true', help='Retry URLs marked as failed in the previous checkpoint.')
    parser.add_argument('--report', action='store_true', help='Generate a report of failed URLs from the last checkpoint and exit.')
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
                dimension = 1536 # Standard dimension for OpenAI ada-002 embeddings
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
                logging.error(f"Failed to create or connect to Pinecone index '{index_name}' after user confirmation: {create_e}")
                print(f"Error: Failed to create index '{index_name}'. Please check Pinecone console/logs. Exiting.")
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

def run_crawl_loop(crawler: WebsiteCrawler, pinecone_index: pinecone.Index, args: argparse.Namespace, start_time_obj: Optional[dt_time], end_time_obj: Optional[dt_time]):
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

    # Ensure we have a starting URL
    if not crawler.state.pending_urls:
        logging.warning("No pending URLs found in state, reinitializing queue with start URL.")
        crawler.state.pending_urls = [crawler.start_url]
        
    logging.info(f"Initial queue size: {len(crawler.state.pending_urls)} URLs")
    logging.info(f"First URL in queue: {crawler.state.pending_urls[0] if crawler.state.pending_urls else 'None'}")

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

            # --- Initial Time Check Before Loop ---
            logging.debug("Performing initial active hours check...")
            should_continue_loop = crawler.wait_if_inactive(start_time_obj, end_time_obj, args.active_hours)
            if not should_continue_loop:
                logging.info("Exiting after initial sleep interruption.")
                # Let finally block handle cleanup
            
            # Modified loop condition to check exit flag
            while crawler.state.pending_urls and should_continue_loop and not handle_exit.exit_requested:
                # --- Browser Restart Logic ---
                # Trigger restart if counter reaches limit OR if restart_needed was flagged last iteration
                # (restart_needed logic is handled *after* crawl_page call below)
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
                    
                    total_visited = len(crawler.state.visited_urls)
                    total_attempted = total_visited + len(crawler.state.attempted_urls)
                    success_rate = (total_visited / total_attempted * 100) if total_attempted > 0 else 0
                    pending_count = len(crawler.state.pending_urls)
                    
                    stats_message = (
                        f"\n--- Stats at {pages_since_restart} page boundary ---\n"
                        f"- Processing {pages_per_minute:.1f} pages/minute (last {pages_since_restart} pages)\n"
                        f"- Total {total_visited} visited pages of {total_attempted} attempted ({round(success_rate)}% success)\n"
                        f"- Success rate last {batch_attempts} attempts: {round(batch_success_rate)}%\n"
                        f"- Total {pending_count} pending pages\n"
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
                        logging.warning(f"Error closing browser/page during restart: {close_err}")
                    
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

                # --- Time Check Inside Loop ---
                should_continue_loop = crawler.wait_if_inactive(start_time_obj, end_time_obj, args.active_hours)
                if not should_continue_loop:
                    logging.info("Exit requested during sleep, breaking main loop.")
                    break # Exit while loop
                
                if handle_exit.exit_requested:
                    logging.info("Exit requested before processing next URL, breaking loop.")
                    break

                url = crawler.state.pending_urls.pop(0)
                crawler.current_processing_url = url # Track current URL
                normalized_url = crawler.normalize_url(url)
                
                logging.info(f"Processing URL: {url}")
                logging.debug(f"Remaining in queue: {len(crawler.state.pending_urls)}")
                
                if normalized_url in crawler.state.visited_urls:
                    logging.debug(f"Skipping already visited URL: {url}")
                    continue
                    
                # Reset processing URL before crawl attempt
                crawler.current_processing_url = url # Track current URL
                content, new_links, restart_needed = crawler.crawl_page(browser, page, url) # Capture restart flag
                
                # --- Handle Restart Request ---
                if restart_needed:
                    logging.warning(f"Browser restart requested after attempting {url}.")
                    crawler.state.attempted_urls.add(normalized_url) # Mark as attempted
                    # Re-queue the URL to try again after restart
                    if url not in crawler.state.pending_urls: # Avoid duplicate re-queueing
                       logging.debug(f"Re-queuing {url} for retry after browser restart.")
                       crawler.state.pending_urls.insert(0, url)
                    # Force restart by setting counter past the limit
                    pages_since_restart = PAGES_PER_RESTART 
                    crawler.save_checkpoint() # Save state before forcing restart
                    crawler.current_processing_url = None
                    continue # Skip rest of loop, trigger restart block at the top of the next iteration

                # --- Process Normal Result ---
                is_success = content is not None
                batch_results.append(is_success)

                if handle_exit.exit_requested:
                    logging.info("Exit requested after crawling page, stopping before processing/saving.")
                    # URL was put back in queue by handle_exit if it was being processed
                    break

                if content: # Page crawled successfully
                    pages_processed += 1
                    pages_since_restart += 1 # Increment only on successful crawl

                    try:
                        chunks = create_chunks_from_page(content)
                        if chunks:
                            embeddings = crawler.create_embeddings(chunks, url, content.title)
                            upsert_to_pinecone(embeddings, pinecone_index, index_name)
                            logging.debug(f"Successfully processed and upserted: {url}")
                            logging.debug(f"Created {len(chunks)} chunks, {len(embeddings)} embeddings.")

                        crawler.state.visited_urls.add(normalized_url)
                        
                        for link in new_links:
                            normalized_link = crawler.normalize_url(link)
                            if (normalized_link not in crawler.state.visited_urls and
                                normalized_link not in crawler.state.attempted_urls and
                                link not in crawler.state.pending_urls):
                                crawler.state.pending_urls.append(link)
                        logging.debug(f"Queue size after adding links: {len(crawler.state.pending_urls)} URLs pending")

                    except Exception as e:
                        logging.error(f"Failed to process page content {url}: {e}")
                        logging.error(traceback.format_exc())
                        crawler.state.attempted_urls.add(normalized_url)
                        
                else: # Page crawl failed normally (e.g., no content, HTTP error handled in crawl_page)
                    # Already added to attempted_urls inside crawl_page if it failed there
                    # (and returned restart_needed=False)
                    # If crawl_page returned (None, links, False) it means no content extracted
                    # Ensure it's marked as attempted if not already done in crawl_page
                    if not restart_needed and normalized_url not in crawler.state.attempted_urls:
                        logging.debug(f"Marking URL with no content or prior error as attempted: {url}")
                        crawler.state.attempted_urls.add(normalized_url)

                # Save checkpoint *after* result is determined and added to batch_results/state updated
                crawler.save_checkpoint()

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

    # Validate active hours
    start_time_obj, end_time_obj = parse_time_range_string(args.active_hours)
    if args.active_hours and (not start_time_obj or not end_time_obj):
        logging.error("Invalid --active-hours format provided. Exiting.")
        print(f"Error: Invalid --active-hours format provided. Exiting.")
        sys.exit(1)

    # Validate domain and create start URL, ensuring scheme
    start_url = ensure_scheme(args.domain)
    parsed_start = urlparse(start_url)
    if not parsed_start.netloc: # Basic validation after ensuring scheme
        logging.error(f"Invalid domain provided or scheme missing: {args.domain}")
        print(f"Error: Invalid domain provided or scheme missing: {args.domain}")
        sys.exit(1)

    # Set up signal handlers
    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)
    
    # Initialize crawler, passing the retry flag. This loads/migrates the state.
    crawler = WebsiteCrawler(start_url=start_url, retry_failed=args.retry_failed)
    handle_exit.crawler = crawler  # Store crawler reference for signal handler

    # --- Handle --report flag ---
    if args.report:
        logging.info("Generating report of failed URLs...")
        print("\n--- Failed URL Report ---")
        if crawler.state.attempted_urls:
            for url, error_msg in crawler.state.attempted_urls.items():
                # Print URL and error message on a single line
                print(f"{url} - {error_msg}")
            print(f"\nTotal failed URLs reported: {len(crawler.state.attempted_urls)}")
        else:
            print("No recorded failures found in the checkpoint.")
        print("------------------------")
        sys.exit(0) # Exit after generating report

    # Handle --continue flag and checkpoint file (only if not reporting)
    # This logic is now primarily about *clearing* state if not continuing/retrying
    if not getattr(args, 'continue') and not args.retry_failed:
        # Check if the checkpoint file exists before attempting to unlink
        if crawler.checkpoint_file.exists():
             logging.info("Starting fresh: Removing existing checkpoint file.")
             crawler.checkpoint_file.unlink() # Remove existing checkpoint
        # Reset state in the crawler object itself
        crawler.state = CrawlerState(
            visited_urls=set(),
            attempted_urls={},
            pending_urls=[crawler.start_url] if crawler.is_valid_url(crawler.start_url) else []
        )
        logging.info("Crawler state has been reset for a fresh run.")

    elif not crawler.checkpoint_file.exists() and (getattr(args, 'continue') or args.retry_failed):
         logging.warning("Continue or Retry requested, but no checkpoint file found. Starting fresh.")
         # Ensure state is initialized correctly even if checkpoint didn't exist
         if not crawler.state.pending_urls:
             crawler.state.pending_urls = [crawler.start_url] if crawler.is_valid_url(crawler.start_url) else []

    # Initialize Pinecone
    env_file = f".env.{args.site}"
    pinecone_index = initialize_pinecone(env_file)
    if not pinecone_index:
        sys.exit(1) # Exit if Pinecone initialization failed

    # --- Start Crawl --- 
    try:
        logging.info(f"Starting crawl of {start_url}")
        
        if start_time_obj and end_time_obj:
            logging.info(f"Crawler active hours: {start_time_obj.strftime('%H:%M')} to {end_time_obj.strftime('%H:%M')}")
        else:
            logging.info("Crawler active 24/7.")
            
        # Run the main crawl loop
        run_crawl_loop(crawler, pinecone_index, args, start_time_obj, end_time_obj)
        
    except SystemExit:
        logging.info("Exiting due to SystemExit signal.")
    except Exception as e:
        logging.error(f"Unexpected error in main execution: {e}")
        logging.error(traceback.format_exc())
    finally:
        if 'crawler' in locals():
            logging.info("Performing final checkpoint save...")
            crawler.save_checkpoint() # Ensure final save
        if handle_exit.exit_requested:
            logging.info("Exiting script now due to signal request.")
        else:
             logging.info("Script finished normally.") 
        # Use explicit exit code
        exit_code = 1 if handle_exit.exit_requested else 0
        sys.exit(exit_code)

if __name__ == "__main__":
    main()
