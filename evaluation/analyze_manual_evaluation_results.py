#!/usr/bin/env python3
"""
Step 4: Results Analysis for Dual System Evaluation Pipeline

Analyzes human judgments from manual evaluation to determine which embedding system performs better.
Computes statistical performance metrics and provides deployment recommendations.

Usage:
    python analyze_manual_evaluation_results.py \
        --session-file evaluation_session.json \
        --output-report final_report.md \
        --output-json results_summary.json
"""

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np
import scipy.stats


@dataclass
class SystemMetrics:
    """Performance metrics for a single system."""

    name: str
    precision_at_1: float
    precision_at_3: float
    precision_at_5: float
    precision_at_1_lenient: float
    precision_at_3_lenient: float
    precision_at_5_lenient: float
    ndcg_at_1: float
    ndcg_at_3: float
    ndcg_at_5: float
    avg_relevance_score: float
    total_documents: int
    evaluated_documents: int
    skip_rate: float


@dataclass
class ComparisonResult:
    """Statistical comparison between two systems."""

    metric_name: str
    system1_value: float
    system2_value: float
    difference: float
    percent_improvement: float
    p_value: float
    is_significant: bool
    effect_size: float
    confidence_interval: tuple[float, float]


def load_evaluation_session(session_file: str) -> dict[str, Any]:
    """Load the evaluation session data."""
    with open(session_file) as f:
        return json.load(f)


def parse_evaluation_key(key: str) -> tuple[str, str, str]:
    """Parse evaluation key to extract query_id, doc_id, and system."""
    # Format: query_id_doc_id_system
    parts = key.split("_")
    system = parts[-1]
    query_id = parts[0]
    doc_id = "_".join(parts[1:-1])
    return query_id, doc_id, system


def extract_evaluation_data(session_data: dict[str, Any]) -> dict[str, dict]:
    """Extract and organize evaluation data by query and system."""
    evaluations = session_data.get("evaluations", {})

    # Organize data: query_id -> system -> [documents]
    query_data = defaultdict(lambda: defaultdict(list))

    for eval_key, eval_result in evaluations.items():
        if eval_result == "skip":
            continue

        query_id, doc_id, system = parse_evaluation_key(eval_key)

        doc_info = {
            "doc_id": doc_id,
            "score": eval_result["score"],
            "doc_score": eval_result.get("doc_score", 0),
            "timestamp": eval_result.get("timestamp", 0),
        }

        query_data[query_id][system].append(doc_info)

    return dict(query_data)


def calculate_precision_at_k(
    documents: list[dict], k: int, threshold: int = 3
) -> float:
    """Calculate Precision@K with given relevance threshold."""
    if len(documents) == 0:
        return 0.0

    # Sort by document score (retrieval ranking)
    sorted_docs = sorted(documents, key=lambda x: x["doc_score"], reverse=True)

    # Take top-k documents
    top_k = sorted_docs[:k]

    # Count relevant documents (score >= threshold)
    relevant_count = sum(1 for doc in top_k if doc["score"] >= threshold)

    return relevant_count / len(top_k)


def calculate_ndcg_at_k(documents: list[dict], k: int) -> float:
    """Calculate Normalized Discounted Cumulative Gain at K."""
    if len(documents) == 0:
        return 0.0

    # Sort by document score (retrieval ranking)
    sorted_docs = sorted(documents, key=lambda x: x["doc_score"], reverse=True)

    # Take top-k documents
    top_k = sorted_docs[:k]

    # Calculate DCG
    dcg = 0.0
    for i, doc in enumerate(top_k):
        relevance = doc["score"]  # Human judgment score (0-4)
        dcg += (2**relevance - 1) / math.log2(i + 2)  # i+2 because log2(1) is undefined

    # Calculate IDCG (ideal DCG)
    ideal_scores = sorted([doc["score"] for doc in documents], reverse=True)[:k]
    idcg = 0.0
    for i, score in enumerate(ideal_scores):
        idcg += (2**score - 1) / math.log2(i + 2)

    return dcg / idcg if idcg > 0 else 0.0


