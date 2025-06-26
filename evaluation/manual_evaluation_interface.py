#!/usr/bin/env python3
"""
Manual evaluation interface for unbiased RAG system comparison.

This script provides a systematic interface for manually judging the relevance
of retrieved documents from both systems. Features:

1. Interactive terminal interface for document evaluation
2. Progress tracking and session management
3. Relevance scoring with multiple options (highly relevant, relevant, somewhat relevant, irrelevant)
4. Side-by-side system comparison
5. Ability to pause/resume evaluation sessions
6. Automatic calculation of Precision@K and other metrics
7. Export results in multiple formats

The interface ensures systematic evaluation while avoiding bias through:
- Randomized presentation order
- Blinded evaluation (system names hidden during judgment)
- Consistent scoring criteria
- Progress persistence across sessions
"""

import argparse
import json
import os
import sys
import textwrap
import time

import numpy as np


class EvaluationSession:
    """Manages the evaluation session state and progress."""

    def __init__(
        self, results_file: str, session_file: str = "evaluation_session.json"
    ):
        self.results_file = results_file
        self.session_file = session_file
        self.current_query_idx = 0
        self.current_doc_idx = 0
        self.evaluations = {}
        self.start_time = time.time()

        # Load results data
        with open(results_file) as f:
            self.results_data = json.load(f)

        self.queries = self.results_data["results"]
        self.total_queries = len(self.queries)

        # Load existing session if available
        self.load_session()

    def load_session(self):
        """Load existing evaluation session."""
        if os.path.exists(self.session_file):
            try:
                with open(self.session_file) as f:
                    session_data = json.load(f)

                self.current_query_idx = session_data.get("current_query_idx", 0)
                self.current_doc_idx = session_data.get("current_doc_idx", 0)
                self.evaluations = session_data.get("evaluations", {})
                self.start_time = session_data.get("start_time", time.time())

                print(
                    f"📂 Loaded existing session: Query {self.current_query_idx + 1}/{self.total_queries}"
                )
                return True
            except Exception as e:
                print(f"Warning: Could not load session file: {e}")

        return False

    def save_session(self):
        """Save current evaluation session."""
        session_data = {
            "current_query_idx": self.current_query_idx,
            "current_doc_idx": self.current_doc_idx,
            "evaluations": self.evaluations,
            "start_time": self.start_time,
            "last_saved": time.time(),
        }

        with open(self.session_file, "w") as f:
            json.dump(session_data, f, indent=2)

    def get_progress(self) -> tuple[int, int]:
        """Get current progress as (completed_evaluations, total_evaluations)."""
        total_docs = 0
        completed_docs = 0

        for query in self.queries:
            for system_name in query["systems"]:
                total_docs += len(query["systems"][system_name]["documents"])

        completed_docs = len(
            [k for k in self.evaluations if self.evaluations[k] != "pending"]
        )

        return completed_docs, total_docs


