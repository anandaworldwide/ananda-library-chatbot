from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
from typing import Set, Dict, List, Optional, Tuple
import logging
import traceback
import argparse
import json
from dataclasses import dataclass, asdict
import sys
import os
from datetime import datetime
import signal
import pickle
from pathlib import Path

# Add parent directory to Python path for importing utility modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from util.env_utils import load_env
from data_ingestion.scripts.pinecone_utils import load_pinecone, create_embeddings
from openai import OpenAI

# Configure logging with timestamps
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

@dataclass
class PageContent:
    url: str
    title: str
    content: str
    metadata: Dict

class WebsiteChunk:
    def __init__(self, text: str, metadata: Dict):
        self.text = text
        self.metadata = metadata

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
        self.domain = urlparse(start_url).netloc
        # Use a checkpoints directory in the user's home directory
        checkpoint_dir = Path.home() / '.ananda_crawler_checkpoints'
        checkpoint_dir.mkdir(exist_ok=True)
        self.checkpoint_file = checkpoint_dir / f"crawler_checkpoint_{self.domain}.pkl"
        
        # Initialize state
        self.state = CrawlerState(
            visited_urls=set(),
            attempted_urls=set(),
            pending_urls=[]
        )
        
        # Load previous checkpoint if exists
        if self.checkpoint_file.exists():
            try:
                with open(self.checkpoint_file, 'rb') as f:
                    self.state = pickle.load(f)
                logging.info(f"Loaded checkpoint: {len(self.state.visited_urls)} visited, {len(self.state.pending_urls)} pending")
            except Exception as e:
                logging.error(f"Failed to load checkpoint: {e}")
        
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
        """Remove hash fragment from URL and enforce HTTPS"""
        # Remove hash fragment
        url = url.split('#')[0]
        # Convert HTTP to HTTPS
        if url.startswith('http://'):
            url = 'https://' + url[7:]
        return url

    def should_skip_url(self, url: str) -> bool:
        """Check if URL should be skipped based on patterns"""
        return any(re.search(pattern, url) for pattern in self.skip_patterns)

    def is_valid_url(self, url: str) -> bool:
        """Check if URL should be crawled"""
        if not url or not url.startswith('https://'):
            return False
        parsed = urlparse(url)
        if parsed.netloc != self.domain:
            return False
        return not self.should_skip_url(url)

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

    def crawl_page(self, page, url: str) -> Tuple[Optional[Dict], List[str]]:
        try:
            logging.info(f"Navigating to {url}")
            # Strip anchor fragments to avoid duplicate crawls
            clean_url = url.split('#')[0]
            page.goto(clean_url)
            
            # Wait for main content to load
            page.wait_for_selector('body', timeout=10000)
            
            # More targeted menu handling
            page.evaluate("""() => {
                // Only process top-level menu items that aren't already expanded
                document.querySelectorAll('.menu-item-has-children:not(.active)').forEach((item, index) => {
                    setTimeout(() => {
                        // Skip items that are part of an already expanded menu
                        if (!item.closest('.sub-menu')) {
                            item.classList.add('active');
                            item.classList.add('focus');
                            
                            // Force immediate child submenus visible
                            const submenu = item.querySelector(':scope > .sub-menu');
                            if (submenu) {
                                submenu.style.display = 'block';
                                submenu.style.visibility = 'visible';
                                submenu.style.opacity = '1';
                            }
                        }
                    }, index * 300);
                });
            }""")
            
            # Shorter timeout since we're being more targeted
            page.wait_for_timeout(2000)
            
            # Get links, excluding anchor-only URLs
            links = page.evaluate("""() => {
                return Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(href => !href.endsWith('#') && !href.includes('/#'));
            }""")
            
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
            ), links
            
        except Exception as e:
            logging.error(f"Error crawling {url}: {str(e)}")
            logging.error(traceback.format_exc())
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
                    
                    content, new_links = self.crawl_page(page, url)
                    
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

    def prepare_for_pinecone(self, pages: List[PageContent]) -> List[WebsiteChunk]:
        """Prepare crawled content for Pinecone insertion"""
        all_chunks = []        
        for i, page in enumerate(pages, 1):            
            chunks = chunk_content(page.content)            
            for j, chunk in enumerate(chunks):
                chunk_metadata = {
                    **page.metadata,
                    'title': page.title,
                    'chunk_index': j,
                    'total_chunks': len(chunks),
                    'type': 'text',
                    'library': 'Ananda.org',
                    'text': chunk,
                    'crawl_timestamp': datetime.now().isoformat()
                }
                all_chunks.append(WebsiteChunk(chunk, chunk_metadata))
        
        print(f"\nTotal chunks created: {len(all_chunks)}")
        return all_chunks

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
    print("\nReceived exit signal. Saving checkpoint...")
    if hasattr(handle_exit, 'crawler'):
        handle_exit.crawler.save_checkpoint()
    sys.exit(0)  # Force immediate exit

