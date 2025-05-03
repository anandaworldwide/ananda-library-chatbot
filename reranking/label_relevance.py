#!/usr/bin/env python3
"""
Document Relevance Labeling Tool

This script helps create a fine-tuning dataset for a cross-encoder reranker by:
1. Loading queries from sample-questions.txt
2. Retrieving relevant documents from Pinecone
3. Creating markdown files with highlighted query terms
4. Opening markdown files in Typora for manual labeling
5. Parsing the labeled data and saving to JSONL format
"""

import os
import sys
import json
import time
import argparse
import re
import subprocess
from typing import List, Dict, Any, Optional, Set, Tuple
from dotenv import load_dotenv
from pinecone import Pinecone
import nltk
from nltk.corpus import stopwords
import openai
import webbrowser

# Import the load_env utility
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pyutil.env_utils import load_env

# Constants
DEFAULT_RETRIEVAL_COUNT = 20
RELEVANCE_SCALE = {
    0: "Irrelevant",
    1: "Marginally Relevant",
    2: "Relevant",
    3: "Highly Relevant"
}
MARKDOWN_TEMPLATE = """# Query: {query}

## Instructions
Review each document below and assign a relevance score:
- **3**: Highly Relevant - Directly answers the query
- **2**: Relevant - Contains information related to the query
- **1**: Marginally Relevant - Mentions query topics but not directly helpful
- **0**: Irrelevant - Not related to the query

## Documents

{documents}

"""

DOCUMENT_TEMPLATE = """### Document {index}

{content}

*Scoring: 0=Irrelevant, 1=Marginally Relevant, 2=Relevant, 3=Highly Relevant*
**Relevance Score** [Enter 0-3]: 

---

"""

# Paths
OUTPUT_DIR = "reranking/labeled_data"
MARKDOWN_DIR = "reranking/markdown_files"


