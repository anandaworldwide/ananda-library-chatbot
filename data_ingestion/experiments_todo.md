# RAG System Performance Experiments - TODO List (REFRESHED)

This document outlines experiments to investigate and improve the performance of the Ananda Library Chatbot's
Retrieval-Augmented Generation (RAG) system, particularly focusing on comparing the New System's performance with
text-embedding-3-large (3072D) embeddings.

## CURRENT SITUATION ✅ UPDATED

### Fixed Implementation Status ✅ COMPLETED

- **SpacyTextSplitter**: Fixed to use proper paragraph-based chunking (600 tokens, 120 overlap)
- **Punctuation preservation**: NLTK tokenization implemented to prevent spacing corruption
- **All ingestion scripts**: Updated to use consistent fixed paragraph-based approach

### Database Status 🔄 IN PROGRESS

- **Current System**: Production database with text-embedding-ada-002 (1536D) + paragraph chunking ✅ WORKING
- **New System**: Partially created database with text-embedding-3-large (3072D) + **dynamic chunking** ⚠️ NEEDS
  RECREATION
- **Action Required**: Complete re-ingestion with fixed paragraph-based chunking

---

## IMMEDIATE PRIORITY: Diagnose Why 3-Large Is Failing

**Status**: ⚠️ **URGENT - Before Re-ingestion**

Before re-ingesting everything, let's diagnose **why** text-embedding-3-large is showing 84% performance degradation.
This will determine if re-ingestion can actually fix the issue or if the embedding model is fundamentally unsuitable.

### 1. Content Quality Diagnostic ⏰ 1-2 hours

**Value**: Identify if retrieved chunks are semantically broken **Impact**: High - determines if model is salvageable

- [ ] **Run identical queries** on both Current System and New System databases
- [ ] **Sample 20-30 retrieved chunks** from each system for same queries
- [ ] **Manual relevance assessment**: Are New System chunks completely irrelevant or just lower quality?
- [ ] **Document semantic failures**: Does 3-large misunderstand spiritual/philosophical concepts?
- [ ] **Key insight**: Is this a threshold issue or fundamental semantic failure?

### 2. Similarity Score Distribution Analysis ⏰ 30-45 minutes

**Value**: Check if threshold mismatch is causing false negatives **Impact**: Medium - quick threshold fix vs model
failure

- [ ] **Compare similarity score ranges** between systems for same queries
- [ ] **Current System pattern**: Typically 0.8+ for relevant chunks
- [ ] **New System pattern**: Check if relevant chunks score 0.3-0.6 (threshold issue) or <0.2 (semantic failure)
- [ ] **Threshold test**: Manually lower threshold to 0.2 and see if relevant chunks appear

### 3. Data Integrity Validation ⏰ 20-30 minutes

**Value**: Rule out corruption/ingestion artifacts **Impact**: Low - quick validation

- [ ] **Verify chunk count and metadata** consistency between systems
- [ ] **Sample random chunks** - do they contain reasonable text content?
- [ ] **Check library filtering** - are queries properly filtered to ananda library?
- [ ] **Metadata integrity** - are source, author, library fields populated correctly?

### 4. Embedding Model Behavior Analysis ⏰ 45-60 minutes

**Value**: Understand if 3072D embeddings cluster differently **Impact**: Medium - architectural insight

- [ ] **Use existing embedding analysis script** on current database
- [ ] **Compare embedding distributions** for same content between systems
- [ ] **Cluster analysis**: Do semantically similar documents cluster in 3072D space?
- [ ] **Dimensionality effects**: Are 3072D embeddings suffering from curse of dimensionality?

---

## DIAGNOSTIC OUTCOMES & DECISIONS

### Scenario A: Threshold/Configuration Issue ✅ FIXABLE

**If similarity scores are 0.3-0.6 for relevant content:**

- **Action**: Adjust similarity threshold and re-test
- **Re-ingestion**: Proceed with confidence
- **Timeline**: Quick fix, continue with optimization

### Scenario B: Semantic Understanding Failure ❌ MODEL UNSUITABLE

**If retrieved chunks are completely irrelevant semantically:**

- **Action**: Abandon text-embedding-3-large entirely
- **Decision**: Stick with proven ada-002 architecture
- **Savings**: Avoid expensive re-ingestion process

### Scenario C: Data Corruption Issues 🔧 INGESTION PROBLEM

**If chunks contain corrupted text or wrong metadata:**

- **Action**: Fix ingestion process first, then re-ingest
- **Investigation**: Check dynamic chunking implementation for bugs
- **Timeline**: Debug and fix before proceeding

### Scenario D: Dimensionality/Architecture Issue 📊 RESEARCH NEEDED

**If embeddings don't cluster semantically in 3072D space:**