def main():
    parser = argparse.ArgumentParser(description='Crawl Ananda.org website and store in Pinecone')
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
    load_env(args.site)
    
    # Verify we're using the right environment
    print(f"\nUsing environment from .env.{args.site}")
    index_name = os.getenv('PINECONE_INGEST_INDEX_NAME')
    print(f"Target Pinecone index: {index_name}\n")
    
    try:
        # Crawl pages
        print(f"\nStarting crawl of {start_url} with max pages: {args.max_pages}")
        pages = crawler.crawl(max_pages=args.max_pages)
        
        # Save final checkpoint
        crawler.save_checkpoint()
        
        if not pages:
            print("No pages were crawled successfully.")
            return
            
        print(f"\nSuccessfully crawled {len(pages)} pages.")
        
        # Prepare chunks for Pinecone
        chunks = crawler.prepare_for_pinecone(pages)
        
        # Preview chunks
        print("\nPreview of chunks to be indexed:")
        for i, chunk in enumerate(chunks[:3]):  # Show first 3 chunks
            print(f"\nChunk {i+1}:")
            print(f"URL: {chunk.metadata['source']}")
            print(f"Title: {chunk.metadata['title']}")
            print(f"Content preview: {chunk.text[:200]}...")
        
        if len(chunks) > 3:
            print(f"\n... and {len(chunks) - 3} more chunks")
        
        # Initialize OpenAI and Pinecone
        client = OpenAI()
        index = load_pinecone()
        
        batch_size = 100
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            batch_dicts = [{"text": chunk.text} for chunk in batch]
            embeddings = create_embeddings(batch_dicts, client)
            
            # Prepare vectors for Pinecone
            vectors = []
            for j, (chunk, embedding) in enumerate(zip(batch, embeddings)):
                # Create standardized ID format: type||source||title||hash||chunkN
                page_hash = hex(abs(hash(chunk.metadata['source'])))[2:10]
                sanitized_title = sanitize_for_id(chunk.metadata['title'])
                vector_id = f"text||Ananda.org||{sanitized_title}||{page_hash}||chunk{chunk.metadata['chunk_index']}"
                
                vector = {
                    "id": vector_id,
                    "values": embedding,
                    "metadata": chunk.metadata
                }
                vectors.append(vector)
                
                # Log metadata and ID for first vector in each batch
                if j == 0:
                    logging.debug("\nSample vector ID:")
                    logging.debug(vector_id)
                    logging.debug("\nSample vector metadata:")
                    logging.debug(json.dumps(vector["metadata"], indent=2))
                
            # Upsert to Pinecone
            index.upsert(vectors=vectors)
            print(f"Uploaded {len(vectors)} vectors to Pinecone (batch {i//batch_size + 1})")
        
        print("\nIndexing completed successfully!")
    except SystemExit:
        raise  # Re-raise system exit to ensure clean shutdown
    except Exception as e:
        logging.error(f"Unexpected error: {e}")
        logging.error(traceback.format_exc())
    finally:
        crawler.save_checkpoint()

if __name__ == "__main__":
    main()
