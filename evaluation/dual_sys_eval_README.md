# Dual System Evaluation Pipeline

A comprehensive, unbiased evaluation framework for comparing two embedding systems using real production queries and
manual human judgment.

## Overview

This pipeline evaluates two different embedding systems (e.g., Ada-002 vs 3-Large) by:

1. Sampling diverse production queries from real user interactions
2. Retrieving top-K results from both systems for each query
3. Having humans manually judge document relevance
4. Computing statistical performance metrics and recommendations

## Pipeline Components

### Step 1: Query Sampling (`sample_production_queries.py`)

**Purpose**: Extract a representative sample of real user queries from production chat logs.

**Method**:

- Queries from Firestore `chatLogs` collection over 90-day window
- Semantic clustering using K-means to ensure diversity
- Stratified sampling across multiple dimensions:
  - Query length (short ≤8 words, medium 9-20 words, long >20 words)
  - Collections (master_swami, whole_library)
  - Time periods (recent ≤30 days, older)
  - Semantic clusters (8 clusters via embedding similarity)

**Usage**:

```bash
cd bin
python sample_production_queries.py --site ananda --output-file ananda_sampled_queries.json
```

**Output**: JSON file with ~25 diverse production queries with metadata.

**Key Features**:

- Avoids evaluation bias from synthetic/researcher-generated queries
- Ensures coverage of different query types and user intents
- Maintains statistical representativeness of real usage patterns

### Step 2: Dual System Retrieval (`dual_system_retrieval.py`)

**Purpose**: Retrieve top-5 most relevant documents from both embedding systems for each sampled query.

**Method**:

- Loads two different environment configurations (.env files)
- Connects to different Pinecone indexes for each system
- Performs identical semantic search queries on both systems
- Records retrieval scores, timing, and document metadata

**Usage**:

```bash
cd bin
python dual_system_retrieval.py \
  --queries-file ananda_sampled_queries.json \
  --env1 .env.ananda-ada002 \
  --env2 .env.ananda-current \
  --system1-name "Ada-002" \
  --system2-name "3-Large" \
  --output-file ada002_vs_3large_results.json
```

**Output**: JSON file containing top-5 retrieved documents from both systems for each query.

**Key Features**:

- Configurable system names (no hardcoded model references)
- Environment isolation ensures proper system comparison
- Captures retrieval timing and Pinecone similarity scores
- Handles different embedding dimensions and index configurations

### Step 3: Manual Evaluation (`manual_evaluation_interface.py`)

**Purpose**: Interactive terminal interface for human evaluation of document relevance.

**Method**:

- Presents documents to human evaluator in randomized, blinded fashion
- Uses 4-point relevance scale:
  - **4 (Highly Relevant)**: Directly answers the query
  - **3 (Relevant)**: Related and helpful
  - **2 (Somewhat Relevant)**: Tangentially related
  - **1 (Not Relevant)**: Unrelated to the query
- Session management with progress saving and resumption
- Navigation controls (back, skip, full text view)

**Usage**:

```bash
cd bin
python manual_evaluation_interface.py \
  --results-file ada002_vs_3large_results.json \
  --session-file evaluation_session.json
```

**Key Features**:

- **Unbiased evaluation**: Documents presented without system identification
- **Progress tracking**: Can pause/resume evaluation sessions
- **Quality controls**: Option to view full document text, skip problematic docs
- **Text wrapping**: Proper formatting for readability (100-character width)
- **Navigation**: Back/forward through documents, review previous evaluations

### Step 4: Results Analysis (TO BE IMPLEMENTED)

**Purpose**: Analyze human judgments to determine which system performs better.

**Planned Script**: `analyze_manual_evaluation_results.py`

**Analysis Methods**:

- **Precision@K**: Percentage of top-K retrieved documents that are relevant
  - Precision@1, @3, @5 for both systems
  - Strict thresholds (score ≥3) and lenient thresholds (score ≥2)
- **NDCG@K**: Normalized Discounted Cumulative Gain
  - Accounts for ranking position (higher-ranked relevant docs weighted more)
  - Industry-standard metric for ranking quality
- **Average Relevance Score**: Mean human judgment across all retrieved documents
- **Win Rate**: Percentage of queries where each system outperforms the other

**Statistical Validation**:

