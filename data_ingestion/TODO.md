# RAG System Optimization TODO List - MINIMAL

Post-re-ingestion optimizations for the Ananda Library Chatbot's RAG system.

## CURRENT SYSTEM STATUS ✅

### Production System Configuration ✅ STABLE

- **Embedding Model**: text-embedding-ada-002 (1536D) - proven optimal for spiritual content
- **Chunking Strategy**: spaCy-based chunking (new implementation)
- **Database**: Pinecone with site-specific namespaces
- **Performance**: 81.4% similarity, 100% precision@5 (pre-re-ingestion baseline)

---

## MINIMAL OPTIMIZATION PRIORITIES

### 1. Similarity Threshold Optimization ⭐ HIGH VALUE

**Why**: Query-time parameter tuning - no re-ingestion required

- [ ] **Test threshold range 0.2-0.8** in 0.1 increments using evaluation dataset
- [ ] **Document optimal threshold** in system configuration

### 2. Performance Monitoring ⭐ HIGH VALUE

**Why**: Enables ongoing optimization and regression detection

- [ ] **Run baseline evaluation** on new spaCy-chunked system
- [ ] **Document performance metrics** for comparison

---

## EVALUATION INFRASTRUCTURE ✅ READY

### Available Tools

- **`bin/evaluate_rag_system.py`** - Full evaluation suite
- **`evaluation_dataset_ananda.jsonl`** - Standardized test queries

### Success Criteria

- [ ] **Maintain or improve Precision@5** vs current 100%
- [ ] **Retrieval latency <1 second** average response time

---

## IMMEDIATE ACTIONS

1. **Complete re-ingestion** with spaCy chunking strategy
2. **Run baseline evaluation** to establish new performance metrics
3. **Test similarity thresholds** to optimize precision/recall balance

---

**REMOVED ITEMS** (require re-ingestion or complex infrastructure):

- Chunk size variants (400, 600, 800 tokens)
- Content-specific optimizations
- Query processing enhancements
- Monitoring dashboards
- All chunking boundary experiments