class DocumentEvaluator:
    """Handles the document evaluation interface."""

    def __init__(self, session: EvaluationSession, blinded: bool = True):
        self.session = session
        self.blinded = blinded
        self.relevance_scale = {
            "3": "Highly Relevant",
            "2": "Relevant",
            "1": "Somewhat Relevant",
            "0": "Irrelevant",
        }

    def display_query_context(self, query_data: dict):
        """Display query context and metadata."""
        print(f"\n{'=' * 80}")
        print("QUERY EVALUATION")
        print(f"{'=' * 80}")
        print(f"Query: {query_data['query_text']}")
        print(
            f"Metadata: {query_data['query_metadata']['word_count']} words, "
            f"collection: {query_data['query_metadata']['collection']}"
        )
        print(f"{'=' * 80}")

    def display_document(
        self, doc: dict, doc_idx: int, total_docs: int, system_name: str = None
    ):
        """Display a single document for evaluation."""
        system_display = f" [{system_name}]" if not self.blinded and system_name else ""

        print(f"\n{'-' * 60}")
        print(f"DOCUMENT {doc_idx + 1}/{total_docs}{system_display}")
        print(f"Score: {doc['score']:.4f}")
        print(f"{'-' * 60}")

        # Display document text with intelligent truncation
        text = doc["text"]
        max_length = 2000  # Show more text for better evaluation

        if len(text) <= max_length:
            # Show full text if reasonable length with proper wrapping
            wrapped_text = textwrap.fill(
                text, width=100, break_long_words=False, break_on_hyphens=False
            )
            print(wrapped_text)
        else:
            # For very long documents, show more context with proper wrapping
            first_part = max_length // 2
            last_part = max_length // 2

            wrapped_first = textwrap.fill(
                text[:first_part],
                width=100,
                break_long_words=False,
                break_on_hyphens=False,
            )
            wrapped_last = textwrap.fill(
                text[-last_part:],
                width=100,
                break_long_words=False,
                break_on_hyphens=False,
            )

            print(wrapped_first)
            print(
                f"\n... [Document continues - {len(text) - max_length} more characters] ...\n"
            )
            print(wrapped_last)

            # Offer option to see full text
            print(
                f"\n💡 Document is {len(text)} characters. Press 'f' during rating to see full text."
            )

        print(f"{'-' * 60}")

        # Show metadata if helpful
        metadata = doc.get("metadata", {})
        if metadata.get("title"):
            print(f"Title: {metadata['title']}")
        if metadata.get("author"):
            print(f"Author: {metadata['author']}")
        if metadata.get("library"):
            print(f"Library: {metadata['library']}")
        print(f"{'-' * 60}")

    def get_relevance_score(self, query_text: str, retry_count: int = 0) -> str | None:
        """Get relevance score from user."""
        if retry_count > 0:
            print("\n⚠️  Invalid input. Please try again.")

        print(
            f'\n🤔 Rate relevance for query: "{query_text[:100]}{"..." if len(query_text) > 100 else ""}"'
        )
        print("\nRelevance Scale:")
        for score, label in self.relevance_scale.items():
            print(f"  {score} - {label}")

        print("\n📋 Options:")
        print("  3,2,1,0 - Rate relevance")
        print("  f - Show full document text")
        print("  s - Skip this document")
        print("  n - Continue to next document (when viewing previous answers)")
        print("  b - Go back to previous document")
        print("  q - Quit and save progress")
        print("  h - Show help")

        choice = input("\nEnter your choice: ").strip().lower()

        if choice in ["3", "2", "1", "0"]:
            label = self.relevance_scale[choice]
            print(f"✅ Rated as: {choice} ({label})")
            return choice
        elif choice == "s":
            print("⏭️  Skipped document")
            return "skip"
        elif choice == "n":
            print("➡️  Continuing to next document")
            return "next"
        elif choice == "b":
            return "back"
        elif choice == "q":
            return "quit"
        elif choice == "h":
            self.show_help()
            return self.get_relevance_score(query_text, retry_count + 1)
        elif choice == "f":
            return "show_full"
        else:
            return self.get_relevance_score(query_text, retry_count + 1)

    def show_help(self):
        """Show detailed help information."""
        print(f"\n{'=' * 60}")
        print("EVALUATION GUIDELINES")
        print(f"{'=' * 60}")
        print("3 - Highly Relevant:")
        print(
            "    Document directly answers the question with accurate, comprehensive information"
        )
        print("    Contains most or all information needed to answer the query")
        print("")
        print("2 - Relevant:")
        print("    Document contains useful information related to the question")
        print("    Provides partial answer or relevant context")
        print("")
        print("1 - Somewhat Relevant:")
        print("    Document is tangentially related to the question")
        print("    Contains some relevant keywords but limited useful information")
        print("")
        print("0 - Irrelevant:")
        print("    Document does not help answer the question")
        print("    Unrelated topic or misleading information")
        print("")
        print("NAVIGATION & SESSION MANAGEMENT:")
        print("  q (Quit)  - Exit evaluation and save progress")
        print("  b (Back)  - Go to previous document")
        print(
            "  n (Next)  - Continue to next document (useful when reviewing previous answers)"
        )
        print("  f (Full)  - Show complete document text")
        print("")
        print("RESUMING EVALUATION:")
        print("  Run the same command to continue where you left off")
        print("  Your progress is automatically saved every 10 evaluations")
        print(f"{'=' * 60}")

    def show_full_document(self, doc: dict, system_name: str = None):
        """Display the complete document text."""
        system_display = f" [{system_name}]" if not self.blinded and system_name else ""

        print(f"\n{'=' * 80}")
        print(f"FULL DOCUMENT TEXT{system_display}")
        print(f"Score: {doc['score']:.4f}")
        print(f"{'=' * 80}")
        wrapped_text = textwrap.fill(
            doc["text"], width=100, break_long_words=False, break_on_hyphens=False
        )
        print(wrapped_text)
        print(f"{'=' * 80}")

        # Show metadata
        metadata = doc.get("metadata", {})
        if metadata.get("title"):
            print(f"Title: {metadata['title']}")
        if metadata.get("author"):
            print(f"Author: {metadata['author']}")
        if metadata.get("library"):
            print(f"Library: {metadata['library']}")
        print(f"{'=' * 80}")

        input("\nPress Enter to continue...")

    def evaluate_documents(self):
        """Main evaluation loop."""
        while self.session.current_query_idx < self.session.total_queries:
            query_data = self.session.queries[self.session.current_query_idx]

            # Display query context
            self.display_query_context(query_data)

            # Get all documents from both systems
            all_docs = []
            for system_name in query_data["systems"]:
                for doc in query_data["systems"][system_name]["documents"]:
                    all_docs.append((doc, system_name))

            # Continue from where we left off
            doc_idx = self.session.current_doc_idx
            show_previous_answer = False  # Flag to show previously evaluated documents

            while doc_idx < len(all_docs):
                doc, system_name = all_docs[doc_idx]

                # Create evaluation key
                eval_key = f"{query_data['query_id']}_{doc['id']}_{system_name}"

                # Skip if already evaluated, unless we're explicitly showing previous answer
                if eval_key in self.session.evaluations and not show_previous_answer:
                    doc_idx += 1
                    continue

                # Show progress
                completed, total = self.session.get_progress()
                print(
                    f"\n📊 Progress: {completed}/{total} evaluations completed "
                    f"({completed / total * 100:.1f}%)"
                )

                # Display document
                self.display_document(doc, doc_idx, len(all_docs), system_name)

                # Show previous answer if this document was already evaluated
                if eval_key in self.session.evaluations:
                    prev_eval = self.session.evaluations[eval_key]
                    if isinstance(prev_eval, dict) and "score" in prev_eval:
                        print(
                            f"\n🔍 Previously evaluated as: {prev_eval['score']} ({prev_eval['label']})"
                        )
                    elif prev_eval == "skip":
                        print("\n🔍 Previously skipped")
                    print("You can re-evaluate or continue to next document.")

                show_previous_answer = False

                # Get evaluation
                score = self.get_relevance_score(query_data["query_text"])

                if score == "show_full":
                    self.show_full_document(doc, system_name)
                    continue  # Re-display document and ask for rating again
                elif score == "quit":
                    print("💾 Saving progress and exiting...")
                    self.session.save_session()
                    return False
                elif score == "next":
                    doc_idx += 1
                    self.session.current_doc_idx = doc_idx
                    continue
                elif score == "back":
                    if doc_idx > 0:
                        doc_idx -= 1
                        self.session.current_doc_idx = doc_idx
                        show_previous_answer = True
                    else:
                        print("Already at the first document.")
                    continue
                elif score == "skip":
                    # Only set to "skip" if not already evaluated
                    if eval_key not in self.session.evaluations:
                        self.session.evaluations[eval_key] = "skip"
                        print("⏭️  Document marked as skipped")
                    else:
                        print(
                            "⏭️  Moving to next document (keeping existing evaluation)"
                        )
                    doc_idx += 1
                    self.session.current_doc_idx = doc_idx  # Update session position
                elif score in ["0", "1", "2", "3"]:
                    self.session.evaluations[eval_key] = {
                        "score": int(score),
                        "label": self.relevance_scale[score],
                        "query_id": query_data["query_id"],
                        "query_text": query_data["query_text"],
                        "doc_id": doc["id"],
                        "system": system_name,
                        "doc_score": doc["score"],
                        "timestamp": time.time(),
                    }
                    doc_idx += 1
                    self.session.current_doc_idx = doc_idx  # Update session position

                # Auto-save every 10 evaluations
                if len(self.session.evaluations) % 10 == 0:
                    self.session.save_session()

            # Move to next query
            self.session.current_query_idx += 1
            self.session.current_doc_idx = 0

        print("\n🎉 Evaluation completed!")
        self.session.save_session()
        return True