- **Action**: Consider PCA reduction or alternative models
- **Research**: text-embedding-3-small as middle ground
- **Decision**: May still proceed with re-ingestion if other factors look good

---

## POST RE-INGESTION: New System Optimization

**Status**: 🔄 **After paragraph-based re-ingestion complete**

### 4. Paragraph vs Dynamic Chunking Comparison ⏰ 1 hour

**Value**: Quantify chunking strategy impact on New System **Impact**: High - validates chunking decision

- [ ] **Run full evaluation**: New System with paragraph chunking vs old dynamic chunking results
- [ ] **Expected result**: Paragraph chunking shows 60% improvement (matching Current System pattern)
- [ ] **Document improvement metrics** in `docs/chunking-comparison-new-system.md`

### 6. Advanced Optimization Experiments ⏰ 4-6 hours

**Value**: Squeeze maximum performance from chosen system **Impact**: Medium - incremental gains

#### Similarity Threshold Tuning

- [ ] **Test threshold range 0.2-0.8** in 0.1 increments on final system
- [ ] **Optimize for Precision@5** and user satisfaction metrics
- [ ] **A/B testing framework** for threshold comparison

#### Chunking Strategy Refinement

- [ ] **Test chunk size variants**: 400, 600, 800 tokens
- [ ] **Test overlap ratios**: 10%, 20%, 30%
- [ ] **Hybrid chunking approaches**: Sentence + paragraph boundaries

#### Content-Specific Optimization

- [ ] **Audio/video transcription** chunking evaluation
- [ ] **PDF text extraction** quality assessment
- [ ] **Web crawling** content chunking analysis

---

## Implementation Plan

### Phase 1: COMPLETED ✅ - Staying with Ada-002

After thorough evaluation, we determined text-embedding-ada-002 significantly outperforms newer models on spiritual
content:

- **Ada-002**: 81.4% similarity, 100% precision@5
- **3-small/large**: ~39% similarity, lower precision
- **Decision**: Continue using proven Ada-002 model

See `.remember/memory/self.md` for complete analysis and rationale.

### Phase 2: Re-ingestion (Production Task) ⏰ 8-24 hours

1. **Complete data re-ingestion** with fixed paragraph-based chunking
2. **Verify chunking quality** matches evaluation expectations
3. **Deploy New System database** for evaluation

### Phase 3: Performance Validation ⏰ 3-4 hours

1. **Run comprehensive evaluation** on New System
2. **Compare all key metrics** against Current System
3. **Make deployment decision** based on results

### Phase 4: Optimization (If New System is viable) ⏰ 4-6 hours

1. **Fine-tune similarity thresholds** for 3072D embeddings
2. **Optimize chunking parameters** if needed
3. **Production deployment** and monitoring

---

## Success Criteria

### Learning Phase Success

- [x] Quantified performance gap between embedding models with dynamic chunking
- [x] Identified specific weaknesses in 3072D retrieval quality
- [x] Validated that data quality issues aren't causing poor performance

### Re-ingestion Success

- [ ] All content re-ingested with paragraph-based chunking (600 tokens, 120 overlap)
- [ ] Chunk quality metrics match evaluation expectations (70%+ in 225-450 word range)
- [ ] No punctuation spacing corruption in stored content

### Final System Success

- [ ] New System performance >= Current System performance (Precision@5 > 70%)
- [ ] Retrieval latency acceptable (< 1 second average)
- [ ] Production deployment ready with proper monitoring

---

## Tools and Scripts Ready

### Evaluation Infrastructure ✅ Ready

- **`bin/evaluate_rag_system.py`** - Full evaluation suite with multiple chunking strategies
- **`evaluation_dataset_ananda.jsonl`** - Standardized test queries for consistent comparison

### Analysis Tools ✅ Ready

- **`bin/analyze_embedding_distributions.py`** - Embedding similarity and distribution analysis
- **`test_fixed_chunking.py`** - Chunking quality verification

### Fixed Implementation ✅ Ready

- **`data_ingestion/utils/text_splitter_utils.py`** - Fixed paragraph-based chunking with NLTK overlap
- **All ingestion scripts** - Updated to use consistent chunking approach

### Database Configuration ✅ Ready

- **Current System**: `PINECONE_INDEX_NAME` (ada-002, 1536D)
- **New System**: `PINECONE_INGEST_INDEX_NAME` (3-large, 3072D) - ready for re-ingestion

---

## Next Immediate Actions

1. **Execute Phase 1 learning experiments** on existing dynamic chunking database
2. **Document all findings** before proceeding with re-ingestion
3. **Initiate complete re-ingestion** with fixed paragraph-based chunking
4. **Execute Phase 3 validation** once re-ingestion complete
