"""
This script ingests PDF documents from a specified directory into a Pinecone vector database.
It processes the documents, splits them into chunks using spaCy's paragraph-based chunking, 
and stores them as embeddings for efficient retrieval.

The script supports resuming ingestion from checkpoints and handles graceful shutdowns.

Key features:
- Processes PDF files recursively from a given directory
- Chunks documents using spaCy's paragraph-based approach
- Creates and manages a Pinecone index for storing document embeddings
- Supports incremental updates with checkpointing
- Handles graceful shutdowns and resumption of processing
- Clears existing vectors for a given library name if requested
- Uses OpenAI embeddings for vector representation

Usage:
Run the script with the following options:
--file-path: Path to the directory containing PDF files
--site: Site name for loading environment variables
--library-name: Name of the library to process
--keep-data: Flag to keep existing data in the index (default: false)
"""

import argparse
import os
import sys
import signal
import json
import hashlib
import time
import logging
from typing import List, Dict, Any, Optional, Tuple, NamedTuple
import readline
from pathlib import Path
import asyncio
from concurrent.futures import ThreadPoolExecutor
import spacy
import requests

from dotenv import load_dotenv
from pinecone import Pinecone, Index
from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter, Document

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Custom PDF document loader
class PyPDFLoader:
    """Simple PDF document loader"""
    
    def __init__(self, file_path):
        self.file_path = file_path
    
    def load(self):
        """Load a PDF file into documents"""
        # Import PyPDF2 here to avoid top-level dependency
        import PyPDF2
        
        documents = []
        with open(self.file_path, 'rb') as f:
            pdf = PyPDF2.PdfReader(f)
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                metadata = {
                    'source': self.file_path,
                    'page': i,
                    'pdf': {
                        'info': pdf.metadata or {}
                    }
                }
                documents.append(Document(page_content=text, metadata=metadata))
        return documents

class DirectoryLoader:
    """Load documents from a directory"""
    
    def __init__(self, dir_path, glob, loader_cls=None, show_progress=False, silent_errors=False):
        self.dir_path = dir_path
        self.glob = glob
        self.loader_cls = loader_cls
        self.show_progress = show_progress
        self.silent_errors = silent_errors
    
    def load(self):
        """Load documents from a directory matching glob pattern"""
        import glob as glob_module
        
        documents = []
        paths = glob_module.glob(os.path.join(self.dir_path, self.glob))
        
        total = len(paths)
        if self.show_progress:
            from tqdm import tqdm
            paths = tqdm(paths, desc="Loading documents")
        
        for path in paths:
            try:
                if self.loader_cls:
                    loader = self.loader_cls(path)
                    docs = loader.load()
                    documents.extend(docs)
            except Exception as e:
                if not self.silent_errors:
                    print(f"Error loading {path}: {e}")
        
        return documents

