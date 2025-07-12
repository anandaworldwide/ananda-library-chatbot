#!/usr/bin/env python3
"""
Document Relevance Label Processor

This script processes completed markdown files by:
1. Finding files marked as done in the markdown directory
2. Parsing the relevance scores (0-3) or "ignore" markers
3. Creating evaluation and fine-tuning datasets
4. Moving processed files to the done directory

Relevance Scoring:
- 0-3: Numeric relevance scores (0=not relevant, 3=highly relevant)
- "ignore": Documents marked as ignored (case-insensitive) are excluded from datasets

Example usage:
    # Process completed markdown files for the ananda site
    python process_markdown.py --site ananda

    # Process with debug output enabled
    python process_markdown.py --site ananda --debug

    # Force processing even if not all documents are scored
    python process_markdown.py --site ananda --force

    # Combine options
    python process_markdown.py --site crystal --debug --force

The script expects markdown files in reranking/markdown_files/{site_id}/ and will:
- Create evaluation dataset: reranking/evaluation_dataset_{site_id}.jsonl
- Create fine-tuning dataset: reranking/fine_tuning_dataset_{site_id}.jsonl
- Move processed files to reranking/markdown_files/{site_id}/done/
- Exclude documents marked as "ignore" from both datasets
"""

import argparse
import json
import os
import re
import shutil
from typing import Any

# Constants
QUERY_PATTERN = r"# Query: (.*?)\n"
JUDGE_PATTERN = r"Judge: *(.*?)\n"
DEFAULT_RETRIEVAL_COUNT = 20

# Updated score pattern to accept both numeric scores and "ignore" (case-insensitive)
SCORE_PATTERN = r"Document (\d+).*?\*Scoring:.*?\*\*Relevance Score\*\* \\?\[Enter 0-3\\?\]:\s*(\d|ignore)"


