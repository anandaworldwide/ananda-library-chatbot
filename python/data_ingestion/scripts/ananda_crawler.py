from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
from typing import Set, Dict, List
import logging
import traceback
import argparse
import json
from dataclasses import dataclass, asdict
import sys
import os
from datetime import datetime

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

class AnandaCrawler:
    def __init__(self, start_url: str = "https://ananda.org"):
        self.start_url = start_url
        self.visited_urls: Set[str] = set()
        self.domain = urlparse(start_url).netloc
        logging.debug(f"Initialized crawler with start URL: {start_url}, domain: {self.domain}")
        
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

    def should_skip_url(self, url: str) -> bool:
        """Check if URL should be skipped based on patterns"""
        return any(re.search(pattern, url) for pattern in self.skip_patterns)

    def is_valid_url(self, url: str) -> bool:
        """Check if URL should be crawled"""
        if not url or not url.startswith('http'):
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

    def crawl_page(self, page, url: str) -> tuple[PageContent, List[str]]:
        try:
            logging.info(f"Navigating to {url}")
            response = page.goto(url, timeout=60000)
            logging.info(f"Response status: {response.status if response else 'No response'}")
            
            if not response or response.status != 200:
                logging.error(f"Failed to load {url} with status {response.status if response else 'No response'}")
                return None, []
            
            page.wait_for_load_state('domcontentloaded', timeout=30000)
            page.wait_for_timeout(5000)  # Wait for JS rendering
            logging.debug("Page load state: domcontentloaded, waited 5s for rendering")
            
            html = page.content()
            logging.debug(f"Raw HTML length: {len(html)}")
            if len(html) < 100:
                logging.warning(f"HTML content suspiciously short for {url}: {html[:200]}")
            
            title = page.title()
            logging.debug(f"Page title: {title}")
            clean_text = self.clean_content(html)
            logging.debug(f"Cleaned text length: {len(clean_text)}")
            
            if not clean_text.strip():
                logging.warning(f"No content extracted from {url}")
                return None, []
            
            links = []
            elements = page.query_selector_all('a[href]')
            logging.debug(f"Found {len(elements)} raw links")
            for link in elements:
                href = link.get_attribute('href')
                if href:
                    absolute_url = urljoin(url, href)
                    if self.is_valid_url(absolute_url):
                        links.append(absolute_url)
            logging.info(f"Found {len(links)} valid links on {url}")
            
            return PageContent(
                url=url,
                title=title,
                content=clean_text,
                metadata={
                    'source': 'Ananda.org',
                    'type': 'text'
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
                logging.debug("Browser launched and User-Agent set")
                
                urls_to_crawl = [self.start_url]
                crawled_pages = []
                
                while urls_to_crawl and len(crawled_pages) < max_pages:
                    url = urls_to_crawl.pop(0)
                    logging.info(f"Processing URL: {url}")
                    
                    if url in self.visited_urls:
                        logging.debug(f"Skipping already visited URL: {url}")
                        continue
                    
                    content, new_links = self.crawl_page(page, url)
                    
                    if content:
                        self.visited_urls.add(url)  # Add to visited only after successful crawl
                        crawled_pages.append(content)
                        logging.info(f"Successfully crawled: {url}")
                        for link in new_links:
                            if link not in self.visited_urls and link not in urls_to_crawl:
                                urls_to_crawl.append(link)
                        logging.info(f"Queue size: {len(urls_to_crawl)}")
                    else:
                        logging.warning(f"No content returned for {url}")
                        self.visited_urls.add(url)  # Still mark as visited to avoid retrying
                
                return crawled_pages
            except Exception as e:
                logging.error(f"Browser error: {str(e)}")
                logging.error(traceback.format_exc())
                return []
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
                    'url': page.url,
                    'title': page.title,
                    'chunk_index': j,
                    'total_chunks': len(chunks),
                    'source': 'Ananda.org',
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

def main():
    parser = argparse.ArgumentParser(description='Crawl Ananda.org website and store in Pinecone')
    parser.add_argument(
        '--site', 
        default='ananda-public',
        help='Site ID for environment variables (e.g., ananda-public). Will load from .env.[site]'
    )
    parser.add_argument('--max-pages', type=int, default=10, help='Maximum number of pages to crawl')
    parser.add_argument('--start-url', default='https://ananda.org', help='Starting URL for crawler')
    args = parser.parse_args()

    # Load environment variables
    load_env(args.site)
    
    # Verify we're using the right environment
    print(f"\nUsing environment from .env.{args.site}")
    index_name = os.getenv('PINECONE_INGEST_INDEX_NAME')
    print(f"Target Pinecone index: {index_name}")
    confirm = input("Is this the correct environment? (yes/no): ")
    if confirm.lower() not in ['yes', 'y']:
        print("Aborting due to environment mismatch.")
        return
    
    # Initialize crawler
    crawler = AnandaCrawler(start_url=args.start_url)
    
    # Crawl pages
    print(f"\nStarting crawl of {args.start_url} with max pages: {args.max_pages}")
    pages = crawler.crawl(max_pages=args.max_pages)
    
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
        print(f"URL: {chunk.metadata['url']}")
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
            page_hash = hex(abs(hash(chunk.metadata['url'])))[2:10]
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
                print("\nSample vector ID:")
                print(vector_id)
                print("\nSample vector metadata:")
                print(json.dumps(vector["metadata"], indent=2))
                
        # Upsert to Pinecone
        index.upsert(vectors=vectors)
        print(f"Uploaded {len(vectors)} vectors to Pinecone (batch {i//batch_size + 1})")
    
    print("\nIndexing completed successfully!")

if __name__ == "__main__":
    main()
