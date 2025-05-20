#!/usr/bin/env python3
"""
Evaluate the performance of the current RAG system against a new system with optimized chunking
and text-embedding-3-large, using human judgment datasets to measure retrieval quality.
"""

import json
import numpy as np
from sklearn.metrics import ndcg_score
from collections import defaultdict
import time
import pinecone
import openai
from difflib import SequenceMatcher
from nltk.tokenize import word_tokenize
import nltk
import os
from dotenv import load_dotenv

# Download NLTK data (for tokenization)
nltk.download('punkt', quiet=True)

# --- Configuration ---
EVAL_DATASET_PATH = "./reranking/evaluation_dataset_ananda.jsonl"  # Path to human judgment dataset
K = 5  # Evaluate top-K results
CURRENT_EMBEDDING_MODEL = "text-embedding-ada-002"  # Current embedding model
NEW_EMBEDDING_MODEL = "text-embedding-3-large"  # New embedding model
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "ananda-index")  # Pinecone index name
SIMILARITY_THRESHOLD = 0.85  # Threshold for matching chunks (for chunking differences)
CHUNK_SIZE_CURRENT = 256  # Example chunk size for current system (adjust as needed)
CHUNK_OVERLAP_CURRENT = 50  # Example overlap for current system
CHUNK_SIZE_NEW = 400  # Example chunk size for new system (adjust as needed)
CHUNK_OVERLAP_NEW = 100  # Example overlap for new system

# --- Helper Functions ---

def load_environment():
    """Load environment variables from .env.ananda."""
    env_file = ".env.ananda"
    if not os.path.exists(env_file):
        raise FileNotFoundError(f"Environment file {env_file} not found. Please create it with PINECONE_API_KEY and OPENAI_API_KEY.")
    load_dotenv(env_file)
    if not os.getenv("PINECONE_API_KEY") or not os.getenv("OPENAI_API_KEY"):
        raise ValueError("PINECONE_API_KEY or OPENAI_API_KEY missing in .env.ananda.")

def initialize_pinecone():
    """Initialize Pinecone client."""
    pinecone_api_key = os.getenv("PINECONE_API_KEY")
    pinecone.init(api_key=pinecone_api_key, environment="us-west1-gcp")  # Adjust environment as needed
    if PINECONE_INDEX_NAME not in pinecone.list_indexes():
        raise ValueError(f"Pinecone index {PINECONE_INDEX_NAME} does not exist.")
    return pinecone.Index(PINECONE_INDEX_NAME)

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

def get_embedding(text, model_name):
    """Generate embedding for text using OpenAI API."""
    try:
        response = openai.Embedding.create(input=text, model=model_name)
        return response['data'][0]['embedding']
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

def retrieve_documents(index, query, embedding_model, chunk_size, chunk_overlap, top_k):
    """Retrieve top-K documents for a query using the specified system."""
    start_time = time.time()
    
    # Generate query embedding
    query_embedding = get_embedding(query, embedding_model)
    if query_embedding is None:
        return [], 0.0

    # Query Pinecone
    try:
        results = index.query(query_embedding, top_k=top_k * 2, include_metadata=True)  # Fetch extra to account for mismatches
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

    # Load environment and initialize clients
    load_environment()
    openai.api_key = os.getenv("OPENAI_API_KEY")
    try:
        pinecone_index = initialize_pinecone()
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
                pinecone_index, query, CURRENT_EMBEDDING_MODEL, CHUNK_SIZE_CURRENT, 
                CHUNK_OVERLAP_CURRENT, K
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
                pinecone_index, query, NEW_EMBEDDING_MODEL, CHUNK_SIZE_NEW, 
                CHUNK_OVERLAP_NEW, K
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
        precision_diff = ((new_precision - current_precision) / current_precision * 100) if current_precision > 0 else float('inf') if new_precision > 0 else 0.0
        ndcg_diff = ((new_ndcg - current_ndcg) / current_ndcg * 100) if current_ndcg > 0 else float('inf') if new_ndcg > 0 else 0.0
        print(f"    Improvement - Precision: {precision_diff:.2f}%, NDCG: {ndcg_diff:.2f}%")

    # Calculate Average Metrics
    avg_current_precision = np.mean(current_metrics['precision'])
    avg_current_ndcg = np.mean(current_metrics['ndcg'])
    avg_new_precision = np.mean(new_metrics['precision'])
    avg_new_ndcg = np.mean(new_metrics['ndcg'])
    avg_current_time = np.mean(current_times) if current_times else 0.0
    avg_new_time = np.mean(new_times) if new_times else 0.0

    # Calculate Improvement
    precision_improvement = ((avg_new_precision - avg_current_precision) / avg_current_precision * 100) if avg_current_precision > 0 else float('inf')
    ndcg_improvement = ((avg_new_ndcg - avg_current_ndcg) / avg_current_ndcg * 100) if avg_current_ndcg > 0 else float('inf')

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
    print(f"  Speed Difference (New vs Current): {(avg_new_time / avg_current_time):.2f}x" if avg_current_time > 0 else 'N/A')

if __name__ == "__main__":
    main()