def calculate_system_metrics(
    query_data: dict[str, dict], system_name: str
) -> SystemMetrics:
    """Calculate comprehensive metrics for a system."""
    all_documents = []
    total_docs = 0
    evaluated_docs = 0
    skip_count = 0

    precision_1_scores = []
    precision_3_scores = []
    precision_5_scores = []
    precision_1_lenient_scores = []
    precision_3_lenient_scores = []
    precision_5_lenient_scores = []
    ndcg_1_scores = []
    ndcg_3_scores = []
    ndcg_5_scores = []

    for _query_id, systems in query_data.items():
        if system_name not in systems:
            continue

        documents = systems[system_name]
        total_docs += len(documents)
        evaluated_docs += len([d for d in documents if d["score"] >= 0])

        all_documents.extend(documents)

        # Calculate per-query metrics
        precision_1_scores.append(calculate_precision_at_k(documents, 1, threshold=3))
        precision_3_scores.append(calculate_precision_at_k(documents, 3, threshold=3))
        precision_5_scores.append(calculate_precision_at_k(documents, 5, threshold=3))
        precision_1_lenient_scores.append(
            calculate_precision_at_k(documents, 1, threshold=2)
        )
        precision_3_lenient_scores.append(
            calculate_precision_at_k(documents, 3, threshold=2)
        )
        precision_5_lenient_scores.append(
            calculate_precision_at_k(documents, 5, threshold=2)
        )
        ndcg_1_scores.append(calculate_ndcg_at_k(documents, 1))
        ndcg_3_scores.append(calculate_ndcg_at_k(documents, 3))
        ndcg_5_scores.append(calculate_ndcg_at_k(documents, 5))

    # Calculate aggregate metrics
    avg_relevance = (
        np.mean([d["score"] for d in all_documents if d["score"] >= 0])
        if all_documents
        else 0.0
    )
    skip_rate = skip_count / total_docs if total_docs > 0 else 0.0

    return SystemMetrics(
        name=system_name,
        precision_at_1=np.mean(precision_1_scores) if precision_1_scores else 0.0,
        precision_at_3=np.mean(precision_3_scores) if precision_3_scores else 0.0,
        precision_at_5=np.mean(precision_5_scores) if precision_5_scores else 0.0,
        precision_at_1_lenient=np.mean(precision_1_lenient_scores)
        if precision_1_lenient_scores
        else 0.0,
        precision_at_3_lenient=np.mean(precision_3_lenient_scores)
        if precision_3_lenient_scores
        else 0.0,
        precision_at_5_lenient=np.mean(precision_5_lenient_scores)
        if precision_5_lenient_scores
        else 0.0,
        ndcg_at_1=np.mean(ndcg_1_scores) if ndcg_1_scores else 0.0,
        ndcg_at_3=np.mean(ndcg_3_scores) if ndcg_3_scores else 0.0,
        ndcg_at_5=np.mean(ndcg_5_scores) if ndcg_5_scores else 0.0,
        avg_relevance_score=avg_relevance,
        total_documents=total_docs,
        evaluated_documents=evaluated_docs,
        skip_rate=skip_rate,
    )


def perform_statistical_comparison(
    query_data: dict[str, dict],
    system1: str,
    system2: str,
    metric_func,
    metric_name: str,
) -> ComparisonResult:
    """Perform paired statistical comparison between two systems."""
    system1_scores = []
    system2_scores = []

    for _query_id, systems in query_data.items():
        if system1 in systems and system2 in systems:
            score1 = metric_func(systems[system1])
            score2 = metric_func(systems[system2])
            system1_scores.append(score1)
            system2_scores.append(score2)

    if not system1_scores or not system2_scores:
        return ComparisonResult(
            metric_name=metric_name,
            system1_value=0.0,
            system2_value=0.0,
            difference=0.0,
            percent_improvement=0.0,
            p_value=1.0,
            is_significant=False,
            effect_size=0.0,
            confidence_interval=(0.0, 0.0),
        )

    # Calculate basic statistics
    mean1 = np.mean(system1_scores)
    mean2 = np.mean(system2_scores)
    difference = mean2 - mean1
    percent_improvement = (difference / mean1 * 100) if mean1 != 0 else 0.0

    # Perform paired t-test
    t_stat, p_value = scipy.stats.ttest_rel(system2_scores, system1_scores)

    # Calculate effect size (Cohen's d for paired samples)
    differences = np.array(system2_scores) - np.array(system1_scores)
    effect_size = (
        np.mean(differences) / np.std(differences, ddof=1)
        if len(differences) > 1 and np.std(differences, ddof=1) != 0
        else 0.0
    )

    # Calculate confidence interval for the difference
    if len(differences) > 1:
        sem = scipy.stats.sem(differences)
        confidence_interval = scipy.stats.t.interval(
            0.95, len(differences) - 1, loc=np.mean(differences), scale=sem
        )
    else:
        confidence_interval = (0.0, 0.0)

    return ComparisonResult(
        metric_name=metric_name,
        system1_value=mean1,
        system2_value=mean2,
        difference=difference,
        percent_improvement=percent_improvement,
        p_value=p_value,
        is_significant=p_value < 0.05,
        effect_size=effect_size,
        confidence_interval=confidence_interval,
    )