- Significance testing (paired t-test, Wilcoxon signed-rank)
- Confidence intervals for performance differences
- Effect size calculation (Cohen's d)
- Query-level analysis to identify systematic strengths/weaknesses

**Expected Output**:

```bash
System Performance Comparison
=============================
System A (Ada-002):     Precision@5: 0.74 ± 0.08
System B (3-Large):     Precision@5: 0.85 ± 0.06
Performance Difference: +0.11 (15% improvement)
Statistical Significance: p < 0.01 (highly significant)
Recommendation: Deploy System B to production
```

## Environment Setup

### System 1 Configuration (`.env.ananda-ada002`)

```bash
# Ada-002 system configuration
PINECONE_INDEX_NAME=corpus-2025-02-15
OPENAI_EMBEDDINGS_MODEL=text-embedding-ada-002
OPENAI_EMBEDDINGS_DIMENSIONS=1536
SITE=ananda
```

### System 2 Configuration (`.env.ananda-current`)

```bash
# 3-Large system configuration
PINECONE_INDEX_NAME=ananda-2025-06-19--3-large
OPENAI_EMBEDDINGS_MODEL=text-embedding-3-large
OPENAI_EMBEDDINGS_DIMENSIONS=3072
SITE=ananda
```

## Evaluation Methodology

### Why This Approach is Unbiased

1. **Real Production Queries**: Uses actual user queries, not synthetic test cases
2. **Diverse Sampling**: Semantic clustering ensures coverage of different query types
3. **Blinded Evaluation**: Human evaluators don't know which system retrieved each document
4. **Manual Judgment**: Human relevance assessment, not automated metrics
5. **Statistical Rigor**: Proper significance testing and confidence intervals

### Avoiding Common Evaluation Pitfalls

- **Dataset Bias**: No model-specific evaluation datasets
- **Cherry-Picking**: Systematic sampling prevents selection bias
- **Automation Bias**: Human judgment over automated similarity scores
- **Researcher Bias**: Production queries eliminate researcher query bias
- **Scale Bias**: Consistent 4-point scale with clear definitions

## Usage Example

Complete evaluation workflow:

```bash
# Step 1: Sample production queries
python sample_production_queries.py --site ananda --output-file queries.json

# Step 2: Retrieve from both systems
python dual_system_retrieval.py \
  --queries-file queries.json \
  --env1 .env.ananda-ada002 \
  --env2 .env.ananda-current \
  --system1-name "Ada-002" \
  --system2-name "3-Large" \
  --output-file results.json

# Step 3: Manual evaluation
python manual_evaluation_interface.py \
  --results-file results.json \
  --session-file session.json

# Step 4: Analyze results (TO BE IMPLEMENTED)
python analyze_manual_evaluation_results.py \
  --session-file session.json \
  --output-report final_report.md
```

## File Outputs

- **`ananda_sampled_queries.json`**: Sampled production queries with metadata
- **`ada002_vs_3large_results.json`**: Retrieved documents from both systems
- **`evaluation_session.json`**: Human evaluation session with progress and judgments
- **`final_report.md`**: Statistical analysis and deployment recommendation

## Best Practices

### For Query Sampling

- Use sufficient time window (90+ days) for diversity
- Ensure minimum query quality (filter very short/malformed queries)
- Balance sample across different user interaction patterns

### For Manual Evaluation

- Take breaks to avoid evaluation fatigue
- Be consistent with relevance criteria across all documents
- Use "skip" sparingly - only for truly problematic documents
- Review full document text when relevance is unclear

### For Statistical Analysis

- Require minimum sample size (20+ queries) for statistical power
- Use appropriate significance tests for paired comparisons
- Report both statistical and practical significance
- Consider query-level analysis to understand performance patterns

## Technical Notes

### Environment Isolation

Each system requires separate environment configuration to avoid:

- Index name conflicts
- Embedding model mismatches
- Dimension incompatibilities
- Metadata schema differences

### Performance Considerations

- Retrieval timing may vary based on index size and query complexity
- Manual evaluation is time-intensive (~3-5 minutes per query)
- Statistical analysis requires careful handling of missing/skipped evaluations

### Error Handling

All scripts include comprehensive error handling for:

- Network connectivity issues
- Pinecone API rate limits
- Malformed query/document data
- Session corruption and recovery
