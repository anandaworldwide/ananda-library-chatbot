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

def chunk_content(content: str, chunk_size: int = 1000, overlap: int = 500) -> List[str]:
    """Split content into overlapping chunks"""
    chunks = []
    start = 0
    content_len = len(content)
    
    print(f"Starting chunking of {content_len} characters")
    
    while start < content_len:
        # Calculate initial end position
        end = min(start + chunk_size, content_len)
        
        # If we're not at the end, look for a good break point
        if end < content_len:
            # Look for sentence breaks in the last 100 chars of the chunk
            search_start = max(start, end - 100)
            search_text = content[search_start:end]
            
            # Find last sentence break
            last_period = search_text.rfind('.')
            last_newline = search_text.rfind('\n')
            
            # If we found a break point, adjust end
            if last_period > 0 or last_newline > 0:
                break_point = max(last_period, last_newline)
                end = search_start + break_point + 1
        
        # Failsafe: If no good break found or end <= start, force a break
        if end <= start:
            end = min(start + chunk_size, content_len)
            print(f"Warning: Forced break at position {end}")
        
        # Extract chunk and append
        chunk = content[start:end].strip()
        if chunk:  # Only add non-empty chunks
            chunks.append(chunk)
            print(f"Created chunk {len(chunks)}: {start}-{end} ({len(chunk)} chars)")
        
        # Move start position for next chunk
        start = end - overlap
        
        # Failsafe: Ensure forward progress
        if start >= end:
            start = end
            print(f"Warning: Reset overlap at position {start}")
        
        # Extra safety check
        if len(chunks) > content_len / 100:  # Sanity check - no more than 1 chunk per 100 chars
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
                    'source': 'ananda.org',
                    'type': 'webpage'
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
        print(f"\nProcessing {len(pages)} pages into chunks:")
        
        for i, page in enumerate(pages, 1):
            print(f"\nPage {i}/{len(pages)}: {page.url}")
            print(f"Content length: {len(page.content)} characters")
            
            chunks = chunk_content(page.content)
            print(f"Created {len(chunks)} chunks (avg size: {sum(len(c) for c in chunks)/len(chunks):.0f} chars)")
            
            for j, chunk in enumerate(chunks):
                chunk_metadata = {
                    **page.metadata,
                    'url': page.url,
                    'title': page.title,
                    'chunk_index': j,
                    'total_chunks': len(chunks),
                    'source': 'ananda.org',
                    'type': 'text',
                    'library': 'Ananda.org',
                    'crawl_timestamp': datetime.now().isoformat()
                }
                all_chunks.append(WebsiteChunk(chunk, chunk_metadata))
        
        print(f"\nTotal chunks created: {len(all_chunks)}")
        return all_chunks

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
    print(f"\nPrepared {len(chunks)} chunks for indexing.")
    
    # Preview chunks
    print("\nPreview of chunks to be indexed:")
    for i, chunk in enumerate(chunks[:3]):  # Show first 3 chunks
        print(f"\nChunk {i+1}:")
        print(f"URL: {chunk.metadata['url']}")
        print(f"Title: {chunk.metadata['title']}")
        print(f"Content preview: {chunk.text[:200]}...")
    
    if len(chunks) > 3:
        print(f"\n... and {len(chunks) - 3} more chunks")
    
    # Ask for confirmation
    confirm = input("\nDo you want to proceed with indexing these chunks to Pinecone? (yes/no): ")
    if confirm.lower() != 'yes':
        print("Indexing cancelled.")
        return
    
    # Initialize OpenAI and Pinecone
    client = OpenAI()
    index = load_pinecone()
    
    print("\nGenerating embeddings and uploading to Pinecone...")
    batch_size = 100
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        # Convert WebsiteChunks to dicts with text field
        batch_dicts = [{"text": chunk.text} for chunk in batch]
        embeddings = create_embeddings(batch_dicts, client)
        
        # Prepare vectors for Pinecone
        vectors = []
        for j, (chunk, embedding) in enumerate(zip(batch, embeddings)):
            vector_id = f"ananda_org_{i+j}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            vector = {
                "id": vector_id,
                "values": embedding,
                "metadata": chunk.metadata
            }
            vectors.append(vector)
            
            # Log metadata for first vector in each batch
            if j == 0:
                print("\nSample vector metadata:")
                print(json.dumps(vector["metadata"], indent=2))
        
        # Upsert to Pinecone
        index.upsert(vectors=vectors)
        print(f"Uploaded {len(vectors)} vectors to Pinecone (batch {i//batch_size + 1})")
    
    print("\nIndexing completed successfully!")

if __name__ == "__main__":
    main()
