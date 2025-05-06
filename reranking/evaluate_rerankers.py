#!/usr/bin/env python3
"""
Evaluate the performance of the fine-tuned ONNX model against the pretrained model.
"""

import json
import numpy as np
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from optimum.onnxruntime import ORTModelForSequenceClassification
from sklearn.metrics import ndcg_score
import torch
from collections import defaultdict
import time

# --- Configuration ---
PRETRAINED_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-4-v2"
ONNX_MODEL_PATH = "./reranking/onnx_quantized_model" # Adjusted path relative to root
EVAL_DATASET_PATH = "./reranking/evaluation_dataset_ananda.jsonl" # Adjusted path relative to root
K = 5 # Evaluate top-K results

# --- Helper Functions ---

def load_evaluation_data(filepath):
    """Loads evaluation data grouped by query."""
    data_by_query = defaultdict(list)
    try:
        with open(filepath, 'r') as f:
            for line in f:
                item = json.loads(line)
                # Ensure relevance is treated as float/numeric for scoring
                item['relevance'] = float(item.get('relevance', 0.0))
                data_by_query[item['query']].append(item)
        print(f"Loaded evaluation data for {len(data_by_query)} queries from {filepath}")
        # Sanity check one query's data
        if data_by_query:
            first_query = list(data_by_query.keys())[0]
            print(f"Sample documents for query '{first_query}': {len(data_by_query[first_query])}")
        return data_by_query
    except FileNotFoundError:
        print(f"ERROR: Evaluation dataset not found at {filepath}. Please ensure it exists.")
        return None
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to decode JSON in {filepath}. Error: {e}")
        return None
    except Exception as e:
        print(f"ERROR: An unexpected error occurred while loading data: {e}")
        return None


def rerank_documents(model, tokenizer, query, documents, is_onnx=False):
    """Reranks documents for a query using the given model."""
    pairs = [(query, doc['document']) for doc in documents]
    # Tokenizer always returns PyTorch tensors first
    inputs = tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors="pt")

    start_time = time.time()

    if not is_onnx:
        # --- PyTorch Path ---
        # Determine device
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device) # Ensure model is on the correct device
        model_inputs = {k: v.to(device) for k, v in inputs.items()} # Move tensors to device

        with torch.no_grad():
            outputs = model(**model_inputs)
            scores = outputs.logits.squeeze().cpu().numpy() # Get scores as numpy array

    else:
        # --- ONNX Path ---
        # Convert tensors to numpy for ONNX Runtime
        model_inputs = {k: v.numpy() for k, v in inputs.items()}
        outputs = model(**model_inputs)

        # Extract scores from ONNX output
        if isinstance(outputs, dict) and 'logits' in outputs:
             scores = outputs['logits']
        elif isinstance(outputs, (tuple, list)) and len(outputs) > 0:
             scores = outputs[0]
        else:
             raise TypeError(f"Unexpected output type from ONNX model or logits not found: {type(outputs)}")

        if not isinstance(scores, np.ndarray):
             raise TypeError(f"Expected numpy array from ONNX model logits, got {type(scores)}")
        if scores.ndim > 1:
             scores = np.squeeze(scores)

    end_time = time.time()

    # Combine documents with their scores (scores are now guaranteed numpy arrays)
    scored_docs = []
    # Handle scalar scores after potential squeeze
    if scores.ndim == 0:
        scores = [scores.item()] # Make it iterable if it became a scalar numpy value
    elif scores.shape == (): # Handle zero-dim array explicitly if squeeze results in it
        scores = [scores.item()]

    if len(scores) != len(documents):
         print(f"Warning: Number of scores ({len(scores)}) does not match number of documents ({len(documents)}) for query '{query[:30]}...'. Skipping score assignment.")
         # Depending on desired behavior, might return empty list or raise error
         # Returning empty list and 0 time for now to avoid crashing the whole evaluation
         return [], 0
    else:
        for doc_data, score in zip(documents, scores):
            new_doc_data = doc_data.copy()
            # Convert score to standard Python float, handle potential NaNs
            new_doc_data['score'] = float(np.nan_to_num(score))
            scored_docs.append(new_doc_data)

    # Sort documents by score in descending order
    ranked_docs = sorted(scored_docs, key=lambda x: x['score'], reverse=True)
    inference_time = end_time - start_time
    return ranked_docs, inference_time

