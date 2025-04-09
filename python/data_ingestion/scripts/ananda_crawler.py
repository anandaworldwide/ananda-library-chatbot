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
#   --max-pages: Maximum number of pages to crawl
#                Default: 1000000
#   --domain: Domain to crawl (e.g., ananda.org)
#             Default: 'ananda.org'
#   --continue: Continue from previous checkpoint (if available)
#               Default: False (start fresh)
#   --active-hours: Optional active time range (e.g., "9pm-6am" or "21:00-06:00"). 
#                   Crawler pauses outside this window.
#   --slow: Add a 15-second delay between page crawls
#
# Example usage:
#   python ananda_crawler.py --domain ananda.org --max-pages 50
#   python ananda_crawler.py --site ananda-public --continue
#   python ananda_crawler.py --domain crystalclarity.com --max-pages 100 --site crystal-clarity

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
from urllib.parse import urlparse

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

@dataclass
class CrawlerState:
    visited_urls: Set[str]
    attempted_urls: Set[str]  # URLs we've tried but failed
    pending_urls: List[str]   # Queue of URLs to visit

class AnandaCrawler:
    def __init__(self, start_url: str = "https://ananda.org"):
        self.start_url = start_url
        self.domain = urlparse(start_url).netloc.replace('www.', '')
        checkpoint_dir = Path.home() / '.ananda_crawler_checkpoints'
        checkpoint_dir.mkdir(exist_ok=True)
        self.checkpoint_file = checkpoint_dir / f"crawler_checkpoint_{self.domain}.pkl"
        self.current_processing_url: Optional[str] = None # Track URL being processed
        
        # Initialize state
        self.state = CrawlerState(
            visited_urls=set(),
            attempted_urls=set(),
            pending_urls=[start_url]
        )
        
        # Load previous checkpoint if exists
        if self.checkpoint_file.exists():
            try:
                with open(self.checkpoint_file, 'rb') as f:
                    loaded_state = pickle.load(f)
                    self.state.visited_urls = loaded_state.visited_urls
                    self.state.attempted_urls = loaded_state.attempted_urls
                    filtered_urls = [url for url in loaded_state.pending_urls if self.is_valid_url(url)]
                    self.state.pending_urls = filtered_urls or [self.start_url] if self.start_url not in self.state.visited_urls else []
                    logging.info(f"Loaded checkpoint: {len(self.state.visited_urls)} visited, {len(loaded_state.pending_urls)} pending URLs")
                    if len(loaded_state.pending_urls) != len(filtered_urls):
                        logging.debug(f"Filtered out {len(loaded_state.pending_urls) - len(filtered_urls)} invalid pending URLs")
            except Exception as e:
                logging.error(f"Failed to load checkpoint: {e}")
                self.state.pending_urls = [self.start_url] if self.is_valid_url(self.start_url) else []

        # Skip patterns for URLs
        self.skip_patterns = [
            r'/search/',
            r'/login/',
            r'/cart/',
            r'/account/',
            r'/checkout/',
            r'/wp-admin/',
            r'\?',  # Skip URLs with query parameters
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

    def crawl_page(self, browser, page, url: str) -> Tuple[Optional[PageContent], List[str]]:
        retries = 2
        last_exception = None # Keep track of the last error

        while retries > 0:
            try:
                logging.debug(f"Navigating to {url} (Attempts left: {retries})")
                page.set_default_timeout(30000) # 30 seconds page timeout

                # --- Navigation Attempt ---
                response = page.goto(url, wait_until='domcontentloaded')
                # --- Check Response ---
                if not response:
                    logging.error(f"Failed to get response object from {url}")
                    last_exception = Exception("No response object")
                    # Consider retry? For now, fail fast.
                    retries = 0 # Fail immediately if no response object
                    continue
                if response.status >= 400:
                    logging.error(f"HTTP {response.status} error for {url}")
                    last_exception = Exception(f"HTTP {response.status}")
                    # Don't retry HTTP errors generally
                    retries = 0
                    continue

                # --- Wait and Extract ---
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
                html_content = page.content() # Get content *before* cleaning checks potential errors earlier
                clean_text = self.clean_content(html_content)
                logging.debug(f"Cleaned text length: {len(clean_text)}")

                if not clean_text.strip():
                    logging.warning(f"No content extracted from {url}")
                    # Don't retry if no content, just mark as success with no data
                    return None, valid_links # Return links found, but no PageContent

                # --- Success ---
                return PageContent(
                    url=url,
                    title=title,
                    content=clean_text,
                    metadata={'type': 'text', 'source': url}
                ), valid_links

            # --- Exception Handling within Retry Loop ---
            except PlaywrightTimeout as e:
                logging.warning(f"Timeout error crawling {url}: {e}. Retrying...")
                last_exception = e
                # Timeout recovery: Try closing page and making a new one
                try:
                    # Ensure page is not already closed before trying to close it
                    if not page.is_closed():
                        page.close()
                except Exception as close_err:
                    logging.warning(f"Error closing page after timeout (continuing recovery): {close_err}")
                try:
                     page = browser.new_page()
                     # Reapply headers to the new page
                     page.set_extra_http_headers({'User-Agent': 'Ananda Chatbot Crawler'}) 
                     logging.info("Created new page instance after timeout.")
                except Exception as new_page_err:
                     logging.error(f"Failed to create new page after timeout: {new_page_err}. Aborting retries for this URL.")
                     last_exception = new_page_err
                     retries = 0 # Cannot recover if new page fails

            except Exception as e: # Catch other potential Playwright errors or general exceptions
                 # Check if it's the "Target page/context/browser closed" error
                 if "Target page, context or browser has been closed" in str(e):
                      logging.warning(f"Target closed error for {url}: {e}. Attempting page recovery...")
                      last_exception = e
                      # Try the same page recovery logic as for timeout
                      try:
                          # Check if page object is still usable for close
                          if not page.is_closed():
                              page.close()
                      except Exception as close_err:
                           logging.warning(f"Error closing page after target closed (continuing recovery): {close_err}")
                      try:
                           # Ensure browser context is still available before creating new page
                           if browser.contexts:
                               page = browser.new_page()
                               # Reapply headers to the new page
                               page.set_extra_http_headers({'User-Agent': 'Ananda Chatbot Crawler'})
                               logging.info("Created new page instance after target closed.")
                           else:
                               logging.error("Browser context lost, cannot create new page. Aborting retries for this URL.")
                               last_exception = Exception("Browser context lost")
                               retries = 0 # Cannot recover if context is lost
                      except Exception as new_page_err:
                           logging.error(f"Failed to create new page after target closed: {new_page_err}. Aborting retries for this URL.")
                           last_exception = new_page_err
                           retries = 0 # Cannot recover if new page fails
                 # ---> Add specific handling for NS_ERROR_ABORT <-----
                 # Use a more general check or the specific internal error type if known
                 # Checking the type name in the string representation is less robust but avoids import issues
                 # Let's check if the exception's type name indicates a Playwright-related error
                 # and if the message contains NS_ERROR_ABORT
                 elif "playwright" in repr(e).lower() and "NS_ERROR_ABORT" in str(e):
                     logging.warning(f"NS_ERROR_ABORT encountered for {url}: {e}. Retrying with page recovery...")
                     last_exception = e
                     # Attempt page recovery
                     try:
                         if not page.is_closed():
                             page.close()
                     except Exception as close_err:
                         logging.warning(f"Error closing page after NS_ERROR_ABORT (continuing recovery): {close_err}")
                     try:
                         if browser.contexts:
                             page = browser.new_page()
                             page.set_extra_http_headers({'User-Agent': 'Ananda Chatbot Crawler'})
                             logging.info("Created new page instance after NS_ERROR_ABORT.")
                             # Retry will happen naturally due to loop structure
                         else:
                             logging.error("Browser context lost, cannot create new page after NS_ERROR_ABORT. Aborting retries.")
                             last_exception = Exception("Browser context lost during NS_ERROR_ABORT recovery")
                             retries = 0 # Cannot recover
                     except Exception as new_page_err:
                         logging.error(f"Failed to create new page after NS_ERROR_ABORT: {new_page_err}. Aborting retries.")
                         last_exception = new_page_err
                         retries = 0 # Cannot recover
                 # ---> End NS_ERROR_ABORT handling <-----
                 else:
                      # For other unexpected errors, log and stop retrying this URL
                      logging.error(f"Unexpected error crawling {url}: {e}")
                      logging.error(traceback.format_exc())
                      last_exception = e
                      retries = 0 # Stop retrying on unexpected errors

            # Decrement retries only if we are going to loop again
            if retries > 0:
                retries -= 1
                if retries > 0:
                     logging.info(f"Waiting 5s before next retry for {url}...")
                     time.sleep(5) # Add a small delay before retrying
                # else: # This log will be replaced by the one outside the loop
                     # logging.error(f"Failed to crawl {url} after multiple retries. Last error: {last_exception}")


        # If loop finishes without success
        logging.error(f"Giving up on {url} after exhausting retries or encountering fatal error. Last error: {last_exception}")
        # Add to attempted URLs on failure
        self.state.attempted_urls.add(self.normalize_url(url))
        return None, [] # Return empty list of links on complete failure

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
        logging.debug(f"Upserting {len(vectors)} vectors to Pinecone index '{index_name}'...")
        index.upsert(vectors=vectors)
        logging.debug("Upsert complete.")

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

def check_and_wait_if_inactive(start_time_obj: Optional[dt_time], end_time_obj: Optional[dt_time], crawler: AnandaCrawler, active_hours_str: Optional[str]):
    """Checks if current time is outside active hours and sleeps if needed. Returns False if exit requested during sleep, True otherwise."""
    is_active, sleep_duration_seconds = is_within_time_range(start_time_obj, end_time_obj)
    if not is_active and sleep_duration_seconds is not None and sleep_duration_seconds > 0:
        sleep_hours = sleep_duration_seconds / 3600
        wake_time = (datetime.now() + timedelta(seconds=sleep_duration_seconds)).strftime('%Y-%m-%d %H:%M:%S')
        logging.info(f"Outside active hours ({active_hours_str}). Sleeping for {sleep_hours:.2f} hours until {wake_time}. Saving checkpoint.")
        crawler.save_checkpoint()
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

def main():
    # Reset exit counter at start
    handle_exit.counter = 0
    handle_exit.exit_requested = False
    
    parser = argparse.ArgumentParser(description='Crawl a website and store in Pinecone')
    parser.add_argument(
        '--site', 
        default='ananda-public',
        help='Site ID for environment variables (e.g., ananda-public). Will load from .env.[site]'
    )
    parser.add_argument('--max-pages', type=int, default=None, help='Maximum number of pages to crawl (default: unlimited)')
    parser.add_argument('--domain', default='ananda.org', help='Domain to crawl (e.g., ananda.org)')
    parser.add_argument('--continue', action='store_true', help='Continue from previous checkpoint')
    parser.add_argument(
        '--active-hours',
        type=str,
        default=None,
        help='Optional active time range (e.g., "9pm-5am" or "21:00-05:00"). Crawler pauses outside this window.'
     )
    parser.add_argument('--slow', action='store_true', help='Add a 15-second delay between page crawls')
    args = parser.parse_args()

    # Parse the active hours range
    start_time_obj, end_time_obj = parse_time_range_string(args.active_hours)
    if args.active_hours and (not start_time_obj or not end_time_obj):
        logging.error("Invalid --active-hours format provided. Exiting.")
        print(f"Error: Invalid --active-hours format provided. Exiting.")
        return # Exit if format is wrong or parsing failed

    # Convert domain to full URL
    start_url = f"https://{args.domain}"
    if not urlparse(start_url).netloc:
        logging.error(f"Invalid domain provided: {args.domain}")
        print(f"Error: Invalid domain provided: {args.domain}")
        return

    # Set up signal handlers
    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)
    
    # Initialize crawler
    crawler = AnandaCrawler(start_url=start_url)
    handle_exit.crawler = crawler  # Store crawler reference for signal handler

    # Only load checkpoint if --continue flag is present
    if not getattr(args, 'continue'):
        crawler.state = CrawlerState(
            visited_urls=set(),
            attempted_urls=set(),
            pending_urls=[]
        )  # Start fresh
        if crawler.checkpoint_file.exists():
            crawler.checkpoint_file.unlink()  # Remove existing checkpoint
    elif not crawler.checkpoint_file.exists():
        logging.warning("No checkpoint file found to continue from.")

    # Load environment variables
    env_file = f".env.{args.site}"
    if not os.path.exists(env_file):
        logging.error(f"Environment file {env_file} not found.")
        print(f"Error: Environment file {env_file} not found.")
        return
    
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
        return

    # Initialize Pinecone with new API
    pc = pinecone.Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
    index_name = os.getenv('PINECONE_INGEST_INDEX_NAME')
    if not index_name:
        logging.error("PINECONE_INGEST_INDEX_NAME environment variable is not set.")
        print("Error: PINECONE_INGEST_INDEX_NAME environment variable is not set.")
        return
    
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
                return # Exit if creation failed
        else:
            logging.info("User declined to create the index. Exiting.")
            print("Operation aborted by user. Index not found.")
            return # Exit if user declines

    except Exception as e:
        # Catch other potential connection errors
        logging.error(f"Error connecting to Pinecone index '{index_name}': {e}")
        print(f"Error connecting to Pinecone index '{index_name}': {e}")
        return # Exit on other connection errors

    # --- Proceed with the crawl only if pinecone_index is successfully assigned ---
    if not pinecone_index:
         logging.error("Failed to establish connection to Pinecone index. Exiting.")
         print("Error: Could not connect to Pinecone index. Exiting.")
         return

    try:
        logging.info(f"Starting crawl of {start_url}")
        if args.max_pages:
            logging.info(f"Maximum pages to crawl: {args.max_pages}")
        
        if start_time_obj and end_time_obj:
            logging.info(f"Crawler active hours: {start_time_obj.strftime('%H:%M')} to {end_time_obj.strftime('%H:%M')}")
        else:
            logging.info("Crawler active 24/7.")
            
        pages_processed = 0
        # --- Stats Tracking ---
        pages_since_restart = 0
        batch_start_time = time.time()
        PAGES_PER_RESTART = 50 # Restart browser every 50 pages
        # --- End Stats Tracking ---
        
        # Ensure we have a starting URL
        if not crawler.state.pending_urls:
            logging.warning("No pending URLs found in state, reinitializing queue with start URL.")
            crawler.state.pending_urls = [start_url]
            
        logging.info(f"Initial queue size: {len(crawler.state.pending_urls)} URLs")
        logging.info(f"First URL in queue: {crawler.state.pending_urls[0] if crawler.state.pending_urls else 'None'}")
        
        with sync_playwright() as p:
            browser = p.firefox.launch(
                headless=False, 
                firefox_user_prefs={"media.volume_scale": "0.0"} # Mute audio
            )
            page = browser.new_page() # Create page initially
            page.set_extra_http_headers({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0'
            })
            should_continue_loop = True # Flag to control the main loop
            try:
                start_run_time = time.time()

                # --- Initial Time Check Before Loop ---
                logging.debug("Performing initial active hours check...")
                should_continue_loop = check_and_wait_if_inactive(start_time_obj, end_time_obj, crawler, args.active_hours)
                if not should_continue_loop:
                    logging.info("Exiting after initial sleep interruption.")
                    # Ensure cleanup happens by letting the finally block run
                
                # Modified loop condition to check exit flag
                while crawler.state.pending_urls and should_continue_loop and not handle_exit.exit_requested:
                    # --- Slow Crawl Delay ---
                    if args.slow and pages_processed > 0: # Add delay after the first page is processed
                        delay_seconds = 15 # Define delay duration
                        logging.info(f"Slow mode enabled: Pausing for {delay_seconds} seconds...")
                        interrupted_during_sleep = False
                        for _ in range(delay_seconds):
                            time.sleep(1) # Sleep for 1 second
                            if handle_exit.exit_requested:
                                logging.info("Exit requested during slow mode pause, stopping sleep.")
                                interrupted_during_sleep = True
                                break # Exit the inner sleep loop
                        
                        if interrupted_during_sleep:
                            break # Exit the main while loop if interrupted

                        # Original check after sleep is now redundant due to the inner loop check, but kept for safety
                        # Check exit flag *again* after sleeping, in case it was received during sleep
                        if handle_exit.exit_requested:
                            logging.info("Exit requested immediately after slow mode pause, breaking loop.")
                            break

                    # --- Time Check Inside Loop ---
                    should_continue_loop = check_and_wait_if_inactive(start_time_obj, end_time_obj, crawler, args.active_hours)
                    if not should_continue_loop:
                        logging.info("Exit requested during sleep, breaking main loop.")
                        break # Exit while loop
                    
                    # Check exit flag *before* popping URL
                    if handle_exit.exit_requested:
                        logging.info("Exit requested before processing next URL, breaking loop.")
                        break

                    # Check for max_pages limit if specified
                    if args.max_pages is not None and pages_processed >= args.max_pages:
                        logging.info(f"Reached max pages limit ({args.max_pages}), stopping crawl.")
                        break

                    url = crawler.state.pending_urls.pop(0)
                    crawler.current_processing_url = url # Track current URL
                    normalized_url = crawler.normalize_url(url)
                    
                    logging.info(f"Processing URL: {url}")
                    logging.debug(f"Remaining in queue: {len(crawler.state.pending_urls)}")
                    
                    if normalized_url in crawler.state.visited_urls:
                        logging.debug(f"Skipping already visited URL: {url}")
                        continue
                        
                    content, new_links = crawler.crawl_page(browser, page, url)
                    
                    # Check exit flag *immediately* after crawl_page returns
                    if handle_exit.exit_requested:
                        logging.info("Exit requested after crawling page, stopping before processing/saving.")
                        # URL was put back in queue by handle_exit if it was being processed
                        break

                    if content:
                        pages_processed += 1

                        # Process the page content
                        try:
                            chunks = create_chunks_from_page(content)
                            if chunks:
                                embeddings = crawler.create_embeddings(chunks, url, content.title)
                                upsert_to_pinecone(embeddings, pinecone_index, index_name)
                                logging.debug(f"Successfully processed and upserted: {url}")
                                logging.debug(f"Created {len(chunks)} chunks, {len(embeddings)} embeddings.")

                            # Add to visited ONLY after successful processing
                            crawler.state.visited_urls.add(normalized_url)
                            
                            # --- Increment counter after successful processing ---
                            pages_since_restart += 1
                            
                            # Process new links ONLY after successful processing
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
                            # Decide if this URL should be marked as attempted instead of visited?
                            # For now, it won't be added to visited if processing fails.
                            crawler.state.attempted_urls.add(normalized_url)
                            
                        # --- Check for Browser Restart (Moved outside try/except, inside if content) ---
                        if pages_since_restart >= PAGES_PER_RESTART:
                            # Calculate stats before restart
                            batch_elapsed_time = time.time() - batch_start_time
                            pages_per_minute = (PAGES_PER_RESTART / batch_elapsed_time * 60) if batch_elapsed_time > 0 else 0
                            total_visited = len(crawler.state.visited_urls)
                            total_attempted = total_visited + len(crawler.state.attempted_urls)
                            success_rate = (total_visited / total_attempted * 100) if total_attempted > 0 else 0
                            pending_count = len(crawler.state.pending_urls)
                            
                            stats_message = (
                                f"\n--- Stats at {PAGES_PER_RESTART} page boundary ---\n"
                                f"- Processing {pages_per_minute:.1f} pages/minute (last {PAGES_PER_RESTART} pages)\n"
                                f"- Total {total_visited} visited pages of {total_attempted} attempted ({round(success_rate)}% success)\n"
                                f"- Total {pending_count} pending pages\n"
                                f"--- End Stats ---"
                            )
                            # Log each line separately to preserve newlines
                            for line in stats_message.split('\n'):
                                logging.info(line)

                            # --- Restart Browser ---
                            logging.info(f"Restarting browser after {pages_since_restart} pages...")
                            try:
                                if page and not page.is_closed():
                                    page.close()
                                if browser and browser.is_connected():
                                    browser.close()
                                logging.info("Old browser closed.")
                            except Exception as close_err:
                                logging.warning(f"Error closing browser/page during restart: {close_err}")
                            
                            # Launch new browser and page
                            browser = p.firefox.launch(
                                headless=False,
                                firefox_user_prefs={"media.volume_scale": "0.0"} # Mute audio
                            )
                            page = browser.new_page()
                            page.set_extra_http_headers({
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0'
                            })
                            logging.info("New browser launched.")
                            # --- Reset Counters ---
                            pages_since_restart = 0
                            batch_start_time = time.time()
                            # --- End Browser Restart ---

                    else:
                        # crawl_page returned None (error or no content)
                        crawler.state.attempted_urls.add(normalized_url)

                    # Save checkpoint after each page attempt (success or failure)
                    crawler.save_checkpoint()

                    # Check exit flag again after saving checkpoint (safety)
                    if handle_exit.exit_requested:
                        logging.info("Exit requested after saving checkpoint, stopping loop.")
                        # should_continue_loop = False # Ensure loop terminates (already handled by loop condition)
                        break

                    crawler.current_processing_url = None # Clear tracked URL after processing/saving

            except Exception as e:
                logging.error(f"Browser or main loop error: {e}")
                logging.error(traceback.format_exc())
                should_continue_loop = False # Stop loop on error
            finally:
                # Ensure browser is closed cleanly, *unless* exiting due to signal
                if not handle_exit.exit_requested:
                    logging.info("Closing browser cleanly...")
                    try:
                        # Check if page and browser objects exist and are usable before closing
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
        
    except SystemExit:
        logging.info("Exiting due to SystemExit signal.")
    except Exception as e:
        logging.error(f"Unexpected error in main: {e}")
        logging.error(traceback.format_exc())
    finally:
        if 'crawler' in locals():
            logging.info("Performing final checkpoint save...")
            crawler.save_checkpoint() # Ensure final save
        if handle_exit.exit_requested:
            logging.info("Exiting script now due to signal request.")
        else:
             logging.info("Script finished normally.") # Added for clarity
        sys.exit(0) # Use sys.exit for cleaner shutdown than implicit exit

if __name__ == "__main__":
    main()
