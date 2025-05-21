#!/usr/bin/env python3
"""
Evaluates and compares two RAG (Retrieval-Augmented Generation) systems for retrieval performance.

Key Operations:
- Loads configurations (API keys, Pinecone index names, OpenAI model IDs) via a `--site` argument.
- Connects to two Pinecone indexes (current vs. new system) and an OpenAI client.
- Processes a human-judged dataset (`evaluation_dataset_ananda.jsonl`) containing queries,
  documents, and relevance scores.
- For each query:
    - Retrieves top-K documents from both Pinecone indexes using their respective embedding
      models and chunking strategies.
    - Matches retrieved chunks to judged documents using `difflib.SequenceMatcher` to assign
      relevance scores. A similarity ratio above `SIMILARITY_THRESHOLD` (0.85) denotes a match.
    - Calculates Precision@K and NDCG@K for both systems.
- Aggregates results: reports average Precision@K, NDCG@K, retrieval times, and percentage
  improvements of the new system over the current one.

Dependencies:
- Populated Pinecone indexes for both systems are required. Empty indexes will result in errors
  or zeroed (meaningless) metrics.
- Correct Pinecone index dimensions (e.g., 1536 for `text-embedding-ada-002`, 3072 for
  `text-embedding-3-large`) are crucial; mismatches cause query failures.

Future improvements: 
- Add a command line interface for different embedding models. 
"""

import json
import numpy as np
from sklearn.metrics import ndcg_score
from collections import defaultdict
import time
from pinecone import Pinecone, NotFoundException
import openai
from openai import OpenAI
from difflib import SequenceMatcher
from nltk.tokenize import word_tokenize
import nltk
import os
import sys
from dotenv import load_dotenv
import argparse

# Add project root to Python path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

from pyutil.env_utils import load_env

# Download NLTK data (for tokenization)
nltk.download('punkt', quiet=True)

# --- Configuration ---
EVAL_DATASET_PATH = "./reranking/evaluation_dataset_ananda.jsonl"  # Path to human judgment dataset
K = 5  # Evaluate top-K results
# CURRENT_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "corpus-2025-02-15") # Moved to main
# NEW_INDEX_NAME = os.getenv("PINECONE_INGEST_INDEX_NAME", "test-2025-05-17--3-large-3072") # Moved to main
# CURRENT_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-ada-002") # Moved to main
# NEW_EMBEDDING_MODEL = os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL", "text-embedding-3-large") # Moved to main
SIMILARITY_THRESHOLD = 0.85  # Threshold for matching chunks (for chunking differences)
CHUNK_SIZE_CURRENT = 256  # Chunk size for current system
CHUNK_OVERLAP_CURRENT = 50  # Overlap for current system
CHUNK_SIZE_NEW = 400  # Chunk size for new system
CHUNK_OVERLAP_NEW = 100  # Overlap for new system

# --- Helper Functions ---

