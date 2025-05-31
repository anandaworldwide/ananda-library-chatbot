# RAG System Performance Experiments - TODO List

This document outlines experiments to investigate and improve the performance of the Ananda Library Chatbot's
Retrieval-Augmented Generation (RAG) system, particularly focusing on the New System's poor performance with certain
chunking strategies.

## Background

Recent evaluations have shown significant performance differences between the Current System (using
`text-embedding-ada-002` with 1536 dimensions) and the New System (using `text-embedding-3-large` with 3072 dimensions).
While the Current System performs well with structured chunking strategies like paragraph-based chunking, the New System
struggles, especially with dynamic chunking.

## Objectives

- Understand why the New System performs poorly across various chunking strategies, especially dynamic chunking,
  compared to the Current System which excels with paragraph-based chunking.
- Identify optimal chunking strategies for the New System.
- Improve overall retrieval performance metrics (Precision@K and NDCG@K) for the New System.
- Ensure site-specific library filtering works correctly across all strategies.

## TODO List: Experiments to Conduct

### 1. Embedding Model Analysis

- [x] Compare embedding distributions between `text-embedding-ada-002` (Current) and `text-embedding-3-large` (New) to
      see if the higher dimensionality introduces noise or sparsity issues. **(Implemented -
      bin/analyze_embedding_distributions.py)**
- [x] **FAILED: Test dimensionality reduction techniques (e.g., PCA) on the New System embeddings to see if reducing to
      1536 dimensions improves retrieval.** **(Experiment 1.2 - FAILED: PCA reduction destroys semantic structure)**
  - **Result**: PCA reduction from 3072D to 1536D catastrophically degrades similarity distributions
  - **Evidence**: Similarity values collapsed from 0.8-0.9 range to 0.0-0.1 range, destroying semantic relationships
  - **Conclusion**: Compression approaches should be abandoned; focus on uncompressed system performance instead
- [ ] **NEW PRIORITY: Compare uncompressed Current System (1536D) vs New System (3072D) to evaluate raw performance**
      without dimensionality reduction. **(High Priority - No re-ingestion needed)**
- [ ] Experiment with a smaller model variant (e.g., `text-embedding-3-small`) to assess if model size impacts chunking
      strategy performance.

### 2. Chunking Strategy Optimization for New System

- [ ] Re-test dynamic chunking with smaller maximum chunk sizes to prevent overly large chunks that may dilute embedding
      quality in the New System.
- [ ] Adjust overlap percentages in dynamic and paragraph-based chunking to see if more context overlap helps the New
      System's embeddings. **(Prioritized - No re-ingestion needed, minor config tweak)**
- [ ] Implement hybrid chunking (combining sentence and paragraph boundaries) to balance context and granularity for the
      New System.

### 3. Similarity Threshold Tuning

- [ ] Conduct a sweep of similarity thresholds (e.g., 0.2 to 0.8 in 0.1 increments) to find the optimal value for the
      New System, as the current lenient threshold of 0.35 may still be too strict or too loose. **(Prioritized - No
      re-ingestion needed)**
- [ ] Analyze false positives and negatives in chunk matching to refine the threshold or matching algorithm.
      **(Prioritized - No re-ingestion needed)**

### 4. Content Analysis

- [ ] Sample and compare retrieved chunks from both systems for the same queries to identify qualitative differences
      (e.g., are New System chunks less relevant due to embedding issues?). **(Prioritized - No re-ingestion needed)**
- [ ] Investigate if specific content types (e.g., long paragraphs vs. short sentences) cause performance drops in the
      New System with dynamic chunking. **(Prioritized - No re-ingestion needed)**

### 5. Library Filtering Validation

- [ ] Verify that site-specific library filters are correctly applied in all retrieval queries, especially for the New
      System, to rule out data mismatch issues. **(Prioritized - No re-ingestion needed)**
- [ ] Test retrieval performance with and without library filters to quantify their impact on relevance.
      **(Prioritized - No re-ingestion needed)**

### 6. Performance Benchmarking

- [ ] Measure retrieval latency for each chunking strategy to see if the New System's higher dimensionality
      significantly slows down queries, potentially affecting dynamic chunking. **(Prioritized - No re-ingestion
      needed)**
- [ ] Benchmark memory usage during embedding generation and querying to identify bottlenecks in the New System.
      **(Prioritized - No re-ingestion needed)**

## Next Steps

