#!/usr/bin/env python3
"""
Analyzes PDF files in a specified directory to understand text characteristics for chunking optimization.

Key Operations:
- Takes a directory path as a command-line argument.
- Extracts text from all PDF files using PyPDF2.
- Computes statistics for each PDF:
  - Word and token counts (average, median, min, max, percentiles).
  - Paragraph counts and lengths (using enhanced newline detection).
  - Sentence lengths (using spaCy with sentencizer).
  - Formatting (single and double newlines, sample text snippets).
- Handles large PDFs (articles, chapters, books) by increasing spaCy max_length, disabling parser/NER,
  adding sentencizer, and improving paragraph detection.
- Outputs results to console and a file (pdf_corpus_analysis.txt) with histograms and detailed samples.

Dependencies:
- PyPDF2: For PDF text extraction.
- spacy: For sentence segmentation (en_core_web_sm model).
- nltk: For tokenization.
- numpy: For statistical analysis.
- tqdm: For progress indication.
- Install: pip install PyPDF2 spacy nltk numpy tqdm
- Install spaCy model: python -m spacy download en_core_web_sm

Usage:
  python analyze_pdf_corpus.py /path/to/pdf-docs
"""

import argparse
import logging
import os
import re
from datetime import datetime

import numpy as np
import PyPDF2
import spacy
from nltk.tokenize import word_tokenize
from tqdm import tqdm

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Download NLTK data
import nltk

nltk.download("punkt", quiet=True)

# Load spaCy model with parser and NER disabled, add sentencizer
try:
    nlp = spacy.load("en_core_web_sm", disable=["parser", "ner"])
    nlp.add_pipe("sentencizer")  # Add sentencizer for sentence segmentation
    nlp.max_length = 2_000_000  # Increase to handle large PDFs
except OSError:
    logger.error(
        "spaCy model 'en_core_web_sm' not found. Install with: python -m spacy download en_core_web_sm"
    )
    exit(1)


def extract_text_from_pdf(pdf_path):
    """Extract text from a PDF file."""
    try:
        with open(pdf_path, "rb") as file:
            reader = PyPDF2.PdfReader(file)
            text = ""
            for page in reader.pages:
                page_text = page.extract_text() or ""
                text += page_text
            return text.strip()
    except Exception as e:
        logger.error(f"Error extracting text from {pdf_path}: {e}")
        return ""


def clean_text(text):
    """Clean text by normalizing newlines and preserving paragraph breaks."""
    if not text:
        return text
    # Normalize line endings and whitespace
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Replace multiple newlines or whitespace with \n\n for paragraph breaks
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    # Split into paragraphs, clean each, and rejoin
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    cleaned_paragraphs = []
    for para in paragraphs:
        # Collapse single newlines within paragraphs
        lines = [line.strip() for line in para.split("\n") if line.strip()]
        cleaned_para = " ".join(lines)
        if cleaned_para:
            cleaned_paragraphs.append(cleaned_para)
    text = "\n\n".join(cleaned_paragraphs)
    return text.strip()