def analyze_query_level_performance(
    query_data: dict[str, dict], system1: str, system2: str
) -> dict[str, dict]:
    """Analyze performance differences at the query level."""
    query_analysis = {}

    for query_id, systems in query_data.items():
        if system1 not in systems or system2 not in systems:
            continue

        # Calculate Precision@5 for both systems
        p5_system1 = calculate_precision_at_k(systems[system1], 5, threshold=3)
        p5_system2 = calculate_precision_at_k(systems[system2], 5, threshold=3)

        # Calculate average relevance
        sys1_scores = [d["score"] for d in systems[system1] if d["score"] >= 0]
        sys2_scores = [d["score"] for d in systems[system2] if d["score"] >= 0]

        avg_rel_system1 = np.mean(sys1_scores) if sys1_scores else 0.0
        avg_rel_system2 = np.mean(sys2_scores) if sys2_scores else 0.0

        query_analysis[query_id] = {
            "precision_at_5": {
                system1: p5_system1,
                system2: p5_system2,
                "difference": p5_system2 - p5_system1,
            },
            "avg_relevance": {
                system1: avg_rel_system1,
                system2: avg_rel_system2,
                "difference": avg_rel_system2 - avg_rel_system1,
            },
            "winner": system1
            if p5_system1 > p5_system2
            else system2
            if p5_system2 > p5_system1
            else "tie",
        }

    return query_analysis


def generate_executive_summary(
    system1_metrics: SystemMetrics,
    system2_metrics: SystemMetrics,
    comparisons: list[ComparisonResult],
    total_queries: int,
) -> str:
    """Generate executive summary section."""
    summary = "## Executive Summary\n\n"

    # Find the best performing system based on Precision@5
    precision_5_comparison = next(
        (c for c in comparisons if "Precision@5 (strict)" in c.metric_name), None
    )

    if precision_5_comparison:
        winner = (
            system2_metrics.name
            if precision_5_comparison.difference > 0
            else system1_metrics.name
        )
        improvement = abs(precision_5_comparison.percent_improvement)
        significance = (
            "statistically significant"
            if precision_5_comparison.is_significant
            else "not statistically significant"
        )

        summary += f"""**Winner**: {winner}  
**Performance Improvement**: {improvement:.1f}% ({significance})  
**Recommendation**: {"Deploy " + winner + " to production" if precision_5_comparison.is_significant and improvement > 5 else "Further evaluation recommended"}

"""

    return summary


def generate_system_performance_section(
    system1_metrics: SystemMetrics, system2_metrics: SystemMetrics
) -> str:
    """Generate system performance comparison section."""
    return f"""## System Performance Comparison

### {system1_metrics.name}
- **Precision@1**: {system1_metrics.precision_at_1:.3f} (strict), {system1_metrics.precision_at_1_lenient:.3f} (lenient)
- **Precision@3**: {system1_metrics.precision_at_3:.3f} (strict), {system1_metrics.precision_at_3_lenient:.3f} (lenient)  
- **Precision@5**: {system1_metrics.precision_at_5:.3f} (strict), {system1_metrics.precision_at_5_lenient:.3f} (lenient)
- **NDCG@5**: {system1_metrics.ndcg_at_5:.3f}
- **Average Relevance**: {system1_metrics.avg_relevance_score:.2f} / 4.0
- **Documents Evaluated**: {system1_metrics.evaluated_documents} / {system1_metrics.total_documents}

### {system2_metrics.name}
- **Precision@1**: {system2_metrics.precision_at_1:.3f} (strict), {system2_metrics.precision_at_1_lenient:.3f} (lenient)
- **Precision@3**: {system2_metrics.precision_at_3:.3f} (strict), {system2_metrics.precision_at_3_lenient:.3f} (lenient)
- **Precision@5**: {system2_metrics.precision_at_5:.3f} (strict), {system2_metrics.precision_at_5_lenient:.3f} (lenient)
- **NDCG@5**: {system2_metrics.ndcg_at_5:.3f}
- **Average Relevance**: {system2_metrics.avg_relevance_score:.2f} / 4.0
- **Documents Evaluated**: {system2_metrics.evaluated_documents} / {system2_metrics.total_documents}

"""