class MarkdownProcessor:
    def __init__(self, args):
        self.args = args
        self.site_id = args.site
        self.debug_mode = args.debug

        # Set up directories relative to script location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.base_dir = os.path.join(script_dir, "markdown_files", self.site_id)
        self.todo_dir = os.path.join(self.base_dir, "todo")
        self.done_dir = os.path.join(self.base_dir, "done")
        self.evaluation_output = os.path.join(
            script_dir, f"evaluation_dataset_{self.site_id}.jsonl"
        )
        self.fine_tuning_output = os.path.join(
            script_dir, f"fine_tuning_dataset_{self.site_id}.jsonl"
        )

        self._check_directories()

        if self.debug_mode:
            print("Debug mode enabled - verbose logging active")
            print(f"Working with site: {self.site_id}")
            print(f"Todo directory: {self.todo_dir}")
            print(f"Done directory: {self.done_dir}")

    def _check_directories(self):
        """Check if necessary directories exist and prompt user to create them if missing."""
        missing_dirs = []

        if not os.path.exists(self.todo_dir):
            missing_dirs.append(self.todo_dir)

        if not os.path.exists(self.done_dir):
            missing_dirs.append(self.done_dir)

        if missing_dirs:
            print("Warning: The following required directories do not exist:")
            for dir_path in missing_dirs:
                print(f"  - {dir_path}")
            print()

            user_input = (
                input("Create missing directories? (y/n) [default: n]: ")
                .lower()
                .strip()
            )
            if user_input in ("y", "yes"):
                for dir_path in missing_dirs:
                    os.makedirs(dir_path, exist_ok=True)
                    print(f"Created directory: {dir_path}")
            else:
                print("Exiting: Required directories do not exist.")
                exit(1)

    def find_completed_files(self) -> list[tuple[str, str]]:
        """Find markdown and docx files in the todo directory. Returns list of (filepath, type) where type is 'md' or 'docx'."""
        completed_files = []

        if not os.path.exists(self.todo_dir):
            print(f"Warning: Todo directory not found: {self.todo_dir}")
            return []

        for filename in os.listdir(self.todo_dir):
            filepath = os.path.join(self.todo_dir, filename)
            if not os.path.isfile(filepath):
                continue
            if filename.endswith(".md"):
                completed_files.append((filepath, "md"))
            elif filename.endswith(".docx"):
                completed_files.append((filepath, "docx"))
        return completed_files

    def convert_docx_to_md(self, docx_path: str) -> str:
        """Convert a .docx file to .md using pandoc. Returns the path to the new .md file. Never overwrites the .docx."""
        md_path = docx_path[:-5] + ".md"
        import subprocess

        try:
            # Pandoc will create md_path, never overwriting the .docx
            subprocess.run(["pandoc", docx_path, "-o", md_path], check=True)
            if self.debug_mode:
                print(f"Converted {docx_path} to {md_path}")
            return md_path
        except Exception as e:
            print(f"Error converting {docx_path} to markdown: {e}")
            return None

    def _clean_string(self, text: str) -> str:
        """Clean a string by removing extra quotes and whitespace."""
        # Remove leading/trailing whitespace first
        text = text.strip()

        # Only strip quotes if they fully enclose the string and there are no quotes in between
        if len(text) >= 2:
            # Check for matching double quotes
            if text[0] == '"' and text[-1] == '"':
                # Check if there are any quotes in between
                middle_text = text[1:-1]
                if '"' not in middle_text:
                    text = middle_text.strip()
            # Check for matching single quotes
            elif text[0] == "'" and text[-1] == "'":
                # Check if there are any quotes in between
                middle_text = text[1:-1]
                if "'" not in middle_text:
                    text = middle_text.strip()

        return text

    def _clean_markdown(self, text: str) -> str:
        """Remove markdown formatting from text."""
        # Remove bold markdown (double asterisks)
        text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
        return text

    def _extract_query_and_judge(
        self, content: str, filepath: str
    ) -> tuple[str | None, str | None]:
        """Extract query and judge from markdown content."""
        # Extract judge
        judge_match = re.search(JUDGE_PATTERN, content)
        if not judge_match or not judge_match.group(1).strip():
            print(f"Error: No judge name found in {filepath}")
            return None, None

        judge = self._clean_string(judge_match.group(1)).title()

        # Extract query
        query_match = re.search(QUERY_PATTERN, content)
        if not query_match:
            print(f"Error: No query found in {filepath}")
            return None, None

        query = self._clean_string(query_match.group(1))
        return query, judge

    def _extract_document_metadata(self, doc_content: str) -> dict[str, Any]:
        """Extract metadata from document content."""
        metadata = {}
        # More flexible metadata pattern - handles various whitespace scenarios
        metadata_section = re.search(
            r"\*Metadata:\*\s*(.*?)(?=\s*\*Scoring:|$)", doc_content, re.DOTALL
        )
        if metadata_section:
            metadata_text = metadata_section.group(1)
            metadata_matches = re.findall(
                r"\*\*(.*?)\*\*:\s*(.*?)(?=\s*\*\*|\s*\*Scoring:|$)", metadata_text
            )
            # Clean metadata values
            metadata = {k: self._clean_string(v) for k, v in metadata_matches}
        return metadata

    def _process_document_sections(
        self, doc_sections: list, scores: dict[int, int]
    ) -> list[dict[str, Any]]:
        """Process document sections and create labeled documents."""
        labeled_docs = []

        for doc_idx_str, doc_content in doc_sections:
            doc_idx = int(doc_idx_str)

            if doc_idx not in scores:
                print(
                    f"Info: Document {doc_idx} skipped (no score or marked as ignored)"
                )
                continue

            score = scores[doc_idx]
            metadata = self._extract_document_metadata(doc_content)

            # Extract main content (everything before metadata section)
            content_text = doc_content
            metadata_section = re.search(r"\*Metadata:\*", doc_content, re.DOTALL)
            if metadata_section:
                content_text = doc_content[: metadata_section.start()].strip()

            # Clean markdown formatting from content text
            content_text = self._clean_markdown(content_text)

            doc = {"text": content_text, "relevance": score, "metadata": metadata}
            labeled_docs.append(doc)

        return labeled_docs

    def _find_doc_sections(self, content: str) -> list:
        """Extract document sections from content using various patterns."""
        doc_pattern = r"### Document (\d+)\s*\n+(.*?)(?=\s*\*Scoring:)"
        doc_sections = re.findall(doc_pattern, content, re.DOTALL)
        if not doc_sections:
            alt_patterns = [
                r"###\s*Document\s+(\d+)\s*\n+(.*?)(?=\s*\*Scoring:)",
                r"##\s*Document\s+(\d+)\s*\n+(.*?)(?=\s*\*Scoring:)",
                r"Document\s+(\d+)\s*\n+(.*?)(?=\s*\*Scoring:)",
            ]
            for pattern in alt_patterns:
                doc_sections = re.findall(pattern, content, re.DOTALL)
                if doc_sections:
                    if self.debug_mode:
                        print(f"Found documents using alternative pattern: {pattern}")
                    break
        return doc_sections

    def _find_score_matches(self, content: str) -> list:
        """Extract score matches from content using various patterns."""
        score_pattern = SCORE_PATTERN
        score_matches = re.findall(score_pattern, content, re.DOTALL | re.IGNORECASE)
        if not score_matches:
            alt_score_patterns = [
                r"Document (\d+).*?[Ss]coring:.*?[Rr]elevance [Ss]core.*?:\s*(\d|ignore)",
                r"Document (\d+).*?[Ss]core.*?:\s*(\d|ignore)",
                r"Document (\d+).*?\[Enter 0-3\]:\s*(\d|ignore)",
            ]
            for pattern in alt_score_patterns:
                score_matches = re.findall(pattern, content, re.DOTALL | re.IGNORECASE)
                if score_matches:
                    if self.debug_mode:
                        print(f"Found scores using alternative pattern: {pattern}")
                    break
        return score_matches

    def _check_addressed_docs(
        self, total_docs, addressed_docs, filename, scores, ignored_docs
    ) -> bool:
        if addressed_docs < total_docs:
            print(
                f"Warning: Only {addressed_docs}/{total_docs} documents have been addressed in {os.path.basename(filename)}"
                f" ({len(scores)} scored, {len(ignored_docs)} ignored)"
            )
            if not self.args.force:
                user_input = input("Process this file anyway? (Y/n): ").lower().strip()
                if user_input and user_input != "y":
                    return False
        elif self.debug_mode:
            print(
                f"All {total_docs} documents addressed: {len(scores)} scored, {len(ignored_docs)} ignored"
            )
        return True

    def _parse_scores_and_ignored(
        self, score_matches
    ) -> tuple[dict[int, int], set[int]]:
        scores = {}
        ignored_docs = set()
        for doc_idx, score_value in score_matches:
            doc_idx = int(doc_idx)
            if score_value.lower() == "ignore":
                ignored_docs.add(doc_idx)
                if self.debug_mode:
                    print(f"Document {doc_idx} marked as ignored")
            else:
                scores[doc_idx] = int(score_value)
        return scores, ignored_docs

    def parse_labeled_markdown(
        self, filepath: str
    ) -> tuple[str | None, str | None, list[dict[str, Any]]]:
        """Parse a labeled markdown file to extract query, judge, and document scores."""
        try:
            with open(filepath, encoding="utf-8") as f:
                content = f.read()
            content = content.replace("\r\n", "\n").replace("\r", "\n")
            content = re.sub(r"[\u200b-\u200d\ufeff]", "", content)
            query, judge = self._extract_query_and_judge(content, filepath)
            if not query or not judge:
                return None, None, []
            doc_sections = self._find_doc_sections(content)
            score_matches = self._find_score_matches(content)
            if self.debug_mode:
                print(f"Found {len(doc_sections)} document sections")
                print(f"Found {len(score_matches)} score matches")
            if not doc_sections:
                print(
                    f"Error: No document sections found in {os.path.basename(filepath)}"
                )
                print("Expected format: '### Document 1' followed by content")
                return None, None, []
            if not score_matches:
                print(
                    f"Error: No relevance scores found in {os.path.basename(filepath)}"
                )
                print(
                    "Expected format: '**Relevance Score** [Enter 0-3]: 2' or similar"
                )
                return None, None, []
            scores, ignored_docs = self._parse_scores_and_ignored(score_matches)
            total_docs = len(doc_sections)
            addressed_docs = len(scores) + len(ignored_docs)
            if not self._check_addressed_docs(
                total_docs, addressed_docs, filepath, scores, ignored_docs
            ):
                return None, None, []
            labeled_docs = self._process_document_sections(doc_sections, scores)
            return query, judge, labeled_docs
        except re.error as e:
            print(f"Regex error parsing file {filepath}: {e}")
            print("This may be due to special characters in the markdown content.")
            print("Try re-saving the file or check for invisible characters.")
            return None, None, []
        except UnicodeDecodeError as e:
            print(f"Unicode encoding error reading file {filepath}: {e}")
            print("Try saving the file with UTF-8 encoding.")
            return None, None, []
        except Exception as e:
            print(f"Unexpected error parsing file {filepath}: {e}")
            if self.debug_mode:
                import traceback

                traceback.print_exc()
            return None, None, []

    def _try_convert_numeric(self, value: str) -> Any:
        """Attempt to convert a string value to a float or int."""
        try:
            # Try converting to float first
            float_val = float(value)
            # If it's an integer, return as int
            if float_val.is_integer():
                return int(float_val)
            return float_val
        except (ValueError, TypeError):
            # If conversion fails, return the original string
            return value

    def allocate_documents(
        self, query: str, judge: str, labeled_docs: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Allocate documents between evaluation and fine-tuning datasets."""
        # Sort by relevance score (descending)
        labeled_docs.sort(key=lambda x: x["relevance"], reverse=True)

        # For evaluation dataset, include all documents with their scores
        evaluation_docs = []
        for doc in labeled_docs:
            # Process metadata for potential numeric conversion
            processed_metadata = {
                k: self._try_convert_numeric(v) for k, v in doc["metadata"].items()
            }

            evaluation_docs.append(
                {
                    "relevance": doc["relevance"],
                    "query": query,
                    "judge": judge,
                    "document": doc["text"],
                    "metadata": processed_metadata,
                    "site_id": self.site_id,
                    "library": processed_metadata.get("library", "UNKNOWN"),
                }
            )

        # For fine-tuning dataset, create binary labels
        fine_tuning_docs = []

        # Add positive examples (scores 2-3)
        positive_docs = [doc for doc in labeled_docs if doc["relevance"] >= 2]
        for doc in positive_docs:
            # Process metadata for potential numeric conversion
            processed_metadata = {
                k: self._try_convert_numeric(v) for k, v in doc["metadata"].items()
            }

            fine_tuning_docs.append(
                {
                    "label": 1.0,
                    "query": query,
                    "judge": judge,
                    "document": doc["text"],
                    "metadata": processed_metadata,
                    "site_id": self.site_id,
                    "library": processed_metadata.get("library", "UNKNOWN"),
                }
            )

        # Add negative examples (scores 0-1)
        negative_docs = [doc for doc in labeled_docs if doc["relevance"] <= 1]
        negative_count = min(len(positive_docs), len(negative_docs))
        for doc in negative_docs[:negative_count]:
            # Process metadata for potential numeric conversion
            processed_metadata = {
                k: self._try_convert_numeric(v) for k, v in doc["metadata"].items()
            }

            fine_tuning_docs.append(
                {
                    "label": 0.0,
                    "query": query,
                    "judge": judge,
                    "document": doc["text"],
                    "metadata": processed_metadata,
                    "site_id": self.site_id,
                    "library": processed_metadata.get("library", "UNKNOWN"),
                }
            )

        return evaluation_docs, fine_tuning_docs

    def save_to_jsonl(self, data: list[dict[str, Any]], output_file: str) -> None:
        """Save data to a JSONL file."""
        with open(output_file, "a") as f:
            for item in data:
                f.write(json.dumps(item) + "\n")
        if self.debug_mode:
            print(f"Saved {len(data)} items to {output_file}")

    def move_to_done(self, filepath: str) -> None:
        """Move processed file to the done directory. Never deletes the original file, always uses a unique name if needed."""
        filename = os.path.basename(filepath)
        done_path = os.path.join(self.done_dir, filename)

        # If file exists in done directory, create unique name (timestamped)
        if os.path.exists(done_path):
            base, ext = os.path.splitext(filename)
            import time

            timestamp = int(time.time())
            done_path = os.path.join(self.done_dir, f"{base}_{timestamp}{ext}")

        try:
            # Move (not delete) the file, preserving the original in done
            shutil.move(filepath, done_path)
            if self.debug_mode:
                print(
                    f"Moved {filename} to done directory as {os.path.basename(done_path)}"
                )
        except Exception as e:
            print(f"Error moving file to done directory: {e}")

    def _count_lines(self, filepath: str) -> int:
        """Count the number of lines in a file."""
        try:
            with open(filepath) as f:
                return sum(1 for _ in f)
        except FileNotFoundError:
            return 0

    def process_files(self):
        """Process all completed markdown and docx files from the todo directory."""
        completed_files = self.find_completed_files()

        if not completed_files:
            print("No completed files found.")
            return

        print(f"Found {len(completed_files)} completed files")

        evaluation_added = 0
        fine_tuning_added = 0

        for filepath, ftype in completed_files:
            filename = os.path.basename(filepath)
            print(f"\nProcessing {filename}...")
            md_path = filepath
            docx_to_move = None
            # If docx, convert to md first
            if ftype == "docx":
                md_path = self.convert_docx_to_md(filepath)
                docx_to_move = filepath
                if not md_path or not os.path.exists(md_path):
                    print(f"Skipping {filename} due to conversion error")
                    continue
            # Now process the markdown file as normal
            query, judge, labeled_docs = self.parse_labeled_markdown(md_path)
            if not query or not judge or not labeled_docs:
                print(
                    f"Skipping {filename} due to parsing errors - file remains in todo directory"
                )
                # Files with parsing errors should NOT be moved to done directory
                # They should remain in todo directory for correction
                # If we converted docx to md, clean up the temporary md file
                if ftype == "docx" and md_path != filepath:
                    try:
                        os.remove(md_path)
                        if self.debug_mode:
                            print(
                                f"Cleaned up temporary md file: {os.path.basename(md_path)}"
                            )
                    except Exception as e:
                        print(
                            f"Warning: Could not clean up temporary file {md_path}: {e}"
                        )
                continue
            evaluation_docs, fine_tuning_docs = self.allocate_documents(
                query, judge, labeled_docs
            )
            self.save_to_jsonl(evaluation_docs, self.evaluation_output)
            self.save_to_jsonl(fine_tuning_docs, self.fine_tuning_output)
            evaluation_added += len(evaluation_docs)
            fine_tuning_added += len(fine_tuning_docs)
            # Move both files to done if docx, just md if md
            if ftype == "docx":
                self.move_to_done(md_path)
                self.move_to_done(docx_to_move)
            else:
                self.move_to_done(md_path)
        # Get total counts from files
        total_evaluation = self._count_lines(self.evaluation_output)
        total_fine_tuning = self._count_lines(self.fine_tuning_output)
        print("\nProcessing complete!")
        print(f"Added {evaluation_added} evaluation examples")
        print(f"Added {fine_tuning_added} fine-tuning examples")
        print("\nCurrent totals in output files:")
        print(
            f"- Evaluation dataset ({self.evaluation_output}): {total_evaluation} examples"
        )
        print(
            f"- Fine-tuning dataset ({self.fine_tuning_output}): {total_fine_tuning} examples"
        )


def main():
    parser = argparse.ArgumentParser(
        description="Process completed markdown files for document relevance labeling"
    )
    parser.add_argument(
        "--site", type=str, required=True, help="Site ID to use for filtering documents"
    )
    parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode with additional output"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Process files even if not all documents are scored",
    )
    args = parser.parse_args()

    processor = MarkdownProcessor(args)
    processor.process_files()


if __name__ == "__main__":
    main()
