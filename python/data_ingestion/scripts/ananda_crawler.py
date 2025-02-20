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
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

# Third party imports
import pinecone
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

# Configure logging with timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

@dataclass
class PageContent:
    url: str
    title: str
    content: str
    metadata: Dict


def chunk_content(content: str, target_words: int = 150, overlap_words: int = 75) -> List[str]:
    """Split content into overlapping chunks by word count"""
    words = content.split()
    chunks = []
    start = 0
    total_words = len(words)
    
    print(f"Starting chunking of {total_words} words")
    
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
            print(f"Created chunk {len(chunks)}: words {start}-{end} ({end-start} words)")
        
        # Move start position for next chunk with safety check
        new_start = end - overlap_words
        if new_start <= start:  # If we're not making progress
            new_start = end  # Skip overlap and continue from end
            print(f"Warning: Reset overlap at word {end}")
        start = new_start
        
        # Extra safety check
        if len(chunks) > total_words / 50:  # No more than 1 chunk per 50 words
            print("Warning: Too many chunks created, breaking")
            break
    
    print(f"Chunking complete: {len(chunks)} chunks created")
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
                    # Filter out any external URLs from the loaded state
                    self.state.visited_urls = {url for url in loaded_state.visited_urls 
                                             if self.is_valid_url(url)}
                    self.state.attempted_urls = {url for url in loaded_state.attempted_urls 
                                               if self.is_valid_url(url)}
                    self.state.pending_urls = [url for url in loaded_state.pending_urls 
                                             if self.is_valid_url(url)]
                    
                # If no pending URLs after filtering, add start_url back
                if not self.state.pending_urls:
                    self.state.pending_urls = [start_url]
                    
                logging.info(f"Loaded checkpoint: {len(self.state.visited_urls)} visited, "
                           f"{len(self.state.pending_urls)} pending URLs (after filtering external domains)")
            except Exception as e:
                logging.error(f"Failed to load checkpoint: {e}")
                # Reset to initial state with start_url
                self.state.pending_urls = [start_url]
        
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
                '.mov', '.wmv', '.flv', '.webp'
            ]
            if any(path.endswith(ext) for ext in skip_extensions):
                logging.debug(f"Skipping media file: {url}")
                return False
                
            # Skip wp-content uploads directory
            if '/wp-content/uploads/' in path:
                logging.debug(f"Skipping uploads directory: {url}")
                return False
                
            # Skip anchor-only URLs
            if not parsed.path or parsed.path == '/':
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
        if not main_content:
            logging.warning("No specific content area found, falling back to body")
            main_content = soup.body
        
        if main_content:
            text = main_content.get_text(separator=' ', strip=True)
            text = re.sub(r'\s+', ' ', text)
            logging.debug(f"Extracted text length: {len(text)}")
            return text.strip()
        else:
            logging.error("No content found in HTML")
            return ""

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

    def crawl_page(self, browser, page, url: str) -> Tuple[Optional[Dict], List[str]]:
        retries = 2
        while retries > 0:
            try:
                logging.info(f"Navigating to {url}")
                # Add wait_until option and handle response
                try:
                    # Set page timeout
                    page.set_default_timeout(30000)  # 30 seconds
                    response = page.goto(url, wait_until='networkidle')
                except PlaywrightTimeout:
                    logging.error(f"Navigation timeout for {url}")
                    # Try to recover the page instance
                    try:
                        page.close()
                        page = browser.new_page()
                        page.set_extra_http_headers({
                            'User-Agent': 'Ananda Chatbot Crawler'
                        })
                    except Exception:
                        logging.error("Failed to recover page instance")
                    retries -= 1
                    if retries > 0:
                        continue
                    return None, []
                except Exception as e:
                    logging.error(f"Navigation failed for {url}: {e}")
                    retries -= 1
                    if retries > 0:
                        continue
                    return None, []

                if not response:
                    logging.error(f"Failed to get response from {url}")
                    return None, []
                
                if response.status >= 400:
                    logging.error(f"HTTP {response.status} error for {url}")
                    return None, []

                # Wait for content with error handling
                try:
                    page.wait_for_selector('body', timeout=30000)
                except PlaywrightTimeout:
                    logging.error(f"Timeout waiting for body content on {url}")
                    return None, []

                # More targeted menu handling with error catching
                try:
                    page.evaluate("""() => {
                        document.querySelectorAll('.menu-item-has-children:not(.active)').forEach((item, index) => {
                            try {
                                if (!item.closest('.sub-menu')) {
                                    item.classList.add('active');
                                    const submenu = item.querySelector(':scope > .sub-menu');
                                    if (submenu) {
                                        submenu.style.display = 'block';
                                        submenu.style.visibility = 'visible';
                                    }
                                }
                            } catch (e) {
                                console.error('Menu handling error:', e);
                            }
                        });
                    }""")
                except Exception as e:
                    logging.debug(f"Menu handling failed (non-critical): {e}")

                # Get links, filtering for valid URLs only
                links = page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href)
                        .filter(href => !href.endsWith('#') && !href.includes('/#'));
                }""")
                
                # Filter links to only include same domain
                valid_links = [link for link in links if self.is_valid_url(link)]
                if len(links) != len(valid_links):
                    logging.debug(f"Filtered out {len(links) - len(valid_links)} external links")
                
                title = page.title()
                logging.debug(f"Page title: {title}")
                clean_text = self.clean_content(page.content())
                logging.debug(f"Cleaned text length: {len(clean_text)}")
                
                if not clean_text.strip():
                    logging.warning(f"No content extracted from {url}")
                    return None, []
                
                return PageContent(
                    url=url,
                    title=title,
                    content=clean_text,
                    metadata={
                        'type': 'text',
                        'source': url
                    }
                ), valid_links
                
            except Exception as e:
                logging.error(f"Error crawling {url}: {str(e)}")
                logging.error(traceback.format_exc())
                retries -= 1
                if retries > 0:
                    logging.info(f"Retrying {url} ({retries} attempts remaining)")
                    continue
                return None, []

    def crawl(self, max_pages: int = 10):
        logging.debug(f"Starting crawl with max_pages={max_pages}")
        with sync_playwright() as p:
            browser = p.firefox.launch(headless=False)
            try:
                page = browser.new_page()
                page.set_extra_http_headers({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0'
                })
                
                # Initialize queue if empty
                if not self.state.pending_urls:
                    if self.normalize_url(self.start_url) not in self.state.visited_urls:
                        self.state.pending_urls.append(self.start_url)
                
                crawled_pages = []
                
                while self.state.pending_urls and len(crawled_pages) < max_pages:
                    url = self.state.pending_urls.pop(0)
                    normalized_url = self.normalize_url(url)
                    
                    if normalized_url in self.state.visited_urls:
                        continue
                    
                    content, new_links = self.crawl_page(browser, page, url)
                    
                    if content:
                        self.state.visited_urls.add(normalized_url)
                        crawled_pages.append(content)
                        logging.info(f"Successfully crawled: {url}")
                        for link in new_links:
                            normalized_link = self.normalize_url(link)
                            if (normalized_link not in self.state.visited_urls and 
                                normalized_link not in self.state.attempted_urls and
                                link not in self.state.pending_urls):
                                self.state.pending_urls.append(link)
                        print(f"Queue size: {len(self.state.pending_urls)} URLs pending")
                    else:
                        self.state.attempted_urls.add(normalized_url)
                    
                    # Save checkpoint periodically
                    if len(crawled_pages) % 10 == 0:
                        self.save_checkpoint()
                
                return crawled_pages
                
            finally:
                browser.close()

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

            print(f"\nVector {i+1}/{len(chunks)}:")
            print(f"ID: {chunk_id}")
            print(f"Text preview: {chunk[:200]}...")
        
        return vectors
    

def sanitize_for_id(text: str) -> str:
    """Sanitize text for use in Pinecone vector IDs"""
    # Replace non-ASCII chars with ASCII equivalents
    text = text.replace('—', '-').replace("'", "'").replace('"', '"').replace('"', '"')
    # Remove any remaining non-ASCII chars
    text = ''.join(c for c in text if ord(c) < 128)
    # Replace spaces and special chars with underscores
    text = re.sub(r'[^a-zA-Z0-9-]', '_', text)
    return text

def handle_exit(signum, frame):
    """Handle exit signals gracefully"""
    # Initialize counter if not exists
    if not hasattr(handle_exit, 'counter'):
        handle_exit.counter = 0
    handle_exit.counter += 1
    
    print(f"\nReceived exit signal ({handle_exit.counter}). Saving checkpoint...")
    
    # Force exit after 3 attempts
    if handle_exit.counter >= 3:
        print("Force exiting...")
        os._exit(1)  # Force immediate exit
        
    if hasattr(handle_exit, 'crawler'):
        handle_exit.crawler.save_checkpoint()
    handle_exit.exit_requested = True

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

def upsert_to_pinecone(vectors: List[Dict], index: pinecone.Index):
    """Upsert vectors to Pinecone index."""
    if vectors:
        print(f"\nUpserting {len(vectors)} vectors to Pinecone...")
        index.upsert(vectors=vectors)
        print("Upsert complete")

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
    parser.add_argument('--max-pages', type=int, default=10, help='Maximum number of pages to crawl')
    parser.add_argument('--domain', default='ananda.org', help='Domain to crawl (e.g., ananda.org)')
    parser.add_argument('--continue', action='store_true', help='Continue from previous checkpoint')
    args = parser.parse_args()

    # Convert domain to full URL
    start_url = f"https://{args.domain}"
    if not urlparse(start_url).netloc:
        print(f"Invalid domain: {args.domain}")
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
    elif crawler.checkpoint_file.exists():
        print(f"\nContinuing from checkpoint:")
        print(f"- Previously visited URLs: {len(crawler.state.visited_urls)}")
        print(f"- Top level domains visited:")
        domain_counts = {}
        for url in crawler.state.visited_urls:
            domain = urlparse(url).netloc
            domain_counts[domain] = domain_counts.get(domain, 0) + 1
        for domain, count in domain_counts.items():
            print(f"  • {domain}: {count} pages")
    else:
        print("No checkpoint file found to continue from")

    # Load environment variables
    env_file = f".env.{args.site}"
    if not os.path.exists(env_file):
        print(f"Error: Environment file {env_file} not found")
        return
    
    load_dotenv(env_file)
    print(f"Loaded environment from: {os.path.abspath(env_file)}")
    print(f"\nUsing environment from {env_file}")

    # Verify required environment variables
    required_vars = ['PINECONE_API_KEY', 'PINECONE_INDEX_NAME', 'OPENAI_API_KEY']
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        print(f"Please check your {env_file} file")
        return

    # Initialize Pinecone with new API
    pc = pinecone.Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
    index_name = os.getenv('PINECONE_INDEX_NAME')
    if not index_name:
        print("Error: PINECONE_INDEX_NAME environment variable is not set")
        return
    
    print(f"Target Pinecone index: {index_name}")
    try:
        pinecone_index = pc.Index(index_name)
    except Exception as e:
        print(f"Error connecting to Pinecone index: {e}")
        return

    try:
        print(f"\nStarting crawl of {start_url} with max pages: {args.max_pages}")
        pages_processed = 0
        
        # Ensure we have a starting URL
        if not crawler.state.pending_urls:
            print("No pending URLs found, reinitializing with start URL")
            crawler.state.pending_urls = [start_url]
            
        print(f"Initial queue size: {len(crawler.state.pending_urls)} URLs")
        print(f"First URL in queue: {crawler.state.pending_urls[0] if crawler.state.pending_urls else 'None'}")
        
        with sync_playwright() as p:
            browser = p.firefox.launch(headless=False)
            try:
                page = browser.new_page()
                page.set_extra_http_headers({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:94.0) Gecko/20100101 Firefox/94.0'
                })
                
                # Add timeout for the entire crawl process
                start_time = time.time()
                max_runtime = 60*60*8  # 8 hour timeout
                
                while crawler.state.pending_urls and pages_processed < args.max_pages:
                    # Check for overall timeout
                    if time.time() - start_time > max_runtime:
                        logging.warning("Maximum runtime reached, stopping crawl")
                        break
                        
                    url = crawler.state.pending_urls.pop(0)
                    normalized_url = crawler.normalize_url(url)
                    
                    print(f"\nProcessing URL: {url}")
                    print(f"Remaining in queue: {len(crawler.state.pending_urls)}")
                    
                    if normalized_url in crawler.state.visited_urls:
                        print(f"Skipping already visited URL: {url}")
                        continue
                        
                    content, new_links = crawler.crawl_page(browser, page, url)
                    
                    if content:
                        crawler.state.visited_urls.add(normalized_url)
                        pages_processed += 1
                        
                        # Process new links
                        for link in new_links:
                            normalized_link = crawler.normalize_url(link)
                            if (normalized_link not in crawler.state.visited_urls and 
                                normalized_link not in crawler.state.attempted_urls and
                                link not in crawler.state.pending_urls):
                                crawler.state.pending_urls.append(link)
                        
                        print(f"Queue size: {len(crawler.state.pending_urls)} URLs pending")
                        
                        # Process the page content
                        try:
                            chunks = create_chunks_from_page(content)
                            if chunks:
                                embeddings = crawler.create_embeddings(chunks, url, content.title)
                                upsert_to_pinecone(embeddings, pinecone_index)
                                print(f"Successfully processed page {pages_processed}/{args.max_pages}: {url}")
                                print(f"Created {len(chunks)} chunks, {len(embeddings)} embeddings")
                        except Exception as e:
                            logging.error(f"Failed to process page {url}: {e}")
                            logging.error(traceback.format_exc())
                    else:
                        crawler.state.attempted_urls.add(normalized_url)
                    
                    # Save checkpoint after each page
                    crawler.save_checkpoint()
                    
                    # Check exit flag
                    if handle_exit.exit_requested:
                        print("\nGracefully stopping crawler...")
                        break
                
            except Exception as e:
                logging.error(f"Browser error: {e}")
                logging.error(traceback.format_exc())
            finally:
                try:
                    browser.close()
                except Exception as e:
                    logging.debug(f"Error closing browser: {e}")
                    
        if pages_processed == 0:
            print("No pages were crawled successfully.")
            return
            
        print(f"\nCompleted processing {pages_processed} pages")
        
    except SystemExit:
        print("\nExiting...")
    except Exception as e:
        logging.error(f"Unexpected error: {e}")
        logging.error(traceback.format_exc())
    finally:
        crawler.save_checkpoint()
        if handle_exit.exit_requested:
            sys.exit(0)

if __name__ == "__main__":
    main()
