# To-Do List for Chunking Optimization

## Priority Tasks

1. **Implement Word Count-Based Chunk Sizing** [x]

   - **Task**: Modify the SpaCy chunker to calculate the word count of the input text and dynamically set chunk sizes
     and overlaps.

   - Action

     :

     - Use an approximate word count by splitting the text on spaces.
     - Set chunk sizes and overlaps based on word count:
       - **Short content** (<1,000 words): 200 tokens, 50-token overlap.
       - **Medium content** (1,000-5,000 words): 400 tokens, 100-token overlap.
       - **Long content** (>5,000 words): 600 tokens, 150-token overlap.
     - Handle very short texts (<200 words) by skipping chunking and treating them as single chunks.

   - **Purpose**: Ensures chunk sizes scale with content length, aligning with the target range of 225-450 words.

2. **Optimize Tokenization for Efficiency** [x]

   - **Task**: Use SpaCy's tokenizer to count tokens accurately and split text into chunks.

   - Action

     :

     - Pre-tokenize the text once and reuse the token list for both word count estimation and chunking.

   - **Purpose**: Ensures consistency between word count estimates and actual token-based chunks while minimizing
     processing time.

3. **Update Evaluation Script for Variable Chunk Sizes**

   - **Task**: Adjust the evaluation script to handle dynamic chunk sizes and overlaps.

   - Action

     :

     - Add logging to track chunk sizes and overlaps for different content types.

   - **Purpose**: Verifies that dynamic chunking improves relevance (e.g., Precision@K, NDCG@K).

4. **Test Updated Chunker on Diverse Content** [x]

   - **Task**: Test the chunker on samples from spiritual books, WordPress content, transcribed audio talks, and
     transcribed YouTube talks.

   - Action

     :

     - Select representative samples from each category.
     - Run the chunker and verify chunk sizes, overlaps, and context preservation.
     - Ensure chunks are within the target range of 225-450 words.

   - **Purpose**: Confirms the chunker works across all content types.

   - **Results**: Tested on spiritual books, transcriptions, and WordPress content. Most chunks are smaller than the
     target range (225-450 words) due to boundary prioritization in SpacyTextSplitter. Further refinement needed in
     Task 6.

5. **Monitor and Log Chunking Process** [x]

   - **Task**: Add logging to track word count, chunk size, and overlap for each document.

   - Action

     :

     - Log edge cases (e.g., very short or very long texts) and anomalies.

   - **Purpose**: Provides data to refine thresholds and ensure optimal performance.

   - **Results**: Implemented comprehensive logging system with ChunkingMetrics class that tracks:
     - Document-level metrics (word count, chunk count, chunk sizes)
     - Distribution analysis (word count ranges, chunk size ranges)
     - Edge case detection (very short/long documents, large documents not chunked)
     - Anomaly detection (unexpectedly small/large chunks)
     - Target range analysis (225-450 words per chunk)
     - Summary reporting with percentages and detailed breakdowns

6. **Refine Thresholds Based on Testing** [x]

   - **Task**: Analyze logged data to identify suboptimal chunking.

   - Action

     :

     - Adjust word count thresholds, chunk sizes, or overlap percentages as needed.
     - Review SpacyTextSplitter logic to merge smaller segments to better meet the 225-450 word target range.

   - **Purpose**: Fine-tunes the chunker for better relevance across content types.

   - **Results**: Successfully refined chunking strategy with dramatic improvements:
     - **Target Range Achievement**: 70% of chunks now in 225-450 word range (up from 0%)
     - **Increased Chunk Sizes**: Short content 200→800 tokens, Medium 400→1200, Long 600→1600
     - **Enhanced Overlaps**: Proportionally increased overlaps for better context preservation
     - **Smart Merging**: Added post-processing to merge small chunks into target range
     - **Distribution Improvement**: 50% of chunks now 300-499 words vs 100% <100 words before
     - **Chunk Quality**: Average chunk sizes now 240-333 words (much closer to target)

## Additional Tasks (Optional)

1. **Enhance Paragraph Detection (if needed)**

   - **Task**: Improve paragraph break detection in `SpacyTextSplitter` for content lacking `\n\n`.

   - Action

     :

     - Use regex to detect multiple newline patterns (e.g., `\n\s*\n`, `\r\n\r\n`).
     - Add pseudo-paragraph grouping (5-10 sentences) as a fallback.

   - **Purpose**: Ensures accurate paragraph breaks for better chunking.

2. **Merge Related WordPress Posts (if applicable)**

   - **Task**: Modify ingestion scripts to merge related WordPress posts by metadata (e.g., category, series).

   - Action

     :

     - Combine posts into larger documents (e.g., 2,000-5,000 words).

   - **Purpose**: Increases text length for short content, enabling larger chunks.

3. **Switch to `pdfplumber` for Better Extraction (if needed)**

   - **Task**: Replace `PyPDF2` with `pdfplumber` for improved newline and formatting preservation.

   - Action

     :

     - Update ingestion scripts to use `pdfplumber`.

   - **Purpose**: Enhances paragraph break detection for PDFs with complex layouts.

4. **Document Findings and Plan Scaling**

   - **Task**: Summarize analysis, chunker adjustments, and evaluation results.
   - **Action**: Write a report and plan to scale the solution to the full corpus.
   - **Purpose**: Guides future iterations and ensures the 20-40% relevance boost.