def analyze_document(text):
    """Analyze a single document's text characteristics."""
    if not text:
        return None

    # Truncate text to avoid memory issues
    max_chars = 1_500_000  # Safe limit for large PDFs
    if len(text) > max_chars:
        logger.warning(f"Text truncated from {len(text)} to {max_chars} characters.")
        text = text[:max_chars]

    # Word and token counts
    words = text.split()
    word_count = len(words)
    tokens = word_tokenize(text)
    token_count = len(tokens)

    # Paragraph analysis (split by \n\n)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    paragraph_count = len(paragraphs)
    paragraph_word_lengths = [len(p.split()) for p in paragraphs]
    paragraph_token_lengths = [len(word_tokenize(p)) for p in paragraphs]

    # Pseudo-paragraph fallback if no breaks detected
    if paragraph_count <= 1:
        logger.warning("Few paragraph breaks detected. Using pseudo-paragraphs.")
        doc = nlp(text)
        sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
        pseudo_paragraphs = []
        current_para = []
        current_words = 0
        target_para_size = 150  # Target ~150 words per pseudo-paragraph
        for sent in sentences:
            sent_words = len(sent.split())
            if current_words + sent_words <= target_para_size:
                current_para.append(sent)
                current_words += sent_words
            else:
                if current_para:
                    pseudo_paragraphs.append(" ".join(current_para))
                current_para = [sent]
                current_words = sent_words
        if current_para:
            pseudo_paragraphs.append(" ".join(current_para))
        paragraphs = pseudo_paragraphs
        paragraph_count = len(paragraphs)
        paragraph_word_lengths = [len(p.split()) for p in paragraphs]
        paragraph_token_lengths = [len(word_tokenize(p)) for p in paragraphs]

    # Sentence analysis (using spaCy with sentencizer)
    try:
        doc = nlp(text)
        sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
    except Exception as e:
        logger.error(f"spaCy processing failed: {e}")
        sentences = []
    sentence_count = len(sentences)
    sentence_word_lengths = [len(sent.split()) for sent in sentences]
    sentence_token_lengths = [len(word_tokenize(sent)) for sent in sentences]

    # Formatting (newlines)
    single_newlines = text.count("\n") - 2 * text.count("\n\n")
    double_newlines = text.count("\n\n")

    # Sample text (first 200 characters)
    sample_text = text[:200] + "..." if len(text) > 200 else text

    # Log first few paragraphs for debugging
    debug_paragraphs = paragraphs[:3]
    logger.debug(f"Sample Paragraphs ({len(debug_paragraphs)} of {paragraph_count}):")
    for i, para in enumerate(debug_paragraphs, 1):
        logger.debug(f"Paragraph {i}: {para[:100]}... ({len(para.split())} words)")

    return {
        "word_count": word_count,
        "token_count": token_count,
        "paragraph_count": paragraph_count,
        "paragraph_word_lengths": paragraph_word_lengths,
        "paragraph_token_lengths": paragraph_token_lengths,
        "sentence_count": sentence_count,
        "sentence_word_lengths": sentence_word_lengths,
        "sentence_token_lengths": sentence_token_lengths,
        "single_newlines": single_newlines,
        "double_newlines": double_newlines,
        "sample_text": sample_text,
    }


def compute_statistics(values):
    """Compute statistical metrics for a list of values."""
    if not values:
        return {
            "count": 0,
            "mean": 0,
            "median": 0,
            "min": 0,
            "max": 0,
            "std": 0,
            "p25": 0,
            "p75": 0,
        }
    return {
        "count": len(values),
        "mean": np.mean(values),
        "median": np.median(values),
        "min": np.min(values),
        "max": np.max(values),
        "std": np.std(values),
        "p25": np.percentile(values, 25),
        "p75": np.percentile(values, 75),
    }


def compute_histogram(word_counts):
    """Compute a histogram of word counts."""
    bins = [0, 500, 1000, 2000, 5000, 10000, 20000, float("inf")]
    labels = [
        "0-500",
        "500-1000",
        "1000-2000",
        "2000-5000",
        "5000-10000",
        "10000-20000",
        "20000+",
    ]
    hist, _ = np.histogram(word_counts, bins=bins)
    return {label: count for label, count in zip(labels, hist, strict=False)}