def generate_statistical_analysis_section(
    system1_metrics: SystemMetrics,
    system2_metrics: SystemMetrics,
    comparisons: list[ComparisonResult],
) -> str:
    """Generate statistical analysis section with comparison table."""
    section = "## Statistical Analysis\n\n"

    # Statistical comparisons table
    section += (
        "| Metric | "
        + system1_metrics.name
        + " | "
        + system2_metrics.name
        + " | Difference | % Change | p-value | Significant | Effect Size |\n"
    )
    section += (
        "|--------|"
        + "-" * len(system1_metrics.name)
        + "|"
        + "-" * len(system2_metrics.name)
        + "|------------|----------|---------|-------------|-------------|\n"
    )

    for comp in comparisons:
        significance_marker = "✓" if comp.is_significant else "✗"
        effect_interpretation = ""
        if abs(comp.effect_size) < 0.2:
            effect_interpretation = " (negligible)"
        elif abs(comp.effect_size) < 0.5:
            effect_interpretation = " (small)"
        elif abs(comp.effect_size) < 0.8:
            effect_interpretation = " (medium)"
        else:
            effect_interpretation = " (large)"

        section += f"| {comp.metric_name} | {comp.system1_value:.3f} | {comp.system2_value:.3f} | {comp.difference:+.3f} | {comp.percent_improvement:+.1f}% | {comp.p_value:.3f} | {significance_marker} | {comp.effect_size:.2f}{effect_interpretation} |\n"

    return section + "\n"


def generate_query_level_analysis_section(
    system1_metrics: SystemMetrics,
    system2_metrics: SystemMetrics,
    query_analysis: dict[str, dict],
    session_data: dict[str, Any],
) -> str:
    """Generate query-level analysis section."""
    total_queries = len(query_analysis)
    section = "## Query-Level Analysis\n\n"

    # Win rate calculation
    system1_wins = sum(
        1 for q in query_analysis.values() if q["winner"] == system1_metrics.name
    )
    system2_wins = sum(
        1 for q in query_analysis.values() if q["winner"] == system2_metrics.name
    )
    ties = sum(1 for q in query_analysis.values() if q["winner"] == "tie")

    section += f"""**Win Rate (Precision@5)**:
- {system1_metrics.name}: {system1_wins} wins ({system1_wins / total_queries * 100:.1f}%)
- {system2_metrics.name}: {system2_wins} wins ({system2_wins / total_queries * 100:.1f}%)
- Ties: {ties} ({ties / total_queries * 100:.1f}%)

### Queries with Largest Performance Differences

"""

    # Sort queries by performance difference
    sorted_queries = sorted(
        query_analysis.items(),
        key=lambda x: abs(x[1]["precision_at_5"]["difference"]),
        reverse=True,
    )

    section += (
        "| Query ID | Query Text | "
        + system1_metrics.name
        + " P@5 | "
        + system2_metrics.name
        + " P@5 | Difference | Winner |\n"
    )
    section += (
        "|----------|------------|"
        + "-" * len(system1_metrics.name)
        + "------|"
        + "-" * len(system2_metrics.name)
        + "------|------------|--------|\n"
    )

    # Show top 10 queries with largest differences
    for query_id, analysis in sorted_queries[:10]:
        # Get query text from session data
        query_text = "Unknown"
        for _eval_key, eval_data in session_data.get("evaluations", {}).items():
            if (
                eval_data != "skip"
                and isinstance(eval_data, dict)
                and eval_data.get("query_id") == query_id
            ):
                query_text = eval_data.get("query_text", "Unknown")[:50] + "..."
                break

        p5_sys1 = analysis["precision_at_5"][system1_metrics.name]
        p5_sys2 = analysis["precision_at_5"][system2_metrics.name]
        diff = analysis["precision_at_5"]["difference"]
        winner = analysis["winner"]

        section += f"| {query_id[:8]}... | {query_text} | {p5_sys1:.2f} | {p5_sys2:.2f} | {diff:+.2f} | {winner} |\n"

    return section + "\n"