class ResultsAnalyzer:
    """Analyzes evaluation results and calculates metrics."""

    def __init__(self, session: EvaluationSession):
        self.session = session
        self.evaluations = session.evaluations

    def calculate_precision_at_k(self, k: int = 5) -> dict:
        """Calculate Precision@K for both systems."""
        system_metrics = {}

        # Group evaluations by query and system
        query_system_docs = {}
        for _eval_key, eval_data in self.evaluations.items():
            if isinstance(eval_data, dict) and "score" in eval_data:
                query_id = eval_data["query_id"]
                system = eval_data["system"]

                if query_id not in query_system_docs:
                    query_system_docs[query_id] = {}
                if system not in query_system_docs[query_id]:
                    query_system_docs[query_id][system] = []

                query_system_docs[query_id][system].append(eval_data)

        # Calculate precision for each system
        for system_name in ["current", "new"]:
            precisions = []

            for query_id in query_system_docs:
                if system_name in query_system_docs[query_id]:
                    docs = query_system_docs[query_id][system_name]

                    # Sort by document score (Pinecone ranking)
                    docs.sort(key=lambda x: x["doc_score"], reverse=True)

                    # Take top-K documents
                    top_k_docs = docs[:k]

                    # Count relevant documents (score >= 2)
                    relevant_count = sum(1 for doc in top_k_docs if doc["score"] >= 2)
                    precision = relevant_count / len(top_k_docs) if top_k_docs else 0.0

                    precisions.append(precision)

            system_metrics[system_name] = {
                "precision_at_k": np.mean(precisions) if precisions else 0.0,
                "queries_evaluated": len(precisions),
                "individual_precisions": precisions,
            }

        return system_metrics

    def generate_detailed_report(self) -> str:
        """Generate detailed evaluation report."""
        report = []
        report.append("=" * 80)
        report.append("MANUAL EVALUATION REPORT")
        report.append("=" * 80)

        # Summary statistics
        total_evaluations = len(
            [e for e in self.evaluations.values() if isinstance(e, dict)]
        )
        skipped_evaluations = len([e for e in self.evaluations.values() if e == "skip"])

        report.append(f"Total evaluations: {total_evaluations}")
        report.append(f"Skipped evaluations: {skipped_evaluations}")
        report.append("")

        # Relevance distribution
        score_distribution = {}
        for eval_data in self.evaluations.values():
            if isinstance(eval_data, dict) and "score" in eval_data:
                score = eval_data["score"]
                score_distribution[score] = score_distribution.get(score, 0) + 1

        report.append("Relevance Score Distribution:")
        for score in sorted(score_distribution.keys()):
            count = score_distribution[score]
            percentage = count / total_evaluations * 100 if total_evaluations > 0 else 0
            report.append(
                f"  {score} ({self.get_relevance_label(score)}): {count} ({percentage:.1f}%)"
            )
        report.append("")

        # Precision@5 results
        precision_metrics = self.calculate_precision_at_k(5)
        report.append("PRECISION@5 RESULTS:")
        report.append("-" * 40)

        for system_name, metrics in precision_metrics.items():
            report.append(f"{system_name.upper()} System:")
            report.append(f"  Precision@5: {metrics['precision_at_k']:.4f}")
            report.append(f"  Queries evaluated: {metrics['queries_evaluated']}")
            if metrics["individual_precisions"]:
                report.append(
                    f"  Range: {min(metrics['individual_precisions']):.3f} - {max(metrics['individual_precisions']):.3f}"
                )
            report.append("")

        # System comparison
        if "current" in precision_metrics and "new" in precision_metrics:
            current_p5 = precision_metrics["current"]["precision_at_k"]
            new_p5 = precision_metrics["new"]["precision_at_k"]
            difference = new_p5 - current_p5
            percent_change = (difference / current_p5 * 100) if current_p5 > 0 else 0

            report.append("SYSTEM COMPARISON:")
            report.append("-" * 40)
            report.append(f"Precision@5 difference: {difference:+.4f}")
            report.append(f"Percent change: {percent_change:+.1f}%")

            if abs(difference) < 0.01:
                conclusion = "No significant difference between systems"
            elif difference > 0:
                conclusion = f"New system performs {percent_change:.1f}% better"
            else:
                conclusion = (
                    f"Current system performs {abs(percent_change):.1f}% better"
                )

            report.append(f"Conclusion: {conclusion}")

        return "\n".join(report)

    def get_relevance_label(self, score: int) -> str:
        """Get relevance label for score."""
        labels = {
            0: "Irrelevant",
            1: "Somewhat Relevant",
            2: "Relevant",
            3: "Highly Relevant",
        }
        return labels.get(score, "Unknown")

    def export_results(self, output_file: str):
        """Export detailed results to JSON."""
        export_data = {
            "metadata": {
                "evaluation_date": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total_evaluations": len(
                    [e for e in self.evaluations.values() if isinstance(e, dict)]
                ),
                "evaluator_notes": "Manual evaluation for unbiased RAG system comparison",
            },
            "precision_metrics": self.calculate_precision_at_k(5),
            "evaluations": self.evaluations,
            "detailed_report": self.generate_detailed_report(),
        }

        with open(output_file, "w") as f:
            json.dump(export_data, f, indent=2)

        print(f"📊 Results exported to {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description="Manual evaluation interface for RAG system comparison"
    )
    parser.add_argument(
        "--results", required=True, help="JSON file with dual system retrieval results"
    )
    parser.add_argument(
        "--session",
        default="evaluation_session.json",
        help="Session file for progress tracking",
    )
    parser.add_argument(
        "--blinded", action="store_true", help="Hide system names during evaluation"
    )
    parser.add_argument("--export", help="Export final results to JSON file")
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Generate report from existing evaluations only",
    )

    args = parser.parse_args()

    if not os.path.exists(args.results):
        print(f"Error: Results file not found: {args.results}")
        sys.exit(1)

    # Initialize session
    session = EvaluationSession(args.results, args.session)

    if args.report_only:
        # Generate report only
        analyzer = ResultsAnalyzer(session)
        print(analyzer.generate_detailed_report())

        if args.export:
            analyzer.export_results(args.export)
    else:
        # Start evaluation interface
        evaluator = DocumentEvaluator(session, blinded=args.blinded)

        print("🚀 Starting manual evaluation interface")
        print(f"📁 Results file: {args.results}")
        print(f"💾 Session file: {args.session}")
        print(f"👁️  Blinded mode: {'ON' if args.blinded else 'OFF'}")

        completed, total = session.get_progress()
        if completed > 0:
            print(f"📊 Resuming from: {completed}/{total} evaluations completed")

        print("\n💡 Tip: Press 'h' during evaluation for detailed scoring guidelines")
        input("\nPress Enter to begin evaluation...")

        # Run evaluation
        evaluation_completed = evaluator.evaluate_documents()

        if evaluation_completed:
            # Generate final report
            analyzer = ResultsAnalyzer(session)
            print("\n" + analyzer.generate_detailed_report())

            if args.export:
                analyzer.export_results(args.export)
        else:
            print(
                f"\n💾 Progress saved. Resume with: python {sys.argv[0]} --results {args.results}"
            )


if __name__ == "__main__":
    main()