def main():
    # Parse command-line argument
    parser = argparse.ArgumentParser(
        description="Analyze PDF files in a directory for text characteristics."
    )
    parser.add_argument("directory", help="Path to the directory containing PDF files")
    args = parser.parse_args()

    directory = args.directory
    if not os.path.isdir(directory):
        logger.error(f"Directory {directory} does not exist.")
        exit(1)

    # Find PDF files
    pdf_files = [f for f in os.listdir(directory) if f.lower().endswith(".pdf")]
    if not pdf_files:
        logger.error(f"No PDF files found in {directory}.")
        exit(1)

    logger.info(f"Found {len(pdf_files)} PDF files in {directory}.")

    # Initialize output file
    output_file = f"pdf_corpus_analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    results = []

    # Analyze each PDF with progress bar
    for pdf_file in tqdm(pdf_files, desc="Processing PDFs", unit="file"):
        pdf_path = os.path.join(directory, pdf_file)
        logger.info(f"Processing {pdf_file}...")
        text = extract_text_from_pdf(pdf_path)
        if not text:
            logger.warning(f"No text extracted from {pdf_file}. Skipping.")
            continue
        text = clean_text(text)
        analysis = analyze_document(text)
        if analysis:
            analysis["filename"] = pdf_file
            results.append(analysis)
        else:
            logger.warning(f"No analysis data for {pdf_file}. Skipping.")

    if not results:
        logger.error("No valid PDF files analyzed. Exiting.")
        exit(1)

    # Compute aggregate statistics
    word_counts = [r["word_count"] for r in results]
    token_counts = [r["token_count"] for r in results]
    paragraph_counts = [r["paragraph_count"] for r in results]
    all_paragraph_word_lengths = [
        length for r in results for length in r["paragraph_word_lengths"]
    ]
    all_paragraph_token_lengths = [
        length for r in results for length in r["paragraph_token_lengths"]
    ]
    sentence_counts = [r["sentence_count"] for r in results]
    all_sentence_word_lengths = [
        length for r in results for length in r["sentence_word_lengths"]
    ]
    all_sentence_token_lengths = [
        length for r in results for length in r["sentence_token_lengths"]
    ]
    single_newlines = [r["single_newlines"] for r in results]
    double_newlines = [r["double_newlines"] for r in results]

    # Compute word count histogram
    word_histogram = compute_histogram(word_counts)

    # Output results
    with open(output_file, "w") as f:
        f.write(
            f"PDF Corpus Analysis - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        )
        f.write(f"Directory: {directory}\n")
        f.write(f"Number of PDFs Analyzed: {len(results)}\n\n")

        f.write("=== Word Count Statistics ===\n")
        stats = compute_statistics(word_counts)
        f.write(f"Count: {stats['count']}\n")
        f.write(f"Average: {stats['mean']:.1f} words\n")
        f.write(f"Median: {stats['median']:.1f} words\n")
        f.write(f"Min: {stats['min']} words\n")
        f.write(f"Max: {stats['max']} words\n")
        f.write(f"Std Dev: {stats['std']:.1f} words\n")
        f.write(f"25th Percentile: {stats['p25']:.1f} words\n")
        f.write(f"75th Percentile: {stats['p75']:.1f} words\n\n")

        f.write("=== Word Count Distribution ===\n")
        for label, count in word_histogram.items():
            f.write(
                f"{label} words: {count} PDFs ({count / len(word_counts) * 100:.1f}%)\n"
            )
        f.write("\n")

        f.write("=== Token Count Statistics ===\n")
        stats = compute_statistics(token_counts)
        f.write(f"Average: {stats['mean']:.1f} tokens\n")
        f.write(f"Median: {stats['median']:.1f} tokens\n")
        f.write(f"Min: {stats['min']} tokens\n")
        f.write(f"Max: {stats['max']} tokens\n")
        f.write(f"Std Dev: {stats['std']:.1f} tokens\n\n")

        f.write("=== Paragraph Statistics ===\n")
        stats = compute_statistics(paragraph_counts)
        f.write(f"Average Paragraphs per PDF: {stats['mean']:.1f}\n")
        stats = compute_statistics(all_paragraph_word_lengths)
        f.write(f"Average Paragraph Length: {stats['mean']:.1f} words\n")
        stats = compute_statistics(all_paragraph_token_lengths)
        f.write(f"Average Paragraph Length: {stats['mean']:.1f} tokens\n\n")

        f.write("=== Sentence Statistics ===\n")
        stats = compute_statistics(sentence_counts)
        f.write(f"Average Sentences per PDF: {stats['mean']:.1f}\n")
        stats = compute_statistics(all_sentence_word_lengths)
        f.write(f"Average Sentence Length: {stats['mean']:.1f} words\n")
        stats = compute_statistics(all_sentence_token_lengths)
        f.write(f"Average Sentence Length: {stats['mean']:.1f} tokens\n\n")

        f.write("=== Formatting Statistics ===\n")
        stats = compute_statistics(single_newlines)
        f.write(f"Average Single Newlines: {stats['mean']:.1f}\n")
        stats = compute_statistics(double_newlines)
        f.write(f"Average Double Newlines: {stats['mean']:.1f}\n\n")

        f.write("=== Sample Texts ===\n")
        for result in results[:10]:  # Increase to 10 samples
            f.write(f"Filename: {result['filename']}\n")
            f.write(f"Word Count: {result['word_count']}\n")
            f.write(f"Paragraph Count: {result['paragraph_count']}\n")
            f.write(f"Sentence Count: {result['sentence_count']}\n")
            f.write(f"Sample Text: {result['sample_text']}\n\n")

    # Print summary to console
    logger.info(f"Analysis complete. Results saved to {output_file}")
    logger.info(f"Number of PDFs Analyzed: {len(results)}")
    logger.info(f"Average Word Count: {np.mean(word_counts):.1f}")
    logger.info(f"Average Paragraphs per PDF: {np.mean(paragraph_counts):.1f}")
    logger.info(
        f"Average Paragraph Length: {np.mean(all_paragraph_word_lengths):.1f} words"
    )
    logger.info(
        f"Average Sentence Length: {np.mean(all_sentence_word_lengths):.1f} words"
    )
    logger.info("Word Count Distribution:")
    for label, count in word_histogram.items():
        logger.info(
            f"  {label} words: {count} PDFs ({count / len(word_counts) * 100:.1f}%)"
        )


if __name__ == "__main__":
    main()