def load_environment(site: str):
    """Load environment variables based on the site."""
    try:
        load_env(site)
        print(f"Loaded environment from: {os.path.join(project_root, f'.env.{site}')}")
    except Exception as e:
        print(f"ERROR loading environment: {e}")
        sys.exit(1)
    
    # Check required environment variables
    required_vars = [
        "PINECONE_API_KEY", "PINECONE_INDEX_NAME", "OPENAI_API_KEY",
        "OPENAI_EMBEDDINGS_MODEL", "PINECONE_INGEST_INDEX_NAME",
        "OPENAI_INGEST_EMBEDDINGS_MODEL"
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(f"ERROR: Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)

def get_pinecone_client():
    """Initialize and return a Pinecone client."""
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        raise ValueError("PINECONE_API_KEY not found in environment variables.")
    return Pinecone(api_key=api_key)

def get_pinecone_index(pinecone_client, index_name):
    """Get the Pinecone index object for the specified index name."""
    try:
        index = pinecone_client.Index(index_name)
        stats = index.describe_index_stats()
        print(f"Successfully connected to index '{index_name}'. Stats: {stats['total_vector_count']} vectors.")
        dimension = stats.get('dimension', 'Unknown')
        print(f"Index '{index_name}' dimension: {dimension}")
        return index
    except NotFoundException:
        print(f"ERROR: Pinecone index '{index_name}' not found.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR connecting to Pinecone index '{index_name}': {e}")
        sys.exit(1)

def load_evaluation_data(filepath):
    """Loads evaluation data grouped by query."""
    data_by_query = defaultdict(list)
    try:
        with open(filepath, 'r') as f:
            for line in f:
                item = json.loads(line)
                item['relevance'] = float(item.get('relevance', 0.0))
                data_by_query[item['query']].append(item)
        print(f"Loaded evaluation data for {len(data_by_query)} queries from {filepath}")
        if data_by_query:
            first_query = list(data_by_query.keys())[0]
            print(f"Sample documents for query '{first_query}': {len(data_by_query[first_query])}")
        return data_by_query
    except FileNotFoundError:
        print(f"ERROR: Evaluation dataset not found at {filepath}.")
        return None
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to decode JSON in {filepath}. Error: {e}")
        return None

def get_embedding(text, model_name, openai_client):
    """Generate embedding for text using OpenAI API."""
    try:
        response = openai_client.embeddings.create(input=text, model=model_name)
        return response.data[0].embedding
    except Exception as e:
        print(f"ERROR generating embedding with {model_name}: {e}")
        return None

def chunk_text(text, chunk_size, chunk_overlap):
    """Chunk text into segments with specified size and overlap."""
    words = word_tokenize(text)
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)
        start += chunk_size - chunk_overlap
    return chunks

def match_chunks(retrieved_chunk, judged_chunks):
    """Match a retrieved chunk to judged chunks by content similarity."""
    best_match = None
    best_score = 0.0
    for judged in judged_chunks:
        similarity = SequenceMatcher(None, retrieved_chunk, judged['document']).ratio()
        if similarity > best_score and similarity >= SIMILARITY_THRESHOLD:
            best_score = similarity
            best_match = judged
    return best_match

def retrieve_documents(index, query, embedding_model, chunk_size, chunk_overlap, top_k, openai_client):
    """Retrieve top-K documents for a query using the specified system."""
    start_time = time.time()
    
    # Generate query embedding
    query_embedding = get_embedding(query, embedding_model, openai_client)
    if query_embedding is None:
        return [], 0.0

    # Query Pinecone
    try:
        results = index.query(vector=query_embedding, top_k=top_k * 2, include_metadata=True)
    except Exception as e:
        print(f"ERROR querying Pinecone: {e}")
        return [], 0.0

    # Process results
    documents = []
    for match in results['matches']:
        text = match['metadata'].get('text', '')
        # Re-chunk to simulate system-specific chunking
        chunks = chunk_text(text, chunk_size, chunk_overlap)
        for chunk in chunks[:2]:  # Limit to avoid overfetching
            doc = {
                'document': chunk,
                'metadata': match['metadata'],
                'score': float(match['score'])  # Cosine similarity from Pinecone
            }
            documents.append(doc)
            if len(documents) >= top_k:
                break
        if len(documents) >= top_k:
            break

    inference_time = time.time() - start_time
    return documents[:top_k], inference_time

def calculate_precision_at_k(documents, k):
    """Calculate Precision@K (fraction of top-K docs with relevance >= 1)."""
    top_k_docs = documents[:k]
    relevant_count = sum(1 for doc in top_k_docs if doc['relevance'] >= 1.0)
    return relevant_count / k if k > 0 else 0.0

def calculate_ndcg_at_k(documents, k):
    """Calculate NDCG@K."""
    if not documents:
        return 0.0
    true_relevance = np.asarray([[doc['relevance'] for doc in documents]])
    predicted_scores = np.asarray([[doc['score'] for doc in documents]])
    k_val = min(k, len(documents))
    if true_relevance.shape[1] == 0 or predicted_scores.shape[1] == 0:
        return 0.0
    if np.sum(true_relevance) == 0:
        return 0.0
    return ndcg_score(true_relevance, predicted_scores, k=k_val)

# --- Main Evaluation Logic ---
def main():
    print("Starting RAG system evaluation...")

    # --- Argument Parsing ---
    parser = argparse.ArgumentParser(description='Evaluate RAG system performance.')
    parser.add_argument('--site', required=True, help='Site ID to load environment variables (e.g., ananda, crystal)')
    args = parser.parse_args()

    # Load environment and initialize clients
    load_environment(args.site)
    
    # Initialize configuration variables after environment is loaded
    CURRENT_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "corpus-2025-02-15")
    NEW_INDEX_NAME = os.getenv("PINECONE_INGEST_INDEX_NAME", "test-2025-05-17--3-large-3072")
    CURRENT_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-ada-002")
    NEW_EMBEDDING_MODEL = os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL", "text-embedding-3-large")
    
    openai.api_key = os.getenv("OPENAI_API_KEY")
    openai_client = OpenAI()
    
    try:
        # Initialize Pinecone
        pinecone_client = get_pinecone_client()
        current_index = get_pinecone_index(pinecone_client, CURRENT_INDEX_NAME)
        new_index = get_pinecone_index(pinecone_client, NEW_INDEX_NAME)

        # Check dimensions after indexes are loaded and config vars are set
        current_stats = current_index.describe_index_stats()
        current_dimension = current_stats.get('dimension', 'Unknown')
        if str(current_dimension) != "1536":
            print(f"WARNING: Expected dimension 1536 for {CURRENT_INDEX_NAME}, got {current_dimension}")
        
        new_stats = new_index.describe_index_stats()
        new_dimension = new_stats.get('dimension', 'Unknown')
        if str(new_dimension) != "3072":
            print(f"WARNING: Expected dimension 3072 for {NEW_INDEX_NAME}, got {new_dimension}")

    except Exception as e:
        print(f"ERROR initializing Pinecone: {e}")
        return

    # Load evaluation data
    eval_data = load_evaluation_data(EVAL_DATASET_PATH)
    if not eval_data:
        return

    current_metrics = defaultdict(list)
    new_metrics = defaultdict(list)
    current_times = []
    new_times = []

    query_count = len(eval_data)
    processed_queries = 0

    print(f"\nProcessing {query_count} queries...")
    for query, judged_docs in eval_data.items():
        processed_queries += 1
        print(f"  Query {processed_queries}/{query_count}: '{query[:50]}...'")

        # Evaluate Current System
        try:
            current_docs, time_current = retrieve_documents(
                current_index, query, CURRENT_EMBEDDING_MODEL, CHUNK_SIZE_CURRENT, 
                CHUNK_OVERLAP_CURRENT, K, openai_client
            )
            for doc in current_docs:
                matched = match_chunks(doc['document'], judged_docs)
                doc['relevance'] = matched['relevance'] if matched else 0.0
            current_precision = calculate_precision_at_k(current_docs, K)
            current_ndcg = calculate_ndcg_at_k(current_docs, K)
            current_metrics['precision'].append(current_precision)
            current_metrics['ndcg'].append(current_ndcg)
            current_times.append(time_current)
        except Exception as e:
            print(f"    ERROR processing query with current system: {e}")
            current_metrics['precision'].append(0.0)
            current_metrics['ndcg'].append(0.0)
            current_times.append(0.0)

        # Evaluate New System
        try:
            new_docs, time_new = retrieve_documents(
                new_index, query, NEW_EMBEDDING_MODEL, CHUNK_SIZE_NEW, 
                CHUNK_OVERLAP_NEW, K, openai_client
            )
            for doc in new_docs:
                matched = match_chunks(doc['document'], judged_docs)
                doc['relevance'] = matched['relevance'] if matched else 0.0
            new_precision = calculate_precision_at_k(new_docs, K)
            new_ndcg = calculate_ndcg_at_k(new_docs, K)
            new_metrics['precision'].append(new_precision)
            new_metrics['ndcg'].append(new_ndcg)
            new_times.append(time_new)
        except Exception as e:
            print(f"    ERROR processing query with new system: {e}")
            new_metrics['precision'].append(0.0)
            new_metrics['ndcg'].append(0.0)
            new_times.append(0.0)

        # Output per-query metrics
        print(f"    Current System - Precision@{K}: {current_precision:.4f}, NDCG@{K}: {current_ndcg:.4f}")
        print(f"    New System - Precision@{K}: {new_precision:.4f}, NDCG@{K}: {new_ndcg:.4f}")
        precision_diff = ((new_precision - current_precision) / current_precision * 100) if current_precision > 1e-9 else float('inf') if new_precision > 1e-9 else 0.0
        ndcg_diff = ((new_ndcg - current_ndcg) / current_ndcg * 100) if current_ndcg > 1e-9 else float('inf') if new_ndcg > 1e-9 else 0.0
        print(f"    Improvement - Precision: {precision_diff:.2f}%, NDCG: {ndcg_diff:.2f}%")

    # Calculate Average Metrics
    avg_current_precision = np.mean(current_metrics['precision']) if current_metrics['precision'] else 0.0
    avg_current_ndcg = np.mean(current_metrics['ndcg']) if current_metrics['ndcg'] else 0.0
    avg_new_precision = np.mean(new_metrics['precision']) if new_metrics['precision'] else 0.0
    avg_new_ndcg = np.mean(new_metrics['ndcg']) if new_metrics['ndcg'] else 0.0
    avg_current_time = np.mean(current_times) if current_times else 0.0
    avg_new_time = np.mean(new_times) if new_times else 0.0

    # Calculate Improvement
    precision_improvement = ((avg_new_precision - avg_current_precision) / avg_current_precision * 100) if avg_current_precision > 1e-9 else float('inf') if avg_new_precision > 1e-9 else 0.0
    ndcg_improvement = ((avg_new_ndcg - avg_current_ndcg) / avg_current_ndcg * 100) if avg_current_ndcg > 1e-9 else float('inf') if avg_new_ndcg > 1e-9 else 0.0

    # Output Final Results
    print("\n--- Evaluation Results ---")
    print(f"Evaluated on {query_count} queries with K={K}")
    print("\nCurrent System (text-embedding-ada-002, current chunking):")
    print(f"  Avg Precision@{K}: {avg_current_precision:.4f}")
    print(f"  Avg NDCG@{K}:      {avg_current_ndcg:.4f}")
    print(f"  Avg Retrieval Time: {avg_current_time:.4f} seconds")
    print("\nNew System (text-embedding-3-large, optimized chunking):")
    print(f"  Avg Precision@{K}: {avg_new_precision:.4f}")
    print(f"  Avg NDCG@{K}:      {avg_new_ndcg:.4f}")
    print(f"  Avg Retrieval Time: {avg_new_time:.4f} seconds")
    print("\nComparison:")
    print(f"  Precision@{K} Improvement: {precision_improvement:.2f}%")
    print(f"  NDCG@{K} Improvement:      {ndcg_improvement:.2f}%")
    print(f"  Speed Difference (New vs Current): {(avg_new_time / avg_current_time):.2f}x" if avg_current_time > 1e-9 else 'N/A')

if __name__ == "__main__":
    main()