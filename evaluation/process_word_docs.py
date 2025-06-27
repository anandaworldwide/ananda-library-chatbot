#!/usr/bin/env python3
"""
Dual System Evaluation Word Document Processor

This script processes completed Word documents by:
1. Finding Word documents in the todo directory
2. Extracting judge names and relevance scores
3. Updating the existing evaluation_session.json file
4. Moving processed files to the done directory

The script looks for scores in the format:
- Relevance Score [Enter 0-3 or ignore]: 2
- Or variations like just "2" after the colon
- Accepts "I", "ignore", or blank as skip markers

Usage:
    python process_word_docs.py --word-docs-dir 3large_vs_3small/word_docs --session-file 3large_vs_3small/step3_evaluation_session.json --results-file 3large_vs_3small/step2_retrieval_results.json
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime
from typing import Any

from docx import Document


def extract_text_from_docx(docx_path: str) -> str:
    """Extract all text content from a Word document."""
    try:
        doc = Document(docx_path)
        full_text = []
        for paragraph in doc.paragraphs:
            full_text.append(paragraph.text)
        return "\n".join(full_text)
    except Exception as e:
        print(f"Error reading Word document {docx_path}: {e}")
        return ""


def extract_judge_and_query(
    content: str, filename: str
) -> tuple[str | None, str | None]:
    """Extract judge name and query from document content."""
    # Extract judge
    judge_patterns = [
        r"Judge:\s*([^\n]+)",
        r"Judge\s*[:\-]\s*([^\n]+)",
    ]

    judge = None
    for pattern in judge_patterns:
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            judge = match.group(1).strip().strip("_").strip()
            if judge:
                break

    if not judge:
        print(f"Warning: No judge name found in {filename}")
        return None, None

    # Extract query
    query_patterns = [
        r"Query\s*\n\s*([^\n]+)",
        r"Query:\s*([^\n]+)",
        r"Query\s*[:\-]\s*([^\n]+)",
    ]

    query = None
    for pattern in query_patterns:
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            query = match.group(1).strip()
            if query:
                break

    if not query:
        print(f"Warning: No query found in {filename}")
        return None, None

    return judge, query


def extract_document_scores(content: str, filename: str) -> dict[int, str]:
    """Extract relevance scores for each document."""
    scores = {}

    # Primary pattern for score extraction
    score_patterns = [
        r"Relevance Score \[Enter 0-3 or ignore\]:\s*([0-3]|[Ii]|ignore|\s*$)",
        r"Relevance Score[^\n]*:\s*([0-3]|[Ii]|ignore|\s*$)",
        r"Score[^\n]*:\s*([0-3]|[Ii]|ignore|\s*$)",
    ]

    # Find all document sections
    doc_sections = re.findall(r"Document (\d+)", content)

    if not doc_sections:
        print(f"Warning: No document sections found in {filename}")
        return scores

    # For each document, try to find its score
    for doc_num_str in doc_sections:
        doc_num = int(doc_num_str)

        # Look for score after this document number
        doc_pattern = rf"Document {doc_num}.*?(?=Document \d+|$)"
        doc_match = re.search(doc_pattern, content, re.DOTALL)

        if not doc_match:
            continue

        doc_section = doc_match.group(0)

        # Try to find score in this section
        score_found = False
        for pattern in score_patterns:
            score_match = re.search(pattern, doc_section, re.IGNORECASE)
            if score_match:
                score_value = score_match.group(1).strip()

                # Handle different score formats
                if score_value.lower() in ["i", "ignore"] or score_value == "":
                    scores[doc_num] = "skip"
                elif score_value in ["0", "1", "2", "3"]:
                    scores[doc_num] = int(score_value)

                score_found = True
                break

        if not score_found:
            print(f"Warning: No score found for Document {doc_num} in {filename}")

    return scores


def load_retrieval_results(results_file: str) -> dict[str, Any]:
    """Load the original retrieval results to get document mappings."""
    try:
        with open(results_file) as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"Error: Results file '{results_file}' not found.")
    except json.JSONDecodeError as e:
        sys.exit(f"Error: Invalid JSON in results file: {e}")


def load_evaluation_session(session_file: str) -> dict[str, Any]:
    """Load existing evaluation session or create new one."""
    if os.path.exists(session_file):
        try:
            with open(session_file) as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            print(f"Warning: Invalid JSON in session file, creating new session: {e}")

    # Create new session structure
    return {
        "metadata": {
            "created_at": datetime.now().isoformat(),
            "evaluation_type": "dual_system_word_docs",
            "total_evaluations": 0,
            "total_skipped": 0,
        },
        "evaluations": {},
        "judges": {},
        "queries": {},
    }


def save_evaluation_session(session: dict[str, Any], session_file: str) -> None:
    """Save the updated evaluation session."""
    session["metadata"]["last_updated"] = datetime.now().isoformat()

    with open(session_file, "w") as f:
        json.dump(session, f, indent=2)


def find_query_in_results(query_text: str, results: dict[str, Any]) -> str | None:
    """Find the query ID in retrieval results that matches the query text."""
    queries_list = results["results"]

    # Search for exact match
    for query_data in queries_list:
        stored_query = query_data.get("query_text", "").strip()
        if stored_query == query_text.strip():
            return query_data.get("query_id", "unknown")

    # If exact match fails, try partial matching
    for query_data in queries_list:
        stored_query = query_data.get("query_text", "").strip()
        if stored_query in query_text or query_text in stored_query:
            return query_data.get("query_id", "unknown")

    return None


def create_evaluation_key(query_id: str, doc_index: int, system: str) -> str:
    """Create evaluation key in the format expected by analysis script."""
    return f"{query_id}_doc{doc_index}_{system}"


def reconstruct_document_mapping(
    query_data: dict[str, Any], seed: int = 42
) -> list[tuple[str, str, dict[str, Any]]]:
    """Reconstruct the document order used in Word doc generation."""
    import random

    # Recreate the same randomization as in generate_word_docs.py
    random.seed(seed)

    documents = []

    # Handle dual_system_retrieval.py format
    systems_data = query_data.get("systems", {})

    for system_name, system_info in systems_data.items():
        system_docs = system_info.get("documents", [])
        for doc in system_docs:
            documents.append((system_name, system_name, doc))

    # Apply same shuffle
    random.shuffle(documents)

    return documents


def _validate_document_data(
    content: str, results: dict[str, Any], filename: str
) -> tuple[str, str, str] | None:
    """Validate and extract basic document data."""
    # Extract judge and query
    judge, query = extract_judge_and_query(content, filename)
    if not judge or not query:
        print(f"Error: Missing judge or query in {filename}")
        return None

    # Find query in results
    query_id = find_query_in_results(query, results)
    if not query_id:
        print(
            f"Error: Could not find matching query in results for '{query}' in {filename}"
        )
        return None

    return judge, query, query_id


def _process_document_evaluations(
    doc_scores: dict[int, str],
    document_mapping: list[tuple[str, str, dict[str, Any]]],
    query_id: str,
    judge: str,
    session: dict[str, Any],
) -> tuple[int, int]:
    """Process document evaluations and update session."""
    evaluations_added = 0
    skipped_added = 0

    for doc_position, score in doc_scores.items():
        if doc_position < 1 or doc_position > len(document_mapping):
            print(f"Warning: Document position {doc_position} out of range")
            continue

        # Get document info (convert to 0-indexed)
        system, system_name, doc_data = document_mapping[doc_position - 1]

        # Create evaluation key
        eval_key = create_evaluation_key(query_id, doc_position - 1, system)

        if score == "skip":
            session["evaluations"][eval_key] = "skip"
            skipped_added += 1
        else:
            session["evaluations"][eval_key] = {
                "score": score,
                "doc_score": doc_data.get("score", 0),
                "timestamp": datetime.now().isoformat(),
                "judge": judge,
                "document_text": doc_data.get("text", ""),
                "system": system_name,
            }
            evaluations_added += 1

    return evaluations_added, skipped_added


def _update_session_metadata(
    session: dict[str, Any],
    judge: str,
    query_id: str,
    query_text: str,
    evaluations_added: int,
    skipped_added: int,
) -> None:
    """Update session metadata with judge and query tracking."""
    # Update metadata
    session["metadata"]["total_evaluations"] += evaluations_added
    session["metadata"]["total_skipped"] += skipped_added

    # Track judges and queries
    if judge not in session["judges"]:
        session["judges"][judge] = {"documents_evaluated": 0, "queries_handled": []}

    session["judges"][judge]["documents_evaluated"] += evaluations_added
    if query_id not in session["judges"][judge]["queries_handled"]:
        session["judges"][judge]["queries_handled"].append(query_id)

    session["queries"][query_id] = {
        "query_text": query_text,
        "judge": judge,
        "documents_evaluated": evaluations_added,
        "documents_skipped": skipped_added,
        "processed_at": datetime.now().isoformat(),
    }


def process_word_document(
    docx_path: str, results: dict[str, Any], session: dict[str, Any], seed: int = 42
) -> bool:
    """Process a single Word document and update the session."""
    filename = os.path.basename(docx_path)
    print(f"Processing: {filename}")

    # Extract content
    content = extract_text_from_docx(docx_path)
    if not content:
        print(f"Error: Could not extract content from {filename}")
        return False

    # Validate document data
    validation_result = _validate_document_data(content, results, filename)
    if not validation_result:
        return False

    judge, query, query_id = validation_result

    # Extract document scores
    doc_scores = extract_document_scores(content, filename)
    if not doc_scores:
        print(f"Warning: No document scores found in {filename}")
        return False

    # Find the query data in results
    query_data = None
    for q in results["results"]:
        if q.get("query_id") == query_id:
            query_data = q
            break

    if not query_data:
        print(f"Error: Could not find query data for {query_id}")
        return False

    # Reconstruct document mapping
    document_mapping = reconstruct_document_mapping(query_data, seed)

    if len(document_mapping) != 10:
        print(
            f"Error: Expected 10 documents, got {len(document_mapping)} for query {query_id}"
        )
        return False

    # Process evaluations
    evaluations_added, skipped_added = _process_document_evaluations(
        doc_scores, document_mapping, query_id, judge, session
    )

    # Update session metadata
    _update_session_metadata(
        session, judge, query_id, query, evaluations_added, skipped_added
    )

    print(f"  Added {evaluations_added} evaluations, {skipped_added} skipped")
    return True


def process_all_word_documents(
    word_docs_dir: str, session_file: str, results_file: str, seed: int = 42
) -> None:
    """Process all Word documents in the todo directory."""
    todo_dir = os.path.join(word_docs_dir, "todo")
    done_dir = os.path.join(word_docs_dir, "done")

    # Ensure directories exist
    if not os.path.exists(todo_dir):
        print(f"Error: Todo directory not found: {todo_dir}")
        return

    os.makedirs(done_dir, exist_ok=True)

    # Load data
    results = load_retrieval_results(results_file)
    session = load_evaluation_session(session_file)

    # Find Word documents (filter out Microsoft Word temp files)
    docx_files = [
        f
        for f in os.listdir(todo_dir)
        if f.endswith(".docx") and not f.startswith("~$")
    ]

    if not docx_files:
        print("No Word documents found in todo directory")
        return

    print(f"Found {len(docx_files)} Word documents to process")

    processed_count = 0

    for filename in docx_files:
        docx_path = os.path.join(todo_dir, filename)

        success = process_word_document(docx_path, results, session, seed)

        if success:
            # Move to done directory
            done_path = os.path.join(done_dir, filename)

            # Handle filename conflicts
            counter = 1
            while os.path.exists(done_path):
                base, ext = os.path.splitext(filename)
                done_path = os.path.join(done_dir, f"{base}_{counter}{ext}")
                counter += 1

            try:
                shutil.move(docx_path, done_path)
                print(f"  Moved to done: {os.path.basename(done_path)}")
                processed_count += 1
            except Exception as e:
                print(f"  Error moving file: {e}")
        else:
            print("  Keeping in todo directory due to errors")

    # Save updated session
    save_evaluation_session(session, session_file)

    print("\nProcessing complete!")
    print(f"Successfully processed: {processed_count}/{len(docx_files)} documents")
    print(f"Total evaluations in session: {session['metadata']['total_evaluations']}")
    print(f"Total skipped in session: {session['metadata']['total_skipped']}")
    print(f"Updated session file: {session_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Process completed Word documents for dual system evaluation"
    )
    parser.add_argument(
        "--word-docs-dir",
        type=str,
        required=True,
        help="Directory containing word document subdirectories (unassigned, todo, done)",
    )
    parser.add_argument(
        "--session-file",
        type=str,
        required=True,
        help="Path to evaluation session JSON file (will be created or updated)",
    )
    parser.add_argument(
        "--results-file",
        type=str,
        required=True,
        help="Path to Step 2 retrieval results JSON file",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed used in document generation (must match generate_word_docs.py)",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug output")

    args = parser.parse_args()

    process_all_word_documents(
        args.word_docs_dir, args.session_file, args.results_file, args.seed
    )


if __name__ == "__main__":
    main()