# OpenAI API wrapper for embeddings
class OpenAIEmbeddings:
    """Class for generating embeddings using OpenAI API"""
    
    def __init__(self, model="text-embedding-ada-002", api_key=None):
        self.model = model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not provided and OPENAI_API_KEY environment variable not set")
            
    async def embed_query(self, text: str) -> List[float]:
        """Generate an embedding for a query string"""
        return await self.embed_texts([text])
        
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts"""
        # Prepare API request
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        payload = {
            "input": texts,
            "model": self.model
        }
        
        # Make the API call
        try:
            response = await asyncio.to_thread(
                requests.post,
                "https://api.openai.com/v1/embeddings",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            data = response.json()
            
            # Extract embeddings from response
            embeddings = [item["embedding"] for item in data["data"]]
            
            # If only one text was provided, return just that embedding
            if len(texts) == 1:
                return embeddings[0]
                
            return embeddings
            
        except Exception as e:
            print(f"Error generating embeddings: {e}")
            if hasattr(e, 'response') and e.response:
                print(f"Response content: {e.response.text}")
            raise

# Constants
CHECKPOINT_FILE = './media/pdf-docs/text_ingestion_checkpoint.json'

# Global variables
is_exiting = False
file_path = ""

def load_env(site: str) -> None:
    """Load environment variables for the given site."""
    env_file = f".env.{site}"
    if os.path.exists(env_file):
        load_dotenv(env_file)
    else:
        raise FileNotFoundError(f"Environment file {env_file} not found")

def get_pinecone_client() -> Pinecone:
    """Initialize and return the Pinecone client."""
    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        raise ValueError("PINECONE_API_KEY environment variable not set")
    
    return Pinecone(api_key=api_key)

def get_pinecone_ingest_index_name() -> str:
    """Get the Pinecone index name for ingestion."""
    index_name = os.environ.get("PINECONE_INGEST_INDEX")
    if not index_name:
        raise ValueError("PINECONE_INGEST_INDEX environment variable not set")
    
    return index_name

async def create_folder_signature(directory: str) -> str:
    """
    Creates a unique signature for the folder based on PDF file names and modification times.
    This helps detect changes in the folder contents between ingestion runs.
    """
    async def get_files_recursively(dir_path: str) -> List[str]:
        all_files = []
        for root, _, files in os.walk(dir_path):
            for file in files:
                all_files.append(os.path.join(root, file))
        return all_files

    all_files = await get_files_recursively(directory)
    pdf_files = [file for file in all_files if file.lower().endswith('.pdf')]
    print(f"Total PDF files found: {len(pdf_files)}")

    file_infos = []
    for file in pdf_files:
        stats = os.stat(file)
        file_infos.append(f"{file}:{stats.st_mtime}")

    signature_string = "|".join(sorted(file_infos))
    return hashlib.md5(signature_string.encode()).hexdigest()

async def save_checkpoint(processed_docs: int, folder_signature: str) -> None:
    """
    Saves the current ingestion progress and folder signature to a checkpoint file.
    This allows for resuming the ingestion process in case of interruptions.
    """
    with open(CHECKPOINT_FILE, 'w') as f:
        json.dump({'processed_docs': processed_docs, 'folder_signature': folder_signature}, f)

async def load_checkpoint() -> Optional[Dict[str, Any]]:
    """
    Loads the previous ingestion checkpoint, if it exists.
    This is used to resume processing from where it left off in a previous run.
    """
    try:
        with open(CHECKPOINT_FILE, 'r') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

async def clear_library_text_vectors(pinecone_index: Index, library_name: str) -> None:
    """
    Clears existing vectors for a specific library from the Pinecone index.
    This is used when re-ingesting data for a library to avoid duplicates.
    """
    print(f"Clearing existing {library_name} text vectors from Pinecone...")
    try:
        prefix = f"text||{library_name}||"
        pagination_token = None
        total_deleted = 0

        while True:
            response = await asyncio.to_thread(
                pinecone_index.list, 
                prefix=prefix, 
                pagination_token=pagination_token
            )

            if response.vectors and len(response.vectors) > 0:
                vector_ids = [vector.id for vector in response.vectors]

                await asyncio.to_thread(pinecone_index.delete, ids=vector_ids)
                total_deleted += len(vector_ids)

                print(f"Deleted {total_deleted} vectors so far...")

            if hasattr(response, 'pagination') and response.pagination and response.pagination.next:
                pagination_token = response.pagination.next
            else:
                break

        print(f"Cleared a total of {total_deleted} {library_name} text vectors.")
    except Exception as e:
        print(f"Error clearing {library_name} text vectors: {e}")
        sys.exit(1)

async def process_document(
    raw_doc: Document,
    pinecone_index: Index,
    embeddings: OpenAIEmbeddings,
    doc_index: int,
    library_name: str,
    text_splitter: SpacyTextSplitter
) -> None:
    """
    Processes a single document, splitting it into chunks using spaCy and adding it to the vector store.
    """
    # Extract metadata
    source_url = None
    title = "Untitled"
    
    # Access metadata
    if isinstance(raw_doc.metadata, dict):
        # Check if pdf info exists in metadata
        pdf_info = raw_doc.metadata.get('pdf', {}).get('info', {})
        if isinstance(pdf_info, dict):
            source_url = pdf_info.get('Subject')
            title = pdf_info.get('Title', 'Untitled')
        
        # Use source from metadata if available
        if raw_doc.metadata.get('source'):
            source_url = source_url or raw_doc.metadata.get('source')
    
    if not source_url:
        print(f"ERROR: No source URL found in metadata for document: {raw_doc}")
        print("Skipping it...")
        return

    # Set source URL and title for all pages
    raw_doc.metadata['source'] = source_url
    raw_doc.metadata['title'] = title

    # Only print debug information for the first page
    page_number = raw_doc.metadata.get('page', 0)
    if page_number == 0:
        print(f"Processing document with source URL: {source_url}")
        print(f"Document title: {title}")
        print(f"First 100 characters of document content: {raw_doc.page_content[:100]}")
        print(f"Updated metadata: {raw_doc.metadata}")

    # Split document into chunks
    docs = text_splitter.split_documents([raw_doc])

    # Filter out invalid documents
    valid_docs = [doc for doc in docs if isinstance(doc.page_content, str) and doc.page_content.strip()]

    # Process in smaller batches to avoid API limits
    batch_size = 10
    for i in range(0, len(valid_docs), batch_size):
        batch = valid_docs[i:i + batch_size]
        
        # For each chunk in the batch, process it
        tasks = []
        for j, doc in enumerate(batch):
            task = process_chunk(doc, pinecone_index, embeddings, i + j, library_name)
            tasks.append(task)
        
        # Wait for all tasks to complete
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Check for exceptions
        for result in results:
            if isinstance(result, Exception):
                print(f"Error processing chunk: {result}")
                raise result

async def process_chunk(
    doc: Document, 
    pinecone_index: Index,
    embeddings: OpenAIEmbeddings,
    chunk_index: int,
    library_name: str
) -> None:
    """Process and store a single document chunk."""
    title = doc.metadata.get('title', 'Untitled')
    sanitized_title = ''.join(c if c.isalnum() or c == '_' else '_' for c in title.replace(' ', '_'))[:40]
    
    content_hash = hashlib.md5(doc.page_content.encode()).hexdigest()[:8]
    id = f"text||{library_name}||{sanitized_title}||{content_hash}||chunk{chunk_index + 1}"
    
    try:
        # Minimize metadata
        minimal_metadata = {
            'id': id,
            'library': library_name,
            'type': 'text',
            'author': doc.metadata.get('author', 'Unknown'),
            'source': doc.metadata.get('source'),
            'title': doc.metadata.get('title'),
            'text': doc.page_content,
        }
        
        # Generate embedding directly
        vector = await embeddings.embed_query(doc.page_content)
        
        # Upsert to Pinecone
        await asyncio.to_thread(
            pinecone_index.upsert,
            vectors=[(id, vector, minimal_metadata)]
        )
    except Exception as e:
        print(f"Error processing chunk {chunk_index}: {e}")
        print(f"Chunk size: {len(json.dumps(doc.__dict__))} bytes")
        raise

async def create_pinecone_index_if_not_exists(pinecone: Pinecone, index_name: str) -> None:
    """Creates a Pinecone index if it doesn't already exist."""
    try:
        await asyncio.to_thread(pinecone.describe_index, index_name)
        print(f"Index {index_name} already exists.")
    except Exception as e:
        if hasattr(e, 'status') and e.status == 404:
            print(f"Index {index_name} does not exist. Creating...")
            try:
                dimension = os.environ.get("OPENAI_INGEST_EMBEDDINGS_DIMENSION")
                if not dimension:
                    raise ValueError("OPENAI_INGEST_EMBEDDINGS_DIMENSION environment variable not set")
                
                # Get cloud and region from environment variables - no defaults
                cloud = os.environ.get("PINECONE_CLOUD")
                if not cloud:
                    raise ValueError("PINECONE_CLOUD environment variable not set")
                
                region = os.environ.get("PINECONE_REGION")
                if not region:
                    raise ValueError("PINECONE_REGION environment variable not set")
                
                await asyncio.to_thread(
                    pinecone.create_index,
                    name=index_name,
                    dimension=int(dimension),
                    metric="cosine",
                    spec={
                        "serverless": {
                            "cloud": cloud,
                            "region": region
                        }
                    }
                )
                print(f"Index {index_name} created successfully.")
            except Exception as create_error:
                print(f"Error creating Pinecone index: {create_error}")
                sys.exit(1)
        else:
            print(f"Error checking Pinecone index: {e}")
            sys.exit(1)