def generate_methodology_and_limitations_section(
    system1_metrics: SystemMetrics, system2_metrics: SystemMetrics, total_queries: int
) -> str:
    """Generate methodology and limitations section."""
    return f"""## Methodology

**Evaluation Approach**: Manual human judgment with 4-point relevance scale  
**Relevance Scale**:
- 4 (Highly Relevant): Directly answers the query
- 3 (Relevant): Related and helpful  
- 2 (Somewhat Relevant): Tangentially related
- 1 (Not Relevant): Unrelated to the query

**Thresholds**:
- Strict: Relevance score ≥ 3 (highly relevant + relevant)
- Lenient: Relevance score ≥ 2 (includes somewhat relevant)

**Statistical Tests**: Paired t-test for significance testing  
**Effect Size**: Cohen's d for practical significance

## Limitations

- Sample size: {total_queries} queries may limit statistical power
- Human evaluator bias and fatigue effects
- Skip rate: {system1_metrics.skip_rate:.1%} (System 1), {system2_metrics.skip_rate:.1%} (System 2)

"""


def generate_recommendations_section(comparisons: list[ComparisonResult]) -> str:
    """Generate recommendations section."""
    section = "## Recommendations\n\n"

    # Find Precision@5 comparison for recommendations
    precision_5_comparison = next(
        (c for c in comparisons if "Precision@5 (strict)" in c.metric_name), None
    )

    if precision_5_comparison and precision_5_comparison.is_significant:
        if abs(precision_5_comparison.percent_improvement) > 10:
            section += "**🚀 Strong Recommendation**: Deploy the winning system to production. Performance improvement is both statistically significant and practically meaningful.\n\n"
        elif abs(precision_5_comparison.percent_improvement) > 5:
            section += "**✅ Moderate Recommendation**: Consider deploying the winning system. Performance improvement is statistically significant.\n\n"
        else:
            section += "**⚠️ Weak Recommendation**: Performance difference is statistically significant but practically small. Consider cost-benefit analysis.\n\n"
    else:
        section += "**❓ Inconclusive**: No statistically significant difference detected. Consider additional evaluation or larger sample size.\n\n"

    section += "---\n*Generated by Dual System Evaluation Pipeline Step 4*"

    return section


def generate_markdown_report(
    system1_metrics: SystemMetrics,
    system2_metrics: SystemMetrics,
    comparisons: list[ComparisonResult],
    query_analysis: dict[str, dict],
    session_data: dict[str, Any],
) -> str:
    """Generate comprehensive markdown report."""

    # Get system names from metadata if available
    metadata = session_data.get("metadata", {})
    generation_date = metadata.get("generation_date", "Unknown")
    total_queries = len(query_analysis)

    # Build report header
    report = f"""# Dual System Evaluation Results

**Analysis Date**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}  
**Data Generation**: {generation_date}  
**Total Queries Analyzed**: {total_queries}

"""

    # Add each section
    report += generate_executive_summary(
        system1_metrics, system2_metrics, comparisons, total_queries
    )
    report += generate_system_performance_section(system1_metrics, system2_metrics)
    report += generate_statistical_analysis_section(
        system1_metrics, system2_metrics, comparisons
    )
    report += generate_query_level_analysis_section(
        system1_metrics, system2_metrics, query_analysis, session_data
    )
    report += generate_methodology_and_limitations_section(
        system1_metrics, system2_metrics, total_queries
    )
    report += generate_recommendations_section(comparisons)

    return report


def generate_json_summary(
    system1_metrics: SystemMetrics,
    system2_metrics: SystemMetrics,
    comparisons: list[ComparisonResult],
    query_analysis: dict[str, Any],
) -> dict[str, Any]:
    """Generate JSON summary for programmatic access."""

    # Convert dataclasses to dicts
    def dataclass_to_dict(obj):
        if hasattr(obj, "__dict__"):
            return obj.__dict__
        return obj

    summary = {
        "analysis_timestamp": datetime.now().isoformat(),
        "systems": {
            system1_metrics.name: dataclass_to_dict(system1_metrics),
            system2_metrics.name: dataclass_to_dict(system2_metrics),
        },
        "comparisons": [dataclass_to_dict(comp) for comp in comparisons],
        "query_analysis": query_analysis,
        "summary_stats": {
            "total_queries": len(query_analysis),
            "system1_wins": sum(
                1
                for q in query_analysis.values()
                if q["winner"] == system1_metrics.name
            ),
            "system2_wins": sum(
                1
                for q in query_analysis.values()
                if q["winner"] == system2_metrics.name
            ),
            "ties": sum(1 for q in query_analysis.values() if q["winner"] == "tie"),
        },
    }

    return summary


