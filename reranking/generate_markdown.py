#!/usr/bin/env python3
"""
Document Relevance Labeling Generator

This script generates markdown files for document relevance labeling by:
1. Loading queries from an input file
2. Retrieving relevant documents from Pinecone
3. Creating markdown files with highlighted query terms
4. Adding judge and completion fields at the top
"""

import os
import sys
import json
import argparse
import re
from typing import List, Dict, Any, Set
from dotenv import load_dotenv
from pinecone import Pinecone
import openai
import nltk
from nltk.corpus import stopwords

# Import the load_env utility
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pyutil.env_utils import load_env

# Constants
DEFAULT_RETRIEVAL_COUNT = 20
MARKDOWN_TEMPLATE = """Judge: 
Done? (y/yes): 

# Query: {query}

## Instructions
Review each document below and assign a relevance score:
- **3**: Highly Relevant - Directly answers the query
- **2**: Relevant - Contains information related to the query
- **1**: Marginally Relevant - Mentions query topics but not directly helpful
- **0**: Irrelevant - Not related to the query

*Skip duplicate entries to avoid overfitting the model.*


## Documents

{documents}

"""

DOCUMENT_TEMPLATE = """### Document {index}

{content}

*Scoring: 0=Irrelevant, 1=Marginally Relevant, 2=Relevant, 3=Highly Relevant*
**Relevance Score** [Enter 0-3]: 

---

"""