async def cleanup() -> None:
    """Save progress before exiting."""
    print("\nSaving progress before exit...")
    try:
        current_folder_signature = await create_folder_signature(file_path)
        checkpoint = await load_checkpoint()
        current_progress = checkpoint['processed_docs'] if checkpoint else 0
        await save_checkpoint(current_progress, current_folder_signature)
        print("Progress saved successfully.")
    except Exception as e:
        print(f"Could not save progress: {e}")

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully."""
    global is_exiting
    if is_exiting:
        print("\nForced exit. Shutting down...")
        sys.exit(0)
    else:
        print("\nGraceful shutdown initiated. Press Ctrl+C again to exit.")
        is_exiting = True
        asyncio.create_task(cleanup())

async def run(keep_data: bool, library_name: str) -> None:
    """
    Main function to run the document ingestion process.
    This function orchestrates the entire ingestion workflow.
    """
    global file_path
    print(f"Processing documents from {file_path}")

    # Print count of PDF files in the directory
    try:
        pdf_files = [f for f in os.listdir(file_path) if f.lower().endswith('.pdf')]
        print(f"Found {len(pdf_files)} PDF files at top level directory.")
    except Exception as e:
        print(f"Unable to scan directory: {e}")
        sys.exit(1)

    # Initialize Pinecone
    try:
        pinecone = get_pinecone_client()
    except Exception as e:
        print(f"Failed to initialize Pinecone: {e}")
        return

    # Get or create index
    index_name = get_pinecone_ingest_index_name()
    await create_pinecone_index_if_not_exists(pinecone, index_name)

    # Get index
    try:
        pinecone_index = pinecone.Index(index_name)
    except Exception as e:
        print(f"Error getting pinecone index: {e}")
        sys.exit(1)

    # Clear existing data if needed
    if not keep_data:
        prefix = f"text||{library_name}||"
        vector_ids = []
        pagination_token = None

        print(f"Attempting to list vectors with prefix: \"{prefix}\"")

        try:
            while pagination_token is not None or len(vector_ids) == 0:
                if is_exiting:
                    print("Graceful shutdown: stopping vector count.")
                    break

                response = await asyncio.to_thread(
                    pinecone_index.list,
                    prefix=prefix,
                    pagination_token=pagination_token
                )

                if response.vectors:
                    page_vector_ids = [vector.id for vector in response.vectors if vector.id]
                    print(f"Found {len(page_vector_ids)} vectors on this page")
                    vector_ids.extend(page_vector_ids)
                else:
                    print("No vectors found in this response")

                if hasattr(response, 'pagination') and response.pagination:
                    pagination_token = response.pagination.next
                else:
                    break
        except Exception as e:
            print(f"Error listing records: {e}")
            sys.exit(1)

        if is_exiting:
            print("Vector counting interrupted. Exiting...")
            sys.exit(0)

        print(f"Total vectors found: {len(vector_ids)}")

        if len(vector_ids) == 0:
            print("The index contains 0 vectors. Proceeding with adding more.")
        else:
            response = input(f"The index contains {len(vector_ids)} vectors. Do you want to proceed with deleting and then adding more? (y/N) ")
            if response.lower() != 'y':
                print("Ingestion process aborted.")
                sys.exit(0)
            
            await clear_library_text_vectors(pinecone_index, library_name)
    else:
        print("Keeping existing data. Proceeding with adding more vectors.")

    # Initialize text splitter
    text_splitter = SpacyTextSplitter(
        chunk_size=600,
        chunk_overlap=120,  # 20% overlap
        separator="\n\n",
        pipeline="en_core_web_sm",
    )

    # Load documents
    raw_docs = []
    try:
        # Use DirectoryLoader to load PDFs recursively
        directory_loader = DirectoryLoader(
            file_path,
            glob="**/*.pdf",
            loader_cls=PyPDFLoader,
            show_progress=True,
            silent_errors=True
        )
        
        raw_docs = directory_loader.load()
        print(f"Number of items in raw_docs: {len(raw_docs)}")
    except Exception as e:
        print(f"Failed to load documents: {e}")
        return

    try:
        # Initialize OpenAI embeddings
        model_name = os.environ.get("OPENAI_INGEST_EMBEDDINGS_MODEL")
        if not model_name:
            raise ValueError("OPENAI_INGEST_EMBEDDINGS_MODEL environment variable not set")
        
        embeddings = OpenAIEmbeddings(model=model_name)
        
        # Get checkpoint information
        start_index = 0
        current_folder_signature = await create_folder_signature(file_path)
        
        if keep_data:
            checkpoint = await load_checkpoint()
            if checkpoint and checkpoint.get('folder_signature') == current_folder_signature:
                start_index = checkpoint.get('processed_docs', 0)
                print(f"Resuming from document {start_index + 1}")
            elif not checkpoint:
                print("No valid checkpoint found. Starting from the beginning.")
            else:
                print("Folder contents have changed. Starting from the beginning.")
        
        # Process documents
        for i in range(start_index, len(raw_docs)):
            if is_exiting:
                print("Graceful shutdown: saving progress...")
                await cleanup()
                print("Exiting...")
                sys.exit(0)
            
            try:
                await process_document(raw_docs[i], pinecone_index, embeddings, i, library_name, text_splitter)
                await save_checkpoint(i + 1, current_folder_signature)
                print(f"Processed document {i + 1} of {len(raw_docs)} ({((i + 1) / len(raw_docs) * 100):.1f}% done)")
            except Exception as e:
                error_message = str(e)
                if "InsufficientQuotaError" in error_message or "429" in error_message:
                    print("OpenAI API quota exceeded.")
                    sys.exit(1)
                else:
                    raise
        
        print(f"Ingestion complete. {len(raw_docs)} documents processed.")
    except Exception as e:
        print(f"Failed to ingest documents: {e}")
        sys.exit(1)

def main():
    """Parse arguments and run the script."""
    global file_path
    
    parser = argparse.ArgumentParser(description="Ingest PDF documents into Pinecone vector database")
    parser.add_argument("--file-path", required=True, help="Path to the directory containing PDF files")
    parser.add_argument("--site", required=True, help="Site name for loading environment variables")
    parser.add_argument("--library-name", required=True, help="Name of the library to process")
    parser.add_argument("--keep-data", "-k", action="store_true", help="Flag to keep existing data in the index")
    
    args = parser.parse_args()
    
    # Set up signal handler for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    
    # Load environment variables
    load_env(args.site)
    
    # Validate file path
    file_path = os.path.abspath(args.file_path)
    if not os.path.isdir(file_path):
        print(f"Error: {file_path} is not a valid directory")
        sys.exit(1)
    
    # Run the ingestion process
    asyncio.run(run(args.keep_data, args.library_name))

if __name__ == "__main__":
    main() 