def calculate_precision_at_k(ranked_docs, k):
    """Calculates Precision@K (fraction of top-K docs with relevance >= 1)."""
    top_k_docs = ranked_docs[:k]
    relevant_count = sum(1 for doc in top_k_docs if doc['relevance'] >= 1.0)
    return relevant_count / k if k > 0 else 0.0

def calculate_ndcg_at_k(ranked_docs, k):
    """Calculates NDCG@K."""
    if not ranked_docs:
        return 0.0
    true_relevance = np.asarray([[doc['relevance'] for doc in ranked_docs]])
    predicted_scores = np.asarray([[doc['score'] for doc in ranked_docs]])

    # Ensure k does not exceed the number of documents
    k_val = min(k, len(ranked_docs))

    if true_relevance.shape[1] == 0 or predicted_scores.shape[1] == 0:
        return 0.0 # Handle empty arrays

    # Check if all true relevance scores are zero
    if np.sum(true_relevance) == 0:
        return 0.0 # NDCG is 0 if there are no relevant documents

    return ndcg_score(true_relevance, predicted_scores, k=k_val)

# --- Main Evaluation Logic ---
def main():
    print("Starting evaluation...")
    eval_data = load_evaluation_data(EVAL_DATASET_PATH)
    if not eval_data:
        return

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load Pretrained Model
    print(f"Loading pretrained tokenizer and model: {PRETRAINED_MODEL_NAME}...")
    try:
        pretrained_tokenizer = AutoTokenizer.from_pretrained(PRETRAINED_MODEL_NAME)
        pretrained_model = AutoModelForSequenceClassification.from_pretrained(PRETRAINED_MODEL_NAME)
        pretrained_model.to(device)
        pretrained_model.eval()
        print("Pretrained model loaded.")
    except Exception as e:
        print(f"ERROR: Failed to load pretrained model '{PRETRAINED_MODEL_NAME}'. Error: {e}")
        return

    # Load Fine-tuned ONNX Model
    print(f"Loading fine-tuned ONNX tokenizer and model from: {ONNX_MODEL_PATH}...")
    try:
        # Tokenizer should be loaded from the original source, as fine-tuning doesn't change it
        onnx_tokenizer = AutoTokenizer.from_pretrained(PRETRAINED_MODEL_NAME)
        onnx_model = ORTModelForSequenceClassification.from_pretrained(ONNX_MODEL_PATH)
        # Note: ONNX model device placement is handled by ORT provider settings, typically CPU by default
        print("Fine-tuned ONNX model loaded.")
    except Exception as e:
        print(f"ERROR: Failed to load ONNX model from '{ONNX_MODEL_PATH}'. Error: {e}")
        return

    pretrained_metrics = defaultdict(list)
    onnx_metrics = defaultdict(list)
    onnx_times = []
    pretrained_times = []

    query_count = len(eval_data)
    processed_queries = 0

    print(f"\nProcessing {query_count} queries...")
    for query, documents in eval_data.items():
        processed_queries += 1
        print(f"  Query {processed_queries}/{query_count}: '{query[:50]}...'")

        # Evaluate Pretrained
        pretrained_precision = 0.0
        pretrained_ndcg = 0.0
        try:
            ranked_pretrained, time_pretrained = rerank_documents(pretrained_model, pretrained_tokenizer, query, documents, is_onnx=False)
            pretrained_precision = calculate_precision_at_k(ranked_pretrained, K)
            pretrained_ndcg = calculate_ndcg_at_k(ranked_pretrained, K)
            pretrained_metrics['precision'].append(pretrained_precision)
            pretrained_metrics['ndcg'].append(pretrained_ndcg)
            pretrained_times.append(time_pretrained)
        except Exception as e:
            print(f"    ERROR processing query with pretrained model: {e}")
            pretrained_metrics['precision'].append(0.0)
            pretrained_metrics['ndcg'].append(0.0)

        # Evaluate Fine-tuned ONNX
        onnx_precision = 0.0
        onnx_ndcg = 0.0
        try:
            ranked_onnx, time_onnx = rerank_documents(onnx_model, onnx_tokenizer, query, documents, is_onnx=True)
            onnx_precision = calculate_precision_at_k(ranked_onnx, K)
            onnx_ndcg = calculate_ndcg_at_k(ranked_onnx, K)
            onnx_metrics['precision'].append(onnx_precision)
            onnx_metrics['ndcg'].append(onnx_ndcg)
            onnx_times.append(time_onnx)
        except Exception as e:
            print(f"    ERROR processing query with ONNX model: {e}")
            onnx_metrics['precision'].append(0.0)
            onnx_metrics['ndcg'].append(0.0)

        # Output per-query metrics
        print(f"    Pretrained - Precision@{K}: {pretrained_precision:.4f}, NDCG@{K}: {pretrained_ndcg:.4f}")
        print(f"    ONNX Fine-tuned - Precision@{K}: {onnx_precision:.4f}, NDCG@{K}: {onnx_ndcg:.4f}")
        precision_diff = ((onnx_precision - pretrained_precision) / pretrained_precision * 100) if pretrained_precision > 0 else float('inf') if onnx_precision > 0 else 0.0
        ndcg_diff = ((onnx_ndcg - pretrained_ndcg) / pretrained_ndcg * 100) if pretrained_ndcg > 0 else float('inf') if onnx_ndcg > 0 else 0.0
        print(f"    Improvement - Precision: {precision_diff:.2f}%, NDCG: {ndcg_diff:.2f}%")

    # Calculate Average Metrics
    avg_pretrained_precision = np.mean(pretrained_metrics['precision'])
    avg_pretrained_ndcg = np.mean(pretrained_metrics['ndcg'])
    avg_onnx_precision = np.mean(onnx_metrics['precision'])
    avg_onnx_ndcg = np.mean(onnx_metrics['ndcg'])
    avg_pretrained_time = np.mean(pretrained_times) if pretrained_times else 0
    avg_onnx_time = np.mean(onnx_times) if onnx_times else 0

    # Calculate Improvement
    ndcg_improvement = ((avg_onnx_ndcg - avg_pretrained_ndcg) / avg_pretrained_ndcg * 100) if avg_pretrained_ndcg != 0 else float('inf')
    precision_improvement = ((avg_onnx_precision - avg_pretrained_precision) / avg_pretrained_precision * 100) if avg_pretrained_precision != 0 else float('inf')

    print("\n--- Evaluation Results ---")
    print(f"Evaluated on {query_count} queries with K={K}")
    print("\nPretrained Model:")
    print(f"  Avg Precision@{K}: {avg_pretrained_precision:.4f}")
    print(f"  Avg NDCG@{K}:      {avg_pretrained_ndcg:.4f}")
    print(f"  Avg Inference Time: {avg_pretrained_time:.4f} seconds")

    print("\nFine-tuned ONNX Model:")
    print(f"  Avg Precision@{K}: {avg_onnx_precision:.4f}")
    print(f"  Avg NDCG@{K}:      {avg_onnx_ndcg:.4f}")
    print(f"  Avg Inference Time: {avg_onnx_time:.4f} seconds")

    print("\nComparison:")
    print(f"  Precision@{K} Improvement: {precision_improvement:.2f}%")
    print(f"  NDCG@{K} Improvement:      {ndcg_improvement:.2f}%")
    print(f"  Speed Difference (ONNX vs Pretrained): {(avg_onnx_time / avg_pretrained_time) if avg_pretrained_time > 0 else 'N/A'}x")

if __name__ == "__main__":
    main() 