class MarkdownGenerator:
    def __init__(self, args):
        self.args = args
        self.site_id = args.site
        self.debug_mode = args.debug
        
        # Update file paths with site-specific subdirectories
        self.markdown_dir = f"reranking/markdown_files/{self.site_id}"
        
        # Load site-specific environment variables
        self._load_environment()
        
        # Load site configuration and included libraries
        self.site_config = self._load_site_config()
        self.included_libraries = self._get_included_libraries()
        self.enabled_media_types = self._get_enabled_media_types()
        
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
            load_env(self.site_id)
            print(f"Loaded environment for site: {self.site_id} from .env.{self.site_id}")
        except FileNotFoundError as e:
            sys.exit(f"Error: {e}. Environment file .env.{self.site_id} is required.")
        except Exception as e:
            sys.exit(f"Error loading environment: {e}")

    def _initialize_directories(self):
        """Ensure all necessary directories exist."""
        os.makedirs(self.markdown_dir, exist_ok=True)

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
            return []

    def retrieve_documents(self, query: str, top_k: int = DEFAULT_RETRIEVAL_COUNT) -> List[Dict[str, Any]]:
        """Retrieve documents from Pinecone using semantic search."""
        try:
            if self.debug_mode:
                print(f"Generating embedding for query: {query}")
            query_embedding = self.get_embedding(query)
            if not query_embedding:
                print("Warning: Empty embedding generated for query")
                return []

            # Create filter structure
            filter_condition = {}
            filter_parts = []
            
            if self.enabled_media_types:
                filter_parts.append({
                    "type": {
                        "$in": self.enabled_media_types
                    }
                })
                
            if self.included_libraries:
                filter_parts.append({
                    "library": {
                        "$in": self.included_libraries
                    }
                })
                
            if len(filter_parts) > 1:
                filter_condition = {"$and": filter_parts}
            elif len(filter_parts) == 1:
                filter_condition = filter_parts[0]

            if self.debug_mode:
                if filter_parts:
                    print("Querying Pinecone with filters")
                else:
                    print("No filters applied - querying all documents")

            results = self.index.query(
                vector=query_embedding,
                top_k=top_k,
                include_metadata=True,
                filter=filter_condition
            )

            if self.debug_mode:
                print(f"Pinecone returned {len(results.matches)} matches")

            documents = []
            for match in results.matches:
                filtered_metadata = {k: v for k, v in match.metadata.items() 
                                   if k != "text" and not k.startswith("loc.") and not k.startswith("pdf.") and k != "full_info"}
                
                doc = {
                    "id": match.id,
                    "score": match.score,
                    "text": match.metadata.get("text", ""),
                    "metadata": filtered_metadata
                }
                documents.append(doc)

            if not documents:
                print("No documents were found.")

            if self.debug_mode:
                print(f"Retrieved {len(documents)} documents for query: {query}")
            return documents

        except Exception as e:
            print(f"Error retrieving documents: {e}")
            return []

    def highlight_query_terms(self, document_text: str, query: str) -> str:
        """Highlight query terms in the document text, excluding stop words."""
        query_terms = set()
        for term in re.findall(r'\b\w+\b', query.lower()):
            if term not in self.stop_words and len(term) > 2:
                query_terms.add(term)
        
        if not query_terms:
            return document_text
            
        pattern = r'\b(' + '|'.join(re.escape(term) for term in query_terms) + r')\b'
        highlighted = re.sub(pattern, r'**\1**', document_text, flags=re.IGNORECASE)
        
        return highlighted

    def create_markdown_file(self, query: str, documents: List[Dict[str, Any]]) -> str:
        """Create a markdown file for labeling documents."""
        doc_texts = []
        for i, doc in enumerate(documents, 1):
            content = self.highlight_query_terms(doc["text"], query)
            filtered_metadata = {k: v for k, v in doc["metadata"].items() 
                               if not k.startswith("loc.") and not k.startswith("pdf.") and k != "full_info"}
            metadata_text = "\n".join([f"**{k}**: {v}" for k, v in filtered_metadata.items()])
            content_with_metadata = f"{content}\n\n*Metadata:*\n{metadata_text}"
            
            doc_text = DOCUMENT_TEMPLATE.format(
                index=i,
                content=content_with_metadata
            )
            doc_texts.append(doc_text)
            
        markdown_content = MARKDOWN_TEMPLATE.format(
            query=query,
            documents="\n".join(doc_texts)
        )
        
        # Generate base filename
        base_filename = self._sanitize_filename(query)
        filename = f"{base_filename}.md"
        filepath = os.path.join(self.markdown_dir, filename)
        
        # Handle filename conflicts
        counter = 1
        while os.path.exists(filepath):
            # If file exists, create a new name with a counter
            filename = f"{base_filename}_{counter}.md"
            filepath = os.path.join(self.markdown_dir, filename)
            counter += 1
        
        # Write the file
        with open(filepath, 'w') as f:
            f.write(markdown_content)
            
        return filepath

    def _sanitize_filename(self, filename: str) -> str:
        """Convert string to valid filename."""
        sanitized = re.sub(r'[^\w\s-]', '_', filename)
        sanitized = re.sub(r'[\s]+', '-', sanitized)
        if len(sanitized) > 100:
            sanitized = sanitized[:100]
        return sanitized

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
            
        enabled_types = self.site_config.get("enabledMediaTypes", None)
        if enabled_types is None:
            return ["text", "audio", "youtube"]
            
        return enabled_types

    def run_diagnostics(self):
        """Run diagnostics to check Pinecone connectivity and index status."""
        print("\nRunning diagnostics...")
        
        try:
            index_stats = self.index.describe_index_stats()
            print(f"Connected to Pinecone index: {self.index_name}")
            print(f"Total vector count: {index_stats.total_vector_count}")
            
            if index_stats.total_vector_count == 0:
                print("WARNING: The index is empty! No vectors have been uploaded.")
                return
            
            print("Checking for available libraries and media types...")
            results = self.index.query(
                vector=[0.1] * index_stats.dimension,
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
            
            test_embedding = self.get_embedding("This is a test query")
            if test_embedding and len(test_embedding) > 0:
                print(f"Embedding generation successful.")
            else:
                print("ERROR: Failed to generate embedding!")
                
        except Exception as e:
            print(f"ERROR in diagnostics: {str(e)}")
            
        print("Diagnostics complete.\n")

    def generate_all_markdown_files(self, questions_file: str):
        """Generate markdown files for all questions in the input file."""
        try:
            with open(questions_file, 'r') as f:
                questions = [line.strip() for line in f.readlines() if line.strip()]
            
            print(f"Found {len(questions)} questions in {questions_file}")
            
            for i, question in enumerate(questions, 1):
                print(f"\nProcessing question {i}/{len(questions)}: {question}")
                documents = self.retrieve_documents(question)
                if documents:
                    filename = self.create_markdown_file(question, documents)
                    print(f"Created markdown file: {filename}")
                else:
                    print(f"Skipping question due to no retrieved documents: {question}")
                    
            print("\nMarkdown generation complete!")
            print(f"Files are located in: {self.markdown_dir}")
            
        except FileNotFoundError:
            sys.exit(f"Error: Questions file '{questions_file}' not found.")
        except Exception as e:
            sys.exit(f"Error processing questions: {e}")

def main():
    parser = argparse.ArgumentParser(description="Generate markdown files for document relevance labeling")
    parser.add_argument("--site", type=str, required=True, help="Site ID to use for filtering documents and loading environment variables")
    parser.add_argument("--questions", type=str, required=True, help="Path to the file containing questions (one per line)")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode with additional diagnostics")
    args = parser.parse_args()
    
    generator = MarkdownGenerator(args)
    
    if args.debug:
        generator.run_diagnostics()
        
    generator.generate_all_markdown_files(args.questions)

if __name__ == "__main__":
    main() 