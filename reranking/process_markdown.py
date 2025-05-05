#!/usr/bin/env python3
"""
Document Relevance Label Processor

This script processes completed markdown files by:
1. Finding files marked as done in the markdown directory
2. Parsing the relevance scores
3. Creating evaluation and fine-tuning datasets
4. Moving processed files to the done directory
"""

import os
import sys
import json
import re
import shutil
import argparse
from typing import List, Dict, Any, Tuple, Optional

# Constants
DONE_PATTERN = r'Done\? \(y/yes\): *(y|yes)\s'
QUERY_PATTERN = r'# Query: (.*?)\n'
JUDGE_PATTERN = r'Judge: *(.*?)\n'
DEFAULT_RETRIEVAL_COUNT = 20

class MarkdownProcessor:
    def __init__(self, args):
        self.args = args
        self.site_id = args.site
        self.debug_mode = args.debug
        
        # Set up directories
        self.markdown_dir = f"reranking/markdown_files/{self.site_id}"
        self.done_dir = os.path.join(self.markdown_dir, "done")
        self.evaluation_output = f"reranking/evaluation_dataset_{self.site_id}.jsonl"
        self.fine_tuning_output = f"reranking/fine_tuning_dataset_{self.site_id}.jsonl"
        
        self._initialize_directories()
        
        if self.debug_mode:
            print("Debug mode enabled - verbose logging active")
            print(f"Working with site: {self.site_id}")
            print(f"Markdown directory: {self.markdown_dir}")
            print(f"Done directory: {self.done_dir}")
            
    def _initialize_directories(self):
        """Ensure all necessary directories exist."""
        os.makedirs(self.done_dir, exist_ok=True)
            
    def find_completed_files(self) -> List[str]:
        """Find markdown files that are marked as done."""
        completed_files = []
        
        if not os.path.exists(self.markdown_dir):
            print(f"Warning: Markdown directory not found: {self.markdown_dir}")
            return []
            
        for filename in os.listdir(self.markdown_dir):
            if not filename.endswith('.md'):
                continue
                
            filepath = os.path.join(self.markdown_dir, filename)
            if os.path.isfile(filepath):
                try:
                    with open(filepath, 'r') as f:
                        content = f.read()
                        
                    # Check if file is marked as done
                    if re.search(DONE_PATTERN, content, re.IGNORECASE):
                        completed_files.append(filepath)
                        
                except Exception as e:
                    print(f"Error reading file {filename}: {e}")
                    
        return completed_files
        
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
        text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
        return text

    def parse_labeled_markdown(self, filepath: str) -> Tuple[Optional[str], Optional[str], List[Dict[str, Any]]]:
        """Parse a labeled markdown file to extract query, judge, and document scores."""
        try:
            with open(filepath, 'r') as f:
                content = f.read()
                
            # Extract judge
            judge_match = re.search(JUDGE_PATTERN, content)
            if not judge_match or not judge_match.group(1).strip():
                print(f"Warning: No judge name found in {filepath}")
                return None, None, []
                
            judge = self._clean_string(judge_match.group(1))
                
            # Extract query
            query_match = re.search(QUERY_PATTERN, content)
            if not query_match:
                print(f"Warning: No query found in {filepath}")
                return None, None, []
                
            query = self._clean_string(query_match.group(1))
            
            # Find all document sections
            doc_pattern = r'### Document (\d+)\s*\n\n(.*?)(?=\n\n\*Scoring:)'
            doc_sections = re.findall(doc_pattern, content, re.DOTALL)
            
            # Extract scores
            score_pattern = r'Document (\d+).*?\*Scoring:.*?\*\*Relevance Score\*\* \[Enter 0-3\]: (\d)'
            score_matches = re.findall(score_pattern, content, re.DOTALL)
            
            # Convert scores to dictionary
            scores = {int(doc_idx): int(score) for doc_idx, score in score_matches}
            
            # Process documents
            labeled_docs = []
            total_docs = len(doc_sections)
            answered_docs = len(scores)
            
            if answered_docs < total_docs:
                print(f"Warning: Only {answered_docs}/{total_docs} documents have scores in {os.path.basename(filepath)}")
                if not self.args.force:
                    user_input = input("Process this file anyway? (y/n): ").lower()
                    if user_input != 'y':
                        return None, None, []
            
            for doc_idx_str, doc_content in doc_sections:
                doc_idx = int(doc_idx_str)
                
                if doc_idx not in scores:
                    print(f"Warning: Document {doc_idx} has no score")
                    continue
                    
                score = scores[doc_idx]
                
                # Extract metadata
                metadata = {}
                metadata_section = re.search(r'\*Metadata:\*\n(.*?)(?=\n\n|$)', doc_content, re.DOTALL)
                if metadata_section:
                    metadata_text = metadata_section.group(1)
                    metadata_matches = re.findall(r'\*\*(.*?)\*\*: (.*?)(?:\n|$)', metadata_text)
                    # Clean metadata values
                    metadata = {k: self._clean_string(v) for k, v in metadata_matches}
                
                # Extract main content (everything before metadata section)
                content_text = doc_content
                if metadata_section:
                    content_text = doc_content[:metadata_section.start()].strip()
                
                # Clean markdown formatting from content text
                content_text = self._clean_markdown(content_text)
                
                doc = {
                    "text": content_text,
                    "relevance": score,
                    "metadata": metadata
                }
                labeled_docs.append(doc)
            
            return query, judge, labeled_docs
            
        except Exception as e:
            print(f"Error parsing file {filepath}: {e}")
            return None, None, []
            
    def allocate_documents(self, query: str, judge: str, labeled_docs: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Allocate documents between evaluation and fine-tuning datasets."""
        # Sort by relevance score (descending)
        labeled_docs.sort(key=lambda x: x["relevance"], reverse=True)
        
        # For evaluation dataset, include all documents with their scores
        evaluation_docs = []
        for doc in labeled_docs:
            evaluation_docs.append({
                "relevance": doc["relevance"],
                "query": query,
                "judge": judge,
                "document": doc["text"],
                "metadata": doc["metadata"],
                "site_id": self.site_id,
                "library": doc["metadata"].get("library", "UNKNOWN")
            })
            
        # For fine-tuning dataset, create binary labels
        fine_tuning_docs = []
        
        # Add positive examples (scores 2-3)
        positive_docs = [doc for doc in labeled_docs if doc["relevance"] >= 2]
        for doc in positive_docs:
            fine_tuning_docs.append({
                "label": 1.0,
                "query": query,
                "judge": judge,
                "document": doc["text"],
                "metadata": doc["metadata"],
                "site_id": self.site_id,
                "library": doc["metadata"].get("library", "UNKNOWN")
            })
            
        # Add negative examples (scores 0-1)
        negative_docs = [doc for doc in labeled_docs if doc["relevance"] <= 1]
        negative_count = min(len(positive_docs), len(negative_docs))
        for doc in negative_docs[:negative_count]:
            fine_tuning_docs.append({
                "label": 0.0,
                "query": query,
                "judge": judge,
                "document": doc["text"],
                "metadata": doc["metadata"],
                "site_id": self.site_id,
                "library": doc["metadata"].get("library", "UNKNOWN")
            })
            
        return evaluation_docs, fine_tuning_docs
        
    def save_to_jsonl(self, data: List[Dict[str, Any]], output_file: str) -> None:
        """Save data to a JSONL file."""
        with open(output_file, 'a') as f:
            for item in data:
                f.write(json.dumps(item) + '\n')
        if self.debug_mode:
            print(f"Saved {len(data)} items to {output_file}")
            
    def move_to_done(self, filepath: str) -> None:
        """Move processed file to the done directory."""
        filename = os.path.basename(filepath)
        done_path = os.path.join(self.done_dir, filename)
        
        # If file exists in done directory, create unique name
        if os.path.exists(done_path):
            base, ext = os.path.splitext(filename)
            import time
            timestamp = int(time.time())
            done_path = os.path.join(self.done_dir, f"{base}_{timestamp}{ext}")
            
        try:
            shutil.move(filepath, done_path)
            if self.debug_mode:
                print(f"Moved {filename} to done directory")
        except Exception as e:
            print(f"Error moving file to done directory: {e}")
            
    def _count_lines(self, filepath: str) -> int:
        """Count the number of lines in a file."""
        try:
            with open(filepath, 'r') as f:
                return sum(1 for _ in f)
        except FileNotFoundError:
            return 0
            
    def process_files(self):
        """Process all completed markdown files."""
        completed_files = self.find_completed_files()
        
        if not completed_files:
            print("No completed files found.")
            return
            
        print(f"Found {len(completed_files)} completed files")
        
        evaluation_added = 0
        fine_tuning_added = 0
        
        for filepath in completed_files:
            filename = os.path.basename(filepath)
            print(f"\nProcessing {filename}...")
            
            query, judge, labeled_docs = self.parse_labeled_markdown(filepath)
            if not query or not judge or not labeled_docs:
                print(f"Skipping {filename} due to parsing errors")
                continue
                
            evaluation_docs, fine_tuning_docs = self.allocate_documents(query, judge, labeled_docs)
            
            self.save_to_jsonl(evaluation_docs, self.evaluation_output)
            self.save_to_jsonl(fine_tuning_docs, self.fine_tuning_output)
            
            evaluation_added += len(evaluation_docs)
            fine_tuning_added += len(fine_tuning_docs)
            
            self.move_to_done(filepath)
            
        # Get total counts from files
        total_evaluation = self._count_lines(self.evaluation_output)
        total_fine_tuning = self._count_lines(self.fine_tuning_output)
            
        print(f"\nProcessing complete!")
        print(f"Added {evaluation_added} evaluation examples")
        print(f"Added {fine_tuning_added} fine-tuning examples")
        print(f"\nCurrent totals in output files:")
        print(f"- Evaluation dataset ({self.evaluation_output}): {total_evaluation} examples")
        print(f"- Fine-tuning dataset ({self.fine_tuning_output}): {total_fine_tuning} examples")

def main():
    parser = argparse.ArgumentParser(description="Process completed markdown files for document relevance labeling")
    parser.add_argument("--site", type=str, required=True, help="Site ID to use for filtering documents")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode with additional output")
    parser.add_argument("--force", action="store_true", help="Process files even if not all documents are scored")
    args = parser.parse_args()
    
    processor = MarkdownProcessor(args)
    processor.process_files()

if __name__ == "__main__":
    main() 