- Prioritize experiments based on impact-to-effort ratio.
- Document findings for each experiment in a separate markdown file or section.
- Update the evaluation script with any necessary logging or configuration changes to support these experiments.

## Implementation Plan: First Priority Experiment

### Experiment 1.1: Compare Embedding Distributions (text-embedding-ada-002 vs text-embedding-3-large)

**Status**: Ready to implement **Effort**: Low (uses existing data) **Impact**: High (fundamental understanding)

**Implementation Steps**:

1. **Create embedding analysis script** (`bin/analyze_embedding_distributions.py`):

   - Sample 1000 random chunks from each system's Pinecone index
   - Extract embeddings and compute distribution statistics (mean, std, sparsity, norm)
   - Generate comparative visualizations (histograms, dimensionality plots)
   - Calculate similarity matrices between sample embeddings

2. **Required Environment Variables**:

   - Current System: Use evaluation script's existing config
   - New System: Set `PINECONE_INGEST_INDEX_NAME` and `OPENAI_INGEST_EMBEDDINGS_MODEL`

3. **Analysis Metrics**:

   - **Sparsity**: Percentage of near-zero values (< 0.01)
   - **Norm Distribution**: L2 norms across embedding dimensions
   - **Dimension Variance**: Which dimensions show highest variance
   - **Cosine Similarity**: Average pairwise similarity within each system

4. **Deliverables**:
   - Statistical comparison report (`docs/embedding-distribution-analysis.md`)
   - Visualization plots saved to `experiments/embedding-analysis/`
   - Actionable insights for PCA dimensionality reduction experiment

**Timeline**: 2-3 hours implementation + analysis

## Execution Instructions

### Running Experiment 1.1: Embedding Distribution Analysis

**Prerequisites**:

1. Install visualization dependencies:

   ```bash
   pip-compile requirements.in
   pip install -r requirements.txt
   ```

2. Ensure both systems have data:
   - Current System: Accessible via `PINECONE_INDEX_NAME`
   - New System: Accessible via `PINECONE_INGEST_INDEX_NAME`

**Execute**:

```bash
# From project root
python bin/analyze_embedding_distributions.py --site ananda --sample-size 1000
```

**Expected Output**:

- Report: `docs/embedding-distribution-analysis.md`
- Visualizations: `experiments/embedding-analysis/embedding_distribution_analysis.png`
- Raw data: `experiments/embedding-analysis/analysis_results.json`

**Runtime**: ~5-10 minutes (depending on sample size and index query performance)

## Notes

- Ensure all experiments are conducted with the same evaluation dataset (`evaluation_dataset_ananda.jsonl`) for
  consistency.
- Log qualitative observations alongside quantitative metrics to build a comprehensive understanding of system behavior.

### 1.2 Experiment Failure Documentation: PCA Dimensionality Reduction

**Experiment Date**: May 31, 2025  
**Status**: **FAILED - DO NOT RETRY**  
**Hypothesis**: Reducing New System embeddings from 3072D to 1536D using PCA would maintain semantic quality while
improving computational efficiency.

**Implementation**:

- Retrieved 2200 embeddings each from Current System (`corpus-2025-02-15`, 1536D) and New System
  (`2025-05-29--3-large-3072`, 3072D)
- Applied PCA reduction to New System embeddings targeting 1536D with 1.000 explained variance ratio
- Compared similarity distributions between native 1536D and PCA-reduced 1536D embeddings

**Results**:

- **Current System**: Similarity distribution centered at 0.8-0.9 cosine similarity (high semantic coherence)
- **New System (PCA-reduced)**: Similarity distribution collapsed to 0.0-0.1 range (semantic structure destroyed)
- **Impact**: PCA reduction makes documents appear nearly unrelated, severely degrading retrieval performance

**Key Findings**:

1. **PCA is destructive**: High-dimensional embeddings contain non-redundant semantic information
2. **Compression unnecessary**: 3072D vs 1536D computational cost difference is minimal compared to quality loss
3. **Wrong problem**: Instead of compressing embeddings, focus on comparing uncompressed system performance

**Recommendations**:

- **Abandon all compression approaches** for embedding dimensionality reduction
- **Prioritize uncompressed comparison**: Current System (1536D) vs New System (3072D)
- **Question fundamental assumptions**: Evaluate whether compression solves a real business problem
- **Focus on performance**: Compare actual retrieval quality and computational trade-offs
