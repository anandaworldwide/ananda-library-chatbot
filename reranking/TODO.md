# Phase I: Build Up That Manual Set of Data

- **Goal**: Confirm ~10-20% improvement in NDCG@5 or Precision@5, ensuring the fine-tuned
  reranker improves OpenAI's answer quality for your spiritual writings app.

## To-Do List

- [?] Build the manual dataset for fine-tuning and evaluation

  - [x] Create a test set of 20-50 representative queries reflecting your spiritual writings domain
        (e.g., "What is grace in [spiritual teacher]'s teachings?", "What is love in spiritual practice?").
        (Handled by providing input file to `generate_markdown.py`)
  - [?] Retrieve 20 documents per query from Pinecone (k=20) using your existing retriever.
    Tool: `generate_markdown.py` handles retrieval and markdown file creation.
  - [?] Manually label each document's relevance (e.g., 3 = highly relevant, 2 = relevant,
    1 = marginally relevant, 0 = irrelevant) in the generated markdown files.
  - [?] Save the evaluation dataset as a CSV or JSONL file with query, document, and relevance fields.
    Tool: `process_markdown.py` parses labeled markdown and saves evaluation data to JSONL.
  - [?] Create a fine-tuning dataset (~100-200 query-document pairs) using 10-20 queries with 5-10
    documents each, labeled for relevance (e.g., 1.0 = relevant, 0.0 = irrelevant).
    Tool: `process_markdown.py` creates this dataset automatically from labeled documents.
  - [?] Save the fine-tuning dataset as JSONL with query, document, and label fields.
    Tool: `process_markdown.py` handles this automatically.

- [ ] Create the fine-tuned cross-encoder

  - [ ] Use Hugging Face's Trainer API to fine-tune cross-encoder/ms-marco-MiniLM-L-4-v2 on the
        fine-tuning dataset.
  - [ ] Run training on Colab (free) or a cloud GPU (~$10) for ~10-30 minutes.
  - [ ] Save the fine-tuned model to a directory (e.g., ./fine_tuned_model).
  - [?] Quantize the fine-tuned model using optimum for faster inference on Vercel
    (produces a ~15-20MB model).

- [ ] Set up the pretrained cross-encoder with test Python code

  - [ ] Load the pretrained cross-encoder/ms-marco-MiniLM-L-4-v2 using LangChain's
        HuggingFaceCrossEncoder.
  - [ ] Write Python code to rerank Pinecone-retrieved documents (top-20) for each test query,
        outputting the top-5 ranked documents.
  - [ ] Test the code locally with 2-3 sample queries to ensure correct ranking output.

- [ ] Measure the performance of pretrained vs. fine-tuned models

  - [ ] Load the evaluation dataset (20-50 queries with labeled documents).
  - [ ] Run both pretrained and fine-tuned rerankers on the test queries to rank the top-20
        Pinecone documents, selecting the top-5.
  - [ ] Calculate **Precision@5** (fraction of top-5 documents with relevance ≥ 1) and **NDCG@5**
        (quality of ranking compared to ideal) for each model.
  - [ ] Average metrics across queries and compute relative improvement (e.g., if pretrained
        NDCG@5 = 0.5 and fine-tuned = 0.6, improvement = 20%).

## Additional tasks to ensure success

- [ ] **Validate dataset quality**: Review the fine-tuning and evaluation datasets to ensure
      accurate, consistent relevance labels.
- [ ] **Test integration with LangChain**: Verify that both pretrained and fine-tuned rerankers
      work in your LangChain pipeline, producing top-5 documents within ~300-500ms.
- [ ] **Check Pinecone retrieval**: Confirm Pinecone returns diverse, relevant documents (k=20)
      to give the reranker good candidates.
- [ ] **Document queries**: Ensure test queries cover key spiritual themes (e.g., grace, love,
      enlightenment, [spiritual teacher]'s teachings).
- [ ] **Backup plan**: Prepare a heuristic reranker (e.g., keyword-based scoring) as a fallback
      if fine-tuning underperforms.
- [ ] **Cost monitoring**: Track fine-tuning costs (~$0-$10 on Colab/GPU) and ensure evaluation
      runs locally or within Vercel's free tier.
- [?] **Per-site implementation**: Implemented site-specific labeling and data processing with `--site` parameter
  in `generate_markdown.py` and `process_markdown.py`.