def main():
    parser = argparse.ArgumentParser(
        description="Analyze manual evaluation results for dual system comparison"
    )
    parser.add_argument(
        "--session-file", required=True, help="Path to evaluation session JSON file"
    )
    parser.add_argument(
        "--output-report",
        default="evaluation_report.md",
        help="Output markdown report file",
    )
    parser.add_argument(
        "--output-json", default="results_summary.json", help="Output JSON summary file"
    )
    parser.add_argument(
        "--system1-name", help="Name for system 1 (auto-detected if not provided)"
    )
    parser.add_argument(
        "--system2-name", help="Name for system 2 (auto-detected if not provided)"
    )

    args = parser.parse_args()

    print("🔍 Analyzing manual evaluation results...")

    # Load evaluation session
    session_data = load_evaluation_session(args.session_file)
    print(
        f"✅ Loaded evaluation session with {len(session_data.get('evaluations', {}))} evaluations"
    )

    # Extract and organize data
    query_data = extract_evaluation_data(session_data)
    print(f"✅ Extracted data for {len(query_data)} queries")

    # Detect system names
    all_systems = set()
    for systems in query_data.values():
        all_systems.update(systems.keys())

    system_names = list(all_systems)
    if len(system_names) != 2:
        print(
            f"❌ Error: Expected 2 systems, found {len(system_names)}: {system_names}"
        )
        return

    system1 = args.system1_name or system_names[0]
    system2 = args.system2_name or system_names[1]

    print(f"📊 Analyzing systems: {system1} vs {system2}")

    # Calculate system metrics
    system1_metrics = calculate_system_metrics(query_data, system1)
    system2_metrics = calculate_system_metrics(query_data, system2)

    print(f"✅ System 1 ({system1}): P@5 = {system1_metrics.precision_at_5:.3f}")
    print(f"✅ System 2 ({system2}): P@5 = {system2_metrics.precision_at_5:.3f}")

    # Perform statistical comparisons
    print("🧮 Performing statistical comparisons...")

    metric_functions = {
        "Precision@1 (strict)": lambda docs: calculate_precision_at_k(
            docs, 1, threshold=3
        ),
        "Precision@3 (strict)": lambda docs: calculate_precision_at_k(
            docs, 3, threshold=3
        ),
        "Precision@5 (strict)": lambda docs: calculate_precision_at_k(
            docs, 5, threshold=3
        ),
        "Precision@1 (lenient)": lambda docs: calculate_precision_at_k(
            docs, 1, threshold=2
        ),
        "Precision@3 (lenient)": lambda docs: calculate_precision_at_k(
            docs, 3, threshold=2
        ),
        "Precision@5 (lenient)": lambda docs: calculate_precision_at_k(
            docs, 5, threshold=2
        ),
        "NDCG@1": lambda docs: calculate_ndcg_at_k(docs, 1),
        "NDCG@3": lambda docs: calculate_ndcg_at_k(docs, 3),
        "NDCG@5": lambda docs: calculate_ndcg_at_k(docs, 5),
        "Average Relevance": lambda docs: np.mean(
            [d["score"] for d in docs if d["score"] >= 0]
        ),
    }

    comparisons = []
    for metric_name, metric_func in metric_functions.items():
        comparison = perform_statistical_comparison(
            query_data, system1, system2, metric_func, metric_name
        )
        comparisons.append(comparison)

    # Query-level analysis
    query_analysis = analyze_query_level_performance(query_data, system1, system2)

    # Generate reports
    print("📝 Generating reports...")

    # Markdown report
    markdown_report = generate_markdown_report(
        system1_metrics, system2_metrics, comparisons, query_analysis, session_data
    )

    with open(args.output_report, "w") as f:
        f.write(markdown_report)

    # JSON summary
    json_summary = generate_json_summary(
        system1_metrics, system2_metrics, comparisons, query_analysis
    )

    with open(args.output_json, "w") as f:
        json.dump(json_summary, f, indent=2, default=str)

    print("✅ Analysis complete!")
    print(f"📄 Markdown report: {args.output_report}")
    print(f"📊 JSON summary: {args.output_json}")

    # Print key results
    precision_5_comparison = next(
        (c for c in comparisons if "Precision@5 (strict)" in c.metric_name), None
    )
    if precision_5_comparison:
        winner = system2 if precision_5_comparison.difference > 0 else system1
        improvement = abs(precision_5_comparison.percent_improvement)
        significance = "✓" if precision_5_comparison.is_significant else "✗"

        print("\n🎯 Key Results:")
        print(f"   Winner: {winner}")
        print(f"   Improvement: {improvement:.1f}%")
        print(f"   Significant: {significance}")


if __name__ == "__main__":
    main()
