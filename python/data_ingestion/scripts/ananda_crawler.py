from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import re
from typing import Set, Dict, List
import logging
import traceback
from dataclasses import dataclass

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

class AnandaCrawler:
    def __init__(self, start_url: str = "https://ananda.org"):
        self.start_url = start_url
        self.visited_urls: Set[str] = set()
        self.domain = urlparse(start_url).netloc
        logging.debug(f"Initialized crawler with start URL: {start_url}, domain: {self.domain}")

    def is_valid_url(self, url: str) -> bool:
        if not url or not url.startswith('http'):
            return False
        parsed = urlparse(url)
        return parsed.netloc == self.domain

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

if __name__ == "__main__":
    crawler = AnandaCrawler()
    pages = crawler.crawl(max_pages=25)
    
    print(f"\nCrawled {len(pages)} pages:")
    for page in pages:
        print(f"\nURL: {page.url}")
        print(f"Title: {page.title}")
        print(f"Content length: {len(page.content)}")
        print(f"Content preview: {page.content[:500]}...")