class RelevanceLabeler:
    def __init__(self, args):
        self.args = args
        self.site_id = args.site
        self.debug_mode = args.debug
        
        # Update file paths with site-specific subdirectories
        self.evaluation_output = f"reranking/evaluation_dataset_{self.site_id}.jsonl"
        self.fine_tuning_output = f"reranking/fine_tuning_dataset_{self.site_id}.jsonl"
        self.progress_file = f"reranking/relevance_labeling_progress_{self.site_id}.json"
        self.output_dir = f"{OUTPUT_DIR}/{self.site_id}"
        self.markdown_dir = f"{MARKDOWN_DIR}/{self.site_id}"
        
        # Load site-specific environment variables
        self._load_environment()
        
        # Load site configuration and included libraries
        self.site_config = self._load_site_config()
        self.included_libraries = self._get_included_libraries()
        self.enabled_media_types = self._get_enabled_media_types()
        
        self.progress = self._load_progress()
        self.queries = self._load_queries()
        self.stop_words = self._load_stop_words()
        self._initialize_directories()
        self._initialize_clients()
        
        print(f"Working with site: {self.site_id}")
        print(f"Included libraries: {self.included_libraries}")
        print(f"Enabled media types: {self.enabled_media_types}")
        
        if self.debug_mode:
            print("Debug mode enabled - verbose logging active")
        
    def _load_environment(self):
        """Load site-specific environment variables."""
        try:
            # Load site-specific environment using .env.SITENAME
            load_env(self.site_id)
            print(f"Loaded environment for site: {self.site_id} from .env.{self.site_id}")
        except FileNotFoundError as e:
            sys.exit(f"Error: {e}. Environment file .env.{self.site_id} is required.")
        except Exception as e:
            sys.exit(f"Error loading environment: {e}")

    def _initialize_directories(self):
        """Ensure all necessary directories exist."""
        for directory in [self.output_dir, self.markdown_dir]:
            os.makedirs(directory, exist_ok=True)

    def _initialize_clients(self):
        """Initialize Pinecone and OpenAI clients."""
        # Initialize Pinecone
        api_key = os.getenv("PINECONE_API_KEY")
        if not api_key:
            sys.exit("Error: PINECONE_API_KEY environment variable not set")

        self.pinecone = Pinecone(api_key=api_key)
        
        # Get index name from environment
        self.index_name = os.getenv("PINECONE_INDEX_NAME")
        if not self.index_name:
            sys.exit("Error: PINECONE_INDEX_NAME environment variable not set")
        
        try:
            self.index = self.pinecone.Index(self.index_name)
            print(f"Connected to Pinecone index: {self.index_name}")
        except Exception as e:
            sys.exit(f"Error connecting to Pinecone index: {e}")
            
        # Initialize OpenAI client for embeddings
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            sys.exit("Error: OPENAI_API_KEY environment variable not set")
        
        self.openai_client = openai.OpenAI(api_key=openai_api_key)
        
    def _load_stop_words(self) -> Set[str]:
        """Load NLTK stop words or a basic set if NLTK is not available."""
        try:
            nltk.download('stopwords', quiet=True)
            return set(stopwords.words('english'))
        except:
            # Fallback to basic stopwords if NLTK is not available
            print("Warning: NLTK stopwords not available, using basic set")
            return {
                'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 
                'were', 'be', 'been', 'being', 'in', 'on', 'at', 'to', 'for',
                'with', 'by', 'about', 'like', 'through', 'over', 'before',
                'after', 'between', 'into', 'during', 'without', 'of', 'i',
                'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his',
                'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours',
                'they', 'them', 'their', 'theirs', 'what', 'which', 'who',
                'whom', 'this', 'that', 'these', 'those', 'am', 'have', 'has',
                'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would',
                'shall', 'should', 'may', 'might', 'must', 'how'
            }
            
    def _load_progress(self) -> Dict[str, Any]:
        """Load progress from the JSON file or create a new progress tracker."""
        if os.path.exists(self.progress_file):
            try:
                with open(self.progress_file, 'r') as f:
                    return json.load(f)
            except json.JSONDecodeError:
                print(f"Error: Progress file {self.progress_file} is corrupted. Creating new one.")
        
        # Initialize new progress
        return {
            "processed_queries": [],
            "current_index": 0,
            "evaluation_count": 0,
            "fine_tuning_count": 0,
            "last_update": time.time(),
            "site_id": self.site_id
        }
        
    def _save_progress(self):
        """Save the current progress to the JSON file."""
        self.progress["last_update"] = time.time()
        with open(self.progress_file, 'w') as f:
            json.dump(self.progress, f, indent=2)
        
    def _load_queries(self) -> List[str]:
        """Load queries from the sample questions file."""
        try:
            # Try multiple possible locations for the sample questions file
            possible_paths = [
                'sample-questions.txt',  # When run from reranking directory
                'reranking/sample-questions.txt',  # When run from project root
                os.path.join(os.path.dirname(__file__), 'sample-questions.txt')  # Absolute path
            ]
            
            for path in possible_paths:
                if os.path.exists(path):
                    with open(path, 'r') as f:
                        # Remove quotes and extra whitespace
                        queries = [line.strip().strip('"\'').strip() for line in f.readlines()]
                        # Remove empty lines
                        queries = [q for q in queries if q]
                    print(f"Loaded queries from: {path}")
                    return queries
                
            raise FileNotFoundError("Could not find sample-questions.txt in any expected location")
        except FileNotFoundError:
            sys.exit("Error: sample-questions.txt file not found. Make sure it exists in the reranking directory.")
    
    def get_embedding(self, text: str) -> List[float]:
        """Get embedding for a text using OpenAI's API."""
        try:
            response = self.openai_client.embeddings.create(
                model="text-embedding-ada-002",
                input=text
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"Error generating embedding: {e}")
            # Return empty embedding in case of error
            return []
            
    def retrieve_documents(self, query: str, top_k: int = DEFAULT_RETRIEVAL_COUNT) -> List[Dict[str, Any]]:
        """Retrieve documents from Pinecone using semantic search."""
        try:
            # Get embedding for the query
            print(f"Generating embedding for query: {query}")
            query_embedding = self.get_embedding(query)
            if not query_embedding:
                print("Warning: Empty embedding generated for query")
                return []
                
            # Define metadata fields to exclude
            exclude_fields = set()
            for prefix in ["loc.", "pdf."]:
                exclude_fields.update([f for f in range(100) if f"{prefix}{f}"])  # Generate potential field names to exclude
            
            # Create a clean filter structure with proper $and logic
            filter_condition = {}
            filter_parts = []
            
            # Add media type filter if enabled_media_types is defined
            if self.enabled_media_types:
                filter_parts.append({
                    "type": {
                        "$in": self.enabled_media_types
                    }
                })
                
            # Add library filter if included_libraries is defined
            if self.included_libraries:
                filter_parts.append({
                    "library": {
                        "$in": self.included_libraries
                    }
                })
                
            # Build the final filter structure
            if len(filter_parts) > 1:
                # Multiple filters - use $and
                filter_condition = {
                    "$and": filter_parts
                }
            elif len(filter_parts) == 1:
                # Just one filter - use it directly
                filter_condition = filter_parts[0]
            # else: empty filter_condition if no parts
                
            if filter_parts:
                print(f"Querying Pinecone with filters")
            else:
                print("No filters applied - querying all documents")
                
            results = self.index.query(
                vector=query_embedding,
                top_k=top_k,
                include_metadata=True,
                filter=filter_condition
            )
            
            print(f"Pinecone returned {len(results.matches)} matches")
            
            documents = []
            for match in results.matches:
                # Filter out loc.* and pdf.* metadata fields
                filtered_metadata = {k: v for k, v in match.metadata.items() 
                                   if k != "text" and not k.startswith("loc.") and not k.startswith("pdf.")}
                
                doc = {
                    "id": match.id,
                    "score": match.score,
                    "text": match.metadata.get("text", ""),
                    "metadata": filtered_metadata
                }
                documents.append(doc)
            
            if not documents:
                print("No documents were found. Possible issues:")
                if self.included_libraries:
                    print(f"1. No documents with libraries {self.included_libraries} exist in the index")
                if self.enabled_media_types:
                    print(f"2. No documents with media types {self.enabled_media_types} exist in the index")
                print(f"3. The query embedding might not match any documents")
                print(f"4. The filter might be too restrictive")
                
                # Add an option to try without filters for debugging
                retry = input("Would you like to try without filters for debugging? (y/n): ")
                if retry.lower() == 'y':
                    print("Retrying without filters...")
                    results = self.index.query(
                        vector=query_embedding,
                        top_k=top_k,
                        include_metadata=True
                    )
                    
                    print(f"Without filter: Pinecone returned {len(results.matches)} matches")
                    
                    if results.matches:
                        print("Documents exist but don't match your filters. Available libraries and types:")
                        libraries = set()
                        types = set()
                        for match in results.matches:
                            libraries.add(match.metadata.get("library", "UNKNOWN"))
                            types.add(match.metadata.get("type", "UNKNOWN"))
                        print(f"Found libraries: {libraries}")
                        print(f"Found types: {types}")
                        print(f"Your filters - Libraries: {self.included_libraries}, Types: {self.enabled_media_types}")
                
            print(f"Retrieved {len(documents)} documents for query: {query}")
            return documents
        except Exception as e:
            print(f"Error retrieving documents: {e}")
            print(f"Exception type: {type(e).__name__}")
            import traceback
            traceback.print_exc()
            return []
    
    def highlight_query_terms(self, document_text: str, query: str) -> str:
        """Highlight query terms in the document text, excluding stop words."""
        # Extract query terms (excluding stop words)
        query_terms = set()
        for term in re.findall(r'\b\w+\b', query.lower()):
            if term not in self.stop_words and len(term) > 2:  # Skip short terms
                query_terms.add(term)
        
        # Create a regex pattern for all query terms
        if not query_terms:
            return document_text
            
        pattern = r'\b(' + '|'.join(re.escape(term) for term in query_terms) + r')\b'
        
        # Replace with highlighted version (case-insensitive)
        highlighted = re.sub(
            pattern, 
            r'**\1**', 
            document_text, 
            flags=re.IGNORECASE
        )
        
        return highlighted
    
    def create_markdown_file(self, query: str, documents: List[Dict[str, Any]]) -> str:
        """Create a markdown file for labeling documents."""
        # Prepare documents with highlighting
        doc_texts = []
        for i, doc in enumerate(documents, 1):
            content = self.highlight_query_terms(doc["text"], query)
            # Add metadata display, excluding loc.* and pdf.* fields
            filtered_metadata = {k: v for k, v in doc["metadata"].items() 
                               if not k.startswith("loc.") and not k.startswith("pdf.")}
            metadata_text = "\n".join([f"**{k}**: {v}" for k, v in filtered_metadata.items()])
            content_with_metadata = f"{content}\n\n*Metadata:*\n{metadata_text}"
            
            doc_text = DOCUMENT_TEMPLATE.format(
                index=i,
                content=content_with_metadata
            )
            doc_texts.append(doc_text)
            
        # Create the full markdown content
        markdown_content = MARKDOWN_TEMPLATE.format(
            query=query,
            documents="\n".join(doc_texts)
        )
        
        # Save to file
        filename = f"{self.markdown_dir}/{self._sanitize_filename(query)}.md"
        with open(filename, 'w') as f:
            f.write(markdown_content)
            
        return filename
    
    def _sanitize_filename(self, filename: str) -> str:
        """Convert string to valid filename."""
        # Replace invalid chars with underscore
        sanitized = re.sub(r'[^\w\s-]', '_', filename)
        # Replace whitespace with hyphen
        sanitized = re.sub(r'[\s]+', '-', sanitized)
        # Truncate if too long
        if len(sanitized) > 100:
            sanitized = sanitized[:100]
        return sanitized
    
    def open_in_typora(self, filename: str) -> None:
        """Open the markdown file in Typora and wait for user to close it."""
        try:
            # Check if Typora is installed
            typora_path = self._get_typora_path()
            if not typora_path:
                print(f"Typora not found. Opening {filename} in default application.")
                webbrowser.open(filename)
                input("Press Enter when you have finished editing the file...")
                return
                
            # Open Typora with the file
            process = subprocess.Popen([typora_path, filename])
            print(f"Opened {filename} in Typora. Please complete the labeling and save the file.")
            print("When you're done, close Typora to continue.")
            
            # Wait for the process to complete
            process.wait()
            
        except Exception as e:
            print(f"Error opening Typora: {e}")
            print(f"Please open {filename} manually and press Enter when done.")
            input()
    
    def _get_typora_path(self) -> Optional[str]:
        """Find the path to Typora executable."""
        if sys.platform == 'darwin':  # macOS
            default_paths = [
                '/Applications/Typora.app/Contents/MacOS/Typora',
                os.path.expanduser('~/Applications/Typora.app/Contents/MacOS/Typora')
            ]
            for path in default_paths:
                if os.path.exists(path):
                    return path
        elif sys.platform == 'win32':  # Windows
            import winreg
            try:
                with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r'typora\shell\open\command') as key:
                    command = winreg.QueryValue(key, None)
                    # Extract path from the command (usually in format: "path" "%1")
                    path = command.split('"')[1]
                    return path
            except:
                # Check common installation locations
                program_files = os.environ.get('PROGRAMFILES', 'C:\\Program Files')
                path = os.path.join(program_files, 'Typora', 'Typora.exe')
                if os.path.exists(path):
                    return path
        elif sys.platform == 'linux':  # Linux
            # Try to find Typora in PATH
            try:
                path = subprocess.check_output(['which', 'typora']).decode().strip()
                return path
            except:
                pass
        
        return None
    
    def parse_labeled_markdown(self, filename: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Parse the labeled markdown file to extract relevance scores."""
        try:
            with open(filename, 'r') as f:
                content = f.read()
            
            # Find all document sections
            doc_pattern = r'### Document (\d+)\s*\n\n(.*?)(?=\n\n\*Scoring:)'
            doc_sections = re.findall(doc_pattern, content, re.DOTALL)
            
            # First detect if there are entries, even invalid ones
            entry_pattern = r'Document (\d+).*?\*Scoring:.*?\*\*Relevance Score\*\* \[Enter 0-3\]: ([^\n]*)'
            entry_matches = re.findall(entry_pattern, content, re.DOTALL)
            
            # Valid scores pattern (must be a single digit 0-3)
            score_pattern = r'Document (\d+).*?\*Scoring:.*?\*\*Relevance Score\*\* \[Enter 0-3\]: (\d)'
            score_matches = re.findall(score_pattern, content, re.DOTALL)
            
            # Track invalid entries
            invalid_entries = {}
            for doc_idx, entry in entry_matches:
                entry = entry.strip()
                if entry and not re.match(r'^\d$', entry):
                    invalid_entries[int(doc_idx)] = entry
            
            # Convert valid score matches to a dictionary for easy lookup
            scores = {int(doc_idx): int(score) for doc_idx, score in score_matches}
            
            labeled_docs = []
            if not score_matches:
                print(f"Warning: No relevance scores found in {filename}")
                return []
            
            # Track skipped documents
            skipped_docs = 0
            
            # Process all document sections
            for doc_idx_str, doc_content in doc_sections:
                doc_idx = int(doc_idx_str)
                idx = doc_idx - 1  # Convert to 0-based index
                
                # Extract title from metadata if possible
                title = "Unknown"
                title_match = re.search(r'\*\*title\*\*: (.*?)(?:\n|$)', doc_content)
                if title_match:
                    title = title_match.group(1)
                
                # Check for invalid entries first
                if doc_idx in invalid_entries:
                    invalid_value = invalid_entries[doc_idx]
                    print(f"Warning: Document {doc_idx} '{title}' has invalid score entry '{invalid_value}' - must be a digit 0-3")
                    skipped_docs += 1
                    continue
                # Then check for missing scores
                elif doc_idx not in scores:
                    print(f"Warning: Document {doc_idx} '{title}' was skipped - no score provided")
                    skipped_docs += 1
                    continue
                
                score = scores[doc_idx]
                if score < 0 or score > 3:
                    print(f"Warning: Document {doc_idx} '{title}' has invalid score {score} - must be 0-3")
                    skipped_docs += 1
                    continue
                
                try:
                    if 0 <= idx < len(documents):
                        doc = documents[idx].copy()
                        doc["relevance"] = score
                        labeled_docs.append(doc)
                    else:
                        print(f"Warning: Document index {doc_idx} '{title}' out of range")
                        skipped_docs += 1
                except ValueError:
                    print(f"Warning: Invalid score format for document {doc_idx} '{title}'")
                    skipped_docs += 1
            
            print(f"Parsed {len(labeled_docs)} labeled documents from {filename}")
            if skipped_docs > 0:
                print(f"Skipped {skipped_docs} documents due to missing or invalid scores")
            return labeled_docs
            
        except Exception as e:
            print(f"Error parsing labeled markdown: {e}")
            return []
    
    def save_to_jsonl(self, data: List[Dict[str, Any]], output_file: str) -> None:
        """Save data to a JSONL file."""
        with open(output_file, 'a') as f:
            for item in data:
                f.write(json.dumps(item) + '\n')
        print(f"Saved {len(data)} items to {output_file}")
    
    def allocate_documents(self, query: str, labeled_docs: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Allocate documents between evaluation and fine-tuning datasets."""
        # Sort by relevance score (descending)
        labeled_docs.sort(key=lambda x: x["relevance"], reverse=True)
        
        # For evaluation dataset, include all documents with their scores
        evaluation_docs = []
        for doc in labeled_docs:
            evaluation_docs.append({
                "relevance": doc["relevance"],  
                "query": query,
                "document": doc["text"],
                "metadata": doc["metadata"],
                "site_id": self.site_id,
                "library": doc["metadata"].get("library", "UNKNOWN")
            })
            
        # For fine-tuning dataset, create binary labels
        # Include all relevant documents (score 2-3) as positive examples
        # and a subset of irrelevant documents (score 0-1) as negative examples
        fine_tuning_docs = []
        
        # Add positive examples (scores 2-3)
        positive_docs = [doc for doc in labeled_docs if doc["relevance"] >= 2]
        for doc in positive_docs:
            fine_tuning_docs.append({
                "label": 1.0,  
                "query": query,
                "document": doc["text"],
                "metadata": doc["metadata"],
                "site_id": self.site_id,
                "library": doc["metadata"].get("library", "UNKNOWN")
            })
            
        # Add negative examples (scores 0-1)
        # Limit to same number as positive examples to avoid imbalance
        negative_docs = [doc for doc in labeled_docs if doc["relevance"] <= 1]
        negative_count = min(len(positive_docs), len(negative_docs))
        for doc in negative_docs[:negative_count]:
            fine_tuning_docs.append({
                "label": 0.0, 
                "query": query,
                "document": doc["text"],
                "metadata": doc["metadata"],
                "site_id": self.site_id,
                "library": doc["metadata"].get("library", "UNKNOWN")
            })
            
        return evaluation_docs, fine_tuning_docs
    
    def process_query(self, query: str) -> bool:
        """Process a single query through the labeling workflow."""
        print(f"\n{'='*80}\nProcessing query: {query}\n{'='*80}")
        
        # Retrieve documents
        documents = self.retrieve_documents(query)
        if not documents:
            print("No documents retrieved. Skipping query.")
            return False
            
        # Create markdown for labeling
        markdown_file = self.create_markdown_file(query, documents)
        
        # Open in Typora for labeling
        self.open_in_typora(markdown_file)
        
        # Parse labeled data
        labeled_docs = self.parse_labeled_markdown(markdown_file, documents)
        if not labeled_docs:
            user_input = input("No labels found. Retry this query? (y/n): ").lower()
            if user_input == 'y':
                return self.process_query(query)  # Recursively retry
            return False
            
        # Allocate documents between datasets
        evaluation_docs, fine_tuning_docs = self.allocate_documents(query, labeled_docs)
        
        # Save to respective output files
        self.save_to_jsonl(evaluation_docs, self.evaluation_output)
        self.save_to_jsonl(fine_tuning_docs, self.fine_tuning_output)
        
        # Update progress
        self.progress["processed_queries"].append(query)
        self.progress["evaluation_count"] += len(evaluation_docs)
        self.progress["fine_tuning_count"] += len(fine_tuning_docs)
        self._save_progress()
        
        return True
    
    def run(self):
        """Run the labeling process for all queries."""
        total_queries = len(self.queries)
        start_idx = self.progress["current_index"]
        
        print(f"Starting relevance labeling at query {start_idx+1}/{total_queries}")
        print(f"Already processed: {len(self.progress['processed_queries'])} queries")
        print(f"Evaluation dataset: {self.progress['evaluation_count']} examples")
        print(f"Fine-tuning dataset: {self.progress['fine_tuning_count']} examples")
        print(f"Output files: {self.evaluation_output} and {self.fine_tuning_output}")
        
        try:
            for i in range(start_idx, total_queries):
                query = self.queries[i]
                
                # Skip if already processed
                if query in self.progress["processed_queries"]:
                    print(f"Skipping already processed query: {query}")
                    continue
                    
                # Update current index
                self.progress["current_index"] = i
                self._save_progress()
                
                # Process the query
                success = self.process_query(query)
                
                # If we've reached the target counts, we can stop
                if (self.progress["evaluation_count"] >= 1000 and 
                    self.progress["fine_tuning_count"] >= 200):
                    print("Target dataset sizes reached!")
                    break
                    
                # Ask user if they want to continue
                if i < total_queries - 1:
                    # Save progress more frequently
                    self._save_progress()
                    
                    # Provide a status update
                    print(f"\nProgress: {i+1}/{total_queries} queries processed")
                    print(f"Evaluation dataset: {self.progress['evaluation_count']} examples")
                    print(f"Fine-tuning dataset: {self.progress['fine_tuning_count']} examples")
                    
                    user_input = input("\nContinue to next query? (Y/n): ").lower()
                    if user_input == '' or user_input == 'y' or user_input == 'yes':
                        continue
                    else:
                        print("Stopping labeling process.")
                        break
        except KeyboardInterrupt:
            print("\nProcess interrupted by user.")
        finally:
            # Save progress one last time
            self._save_progress()
            
            # Show final statistics
            processed = len(self.progress["processed_queries"])
            print(f"\nLabeling session complete!")
            print(f"Processed {processed}/{total_queries} queries")
            print(f"Created {self.progress['evaluation_count']} evaluation examples")
            print(f"Created {self.progress['fine_tuning_count']} fine-tuning examples")
            print(f"Site ID: {self.site_id}")

    def run_diagnostics(self):
        """Run diagnostics to check Pinecone connectivity and index status."""
        print("\nRunning diagnostics...")
        
        # Check Pinecone index information
        try:
            index_stats = self.index.describe_index_stats()
            print(f"Connected to Pinecone index: {self.index_name}")
            print(f"Total vector count: {index_stats.total_vector_count}")
            
            # Check if there are any vectors
            if index_stats.total_vector_count == 0:
                print("WARNING: The index is empty! No vectors have been uploaded.")
                return
            
            # Check for available libraries and media types in the index
            print("Checking for available libraries and media types...")
            # Query without filters to get a sample of the data
            results = self.index.query(
                vector=[0.1] * index_stats.dimension,  # Use a random vector just to get some results
                top_k=100,
                include_metadata=True
            )
            
            if not results.matches:
                print("WARNING: No documents returned from a test query.")
            else:
                libraries = set()
                media_types = set()
                
                for match in results.matches:
                    if 'metadata' in dir(match) and hasattr(match, 'metadata'):
                        library = match.metadata.get("library", "UNKNOWN")
                        libraries.add(library)
                        
                        media_type = match.metadata.get("type", "UNKNOWN")
                        media_types.add(media_type)
                
                # Test if documents exist matching both filters
                if self.included_libraries and self.enabled_media_types:
                    test_filter = {
                        "$and": [
                            {"library": {"$in": self.included_libraries}},
                            {"type": {"$in": self.enabled_media_types}}
                        ]
                    }
                    
                    test_results = self.index.query(
                        vector=[0.1] * index_stats.dimension,
                        top_k=10,
                        include_metadata=True,
                        filter=test_filter
                    )
                    
                    if not test_results.matches:
                        print(f"WARNING: No documents match your libraries AND media types filters!")
                        print(f"Available libraries: {libraries}")
                        print(f"Available media types: {media_types}")
                    else:
                        print(f"Found {len(test_results.matches)} documents matching your filters.")
            
            # Test embedding generation
            test_embedding = self.get_embedding("This is a test query")
            if test_embedding and len(test_embedding) > 0:
                print(f"Embedding generation successful.")
            else:
                print("ERROR: Failed to generate embedding!")
                
        except Exception as e:
            print(f"ERROR in diagnostics: {str(e)}")
            
        print("Diagnostics complete.\n")

    def _load_site_config(self):
        """Load site configuration from config.json."""
        try:
            config_path = "web/site-config/config.json"
            with open(config_path, 'r') as f:
                config = json.load(f)
                
            if self.site_id not in config:
                print(f"Warning: Site ID '{self.site_id}' not found in config.json. Using default filtering.")
                return {}
                
            return config[self.site_id]
        except Exception as e:
            print(f"Warning: Could not load site config: {e}. Using default filtering.")
            return {}
            
    def _get_included_libraries(self):
        """Extract included libraries from site configuration."""
        if not self.site_config:
            print("Warning: No site configuration found. No library filtering will be applied.")
            return []
            
        included_libraries = self.site_config.get("includedLibraries", [])
        
        # Handle both formats: simple array of strings or array of objects with name property
        libraries = []
        for lib in included_libraries:
            if isinstance(lib, str):
                libraries.append(lib)
            elif isinstance(lib, dict) and "name" in lib:
                libraries.append(lib["name"])
                
        if not libraries:
            print("Warning: No included libraries found in site config. No library filtering will be applied.")
            
        return libraries
        
    def _get_enabled_media_types(self):
        """Extract enabled media types from site configuration."""
        if not self.site_config:
            return None
            
        # Get enabledMediaTypes from config
        enabled_types = self.site_config.get("enabledMediaTypes", None)
        
        # If enabledMediaTypes is not defined, use default
        if enabled_types is None:
            # Default to ["text", "audio", "youtube"] as in the web code
            return ["text", "audio", "youtube"]
            
        return enabled_types


def main():
    parser = argparse.ArgumentParser(description="Document Relevance Labeling Tool")
    parser.add_argument("--reset", action="store_true", help="Reset progress and start from the beginning")
    parser.add_argument("--site", type=str, required=True, help="Site ID to use for filtering documents and loading environment variables (required)")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode with additional diagnostics")
    args = parser.parse_args()
    
    progress_file = f"reranking/relevance_labeling_progress_{args.site}.json"
    
    if args.reset and os.path.exists(progress_file):
        os.remove(progress_file)
        print(f"Progress reset for site {args.site}. Starting from the beginning.")
    
    labeler = RelevanceLabeler(args)
    
    # Run diagnostics if debug mode is enabled
    if args.debug:
        labeler.run_diagnostics()
        
    labeler.run()


if __name__ == "__main__":
    main() 