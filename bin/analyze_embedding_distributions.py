#!/usr/bin/env python3
"""
Embedding Distribution Analysis Tool

Compares embedding distributions between Current System (text-embedding-ada-002, 1536 dims)
and New System (text-embedding-3-large, 3072 dims) to identify performance differences.

This tool samples embeddings from both Pinecone indexes and performs statistical analysis
to understand why the New System performs poorly with certain chunking strategies.

Usage:
    python bin/analyze_embedding_distributions.py --site ananda --sample-size 1000

Environment Variables Required:
    Current System: PINECONE_INDEX_NAME, OPENAI_EMBEDDINGS_MODEL (from .env.ananda)
    New System: PINECONE_INGEST_INDEX_NAME, OPENAI_INGEST_EMBEDDINGS_MODEL

Output:
    - Statistical analysis report saved to docs/embedding-distribution-analysis.md
    - Visualization plots saved to experiments/embedding-analysis/
"""

import argparse
import json
import logging
import os
import random
import sys
import time
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
from pinecone import Pinecone
from sklearn.decomposition import PCA
from sklearn.metrics.pairwise import cosine_similarity

from pyutil.env_utils import load_env

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Reduce third-party library logging noise
logging.getLogger("pinecone").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("matplotlib").setLevel(logging.WARNING)

# Add the project root to the path for imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


class EmbeddingAnalyzer:
    """Analyzes and compares embedding distributions between two systems."""

    def __init__(self, site: str, sample_size: int = 1000):
        self.site = site
        self.sample_size = sample_size
        self.output_dir = project_root / "experiments" / "embedding-analysis"
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Load environment and initialize clients
        load_env(site)
        self.pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

        # System configurations
        self.current_system = {
            "name": "Current System (text-embedding-ada-002)",
            "index_name": os.getenv("PINECONE_INDEX_NAME"),
            "model": os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-ada-002"),
            "dimension": int(os.getenv("OPENAI_EMBEDDINGS_DIMENSION", "1536")),
        }

        self.new_system = {
            "name": "New System (text-embedding-3-large)",
            "index_name": os.getenv("PINECONE_INGEST_INDEX_NAME"),
            "model": os.getenv(
                "OPENAI_INGEST_EMBEDDINGS_MODEL", "text-embedding-3-large"
            ),
            "dimension": int(os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION", "3072")),
        }

        # Validate configuration
        self._validate_config()

        # Get index connections
        self.current_index = self.pc.Index(self.current_system["index_name"])
        self.new_index = self.pc.Index(self.new_system["index_name"])

        # Storage for sampled embeddings
        self.current_embeddings = []
        self.new_embeddings = []
        self.current_metadata = []
        self.new_metadata = []

    def _validate_config(self):
        """Validate required environment variables and configurations."""
        required_vars = [
            "PINECONE_API_KEY",
            "PINECONE_INDEX_NAME",
            "PINECONE_INGEST_INDEX_NAME",
        ]

        missing = [var for var in required_vars if not os.getenv(var)]
        if missing:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing)}"
            )

        logger.info(
            f"Current System: {self.current_system['name']} ({self.current_system['dimension']}D)"
        )
        logger.info(f"  Index: {self.current_system['index_name']}")
        logger.info(
            f"New System: {self.new_system['name']} ({self.new_system['dimension']}D)"
        )
        logger.info(f"  Index: {self.new_system['index_name']}")

    def sample_embeddings(self) -> None:
        """Sample random embeddings from both indexes."""
        logger.info(f"Sampling {self.sample_size} embeddings from each system...")

        # Sample from Current System
        logger.info("Sampling from Current System...")
        self.current_embeddings, self.current_metadata = self._sample_from_index(
            self.current_index, self.current_system["dimension"]
        )

        # Sample from New System
        logger.info("Sampling from New System...")
        self.new_embeddings, self.new_metadata = self._sample_from_index(
            self.new_index, self.new_system["dimension"]
        )

        logger.info(
            f"Successfully sampled {len(self.current_embeddings)} Current System embeddings"
        )
        logger.info(
            f"Successfully sampled {len(self.new_embeddings)} New System embeddings"
        )

    def _sample_from_index(
        self, index, expected_dim: int
    ) -> tuple[list[np.ndarray], list[dict]]:
        """Sample random embeddings from a Pinecone index."""
        embeddings = []
        metadata = []

        # Get index stats to understand the data
        stats = index.describe_index_stats()
        total_vectors = stats["total_vector_count"]

        if total_vectors == 0:
            logger.warning("Index is empty, cannot sample embeddings")
            return [], []

        logger.info(f"Index contains {total_vectors} vectors")

        # Use a dummy query to get random samples
        # Create a random query vector
        dummy_vector = np.random.normal(0, 1, expected_dim).tolist()

        # Query for more than we need to account for filtering
        query_size = min(self.sample_size * 3, 10000)  # Get more to filter from

        # First try unfiltered to see what library values exist
        logger.debug("Trying unfiltered query first to discover library values...")
        query_result = index.query(
            vector=dummy_vector,
            top_k=min(100, query_size),  # Sample fewer for discovery
            include_values=True,
            include_metadata=True,
        )
        matches = query_result.get("matches", [])
        logger.debug(f"Unfiltered query returned {len(matches)} matches")

        # Check what library values actually exist in the metadata
        if matches:
            sample_libraries = set()
            for i, match in enumerate(matches[:10]):  # Check first 10 matches
                meta = match.get("metadata", {})
                library_val = meta.get("library")
                sample_libraries.add(library_val)
                if i < 3:  # Log first 3 for debugging
                    logger.debug(
                        f"Sample match {i}: library='{library_val}', metadata keys: {list(meta.keys())}"
                    )
            logger.info(f"Found library values in metadata: {sample_libraries}")

            # Now try filtering if we found a matching library value
            site_variations = [
                self.site,
                f"{self.site}.org",
                self.site.replace("-", "."),
            ]
            matching_library = None

            for lib_val in sample_libraries:
                if lib_val and any(
                    variant in str(lib_val).lower() for variant in site_variations
                ):
                    matching_library = lib_val
                    break

            if matching_library:
                logger.info(
                    f"Found matching library value: '{matching_library}', filtering by it..."
                )
                try:
                    query_result = index.query(
                        vector=dummy_vector,
                        top_k=query_size,
                        include_values=True,
                        include_metadata=True,
                        filter={"library": {"$in": [matching_library]}},
                    )
                    matches = query_result.get("matches", [])
                    logger.debug(f"Filtered query returned {len(matches)} matches")
                except Exception as e:
                    logger.warning(
                        f"Filtering by '{matching_library}' failed: {e}, using unfiltered results"
                    )
            else:
                logger.warning(
                    f"No matching library found for site '{self.site}', using unfiltered results"
                )
                # Use larger unfiltered query
                query_result = index.query(
                    vector=dummy_vector,
                    top_k=query_size,
                    include_values=True,
                    include_metadata=True,
                )
                matches = query_result.get("matches", [])

        # Randomly sample from the results
        if len(matches) > self.sample_size:
            matches = random.sample(matches, self.sample_size)

        valid_matches = 0
        for match in matches:
            if match.get("values") and len(match["values"]) == expected_dim:
                embeddings.append(np.array(match["values"]))
                metadata.append(match.get("metadata", {}))
                valid_matches += 1

        logger.debug(f"Valid matches with correct dimensions: {valid_matches}")
        return embeddings, metadata

    def analyze_distributions(self) -> dict[str, Any]:
        """Perform comprehensive distribution analysis."""
        logger.info("Analyzing embedding distributions...")

        if not self.current_embeddings or not self.new_embeddings:
            raise ValueError("No embeddings to analyze. Run sample_embeddings() first.")

        current_matrix = np.array(self.current_embeddings)
        new_matrix = np.array(self.new_embeddings)

        analysis = {
            "current_system": self._analyze_embedding_matrix(
                current_matrix, self.current_system
            ),
            "new_system": self._analyze_embedding_matrix(new_matrix, self.new_system),
            "comparison": self._compare_systems(current_matrix, new_matrix),
        }

        return analysis

    def _analyze_embedding_matrix(
        self, embeddings: np.ndarray, system_info: dict
    ) -> dict[str, Any]:
        """Analyze a matrix of embeddings."""
        n_samples, n_dims = embeddings.shape

        # Basic statistics
        means = np.mean(embeddings, axis=0)
        stds = np.std(embeddings, axis=0)
        norms = np.linalg.norm(embeddings, axis=1)

        # Sparsity analysis (values close to zero)
        sparsity_threshold = 0.01
        sparse_values = np.abs(embeddings) < sparsity_threshold
        sparsity_percentage = np.mean(sparse_values) * 100

        # Dimension variance ranking
        dimension_variances = np.var(embeddings, axis=0)
        high_variance_dims = np.argsort(dimension_variances)[
            -10:
        ]  # Top 10 most variable
        low_variance_dims = np.argsort(dimension_variances)[
            :10
        ]  # Top 10 least variable

        # Cosine similarity analysis
        similarity_matrix = cosine_similarity(embeddings)
        # Remove diagonal for pairwise similarities
        similarity_matrix_no_diag = similarity_matrix[
            np.triu_indices_from(similarity_matrix, k=1)
        ]

        return {
            "n_samples": n_samples,
            "n_dimensions": n_dims,
            "mean_values": {
                "overall_mean": np.mean(means),
                "mean_std": np.std(means),
                "dimension_means_range": [float(np.min(means)), float(np.max(means))],
            },
            "std_values": {
                "overall_std": np.mean(stds),
                "std_std": np.std(stds),
                "dimension_stds_range": [float(np.min(stds)), float(np.max(stds))],
            },
            "norms": {
                "mean_norm": float(np.mean(norms)),
                "std_norm": float(np.std(norms)),
                "norm_range": [float(np.min(norms)), float(np.max(norms))],
            },
            "sparsity": {
                "percentage_sparse": float(sparsity_percentage),
                "threshold": sparsity_threshold,
            },
            "dimension_analysis": {
                "high_variance_dims": high_variance_dims.tolist(),
                "low_variance_dims": low_variance_dims.tolist(),
                "variance_range": [
                    float(np.min(dimension_variances)),
                    float(np.max(dimension_variances)),
                ],
            },
            "similarity_analysis": {
                "mean_pairwise_similarity": float(np.mean(similarity_matrix_no_diag)),
                "std_pairwise_similarity": float(np.std(similarity_matrix_no_diag)),
                "similarity_range": [
                    float(np.min(similarity_matrix_no_diag)),
                    float(np.max(similarity_matrix_no_diag)),
                ],
            },
        }

    def _compare_systems(
        self, current_matrix: np.ndarray, new_matrix: np.ndarray
    ) -> dict[str, Any]:
        """Compare the two embedding systems."""
        # Dimensionality reduction for comparison
        # Reduce new system to current system's dimensions using PCA
        # Use minimum of target dimensions and available samples
        n_components = min(
            self.current_system["dimension"],
            new_matrix.shape[0] - 1,
            new_matrix.shape[1],
        )
        pca = PCA(n_components=n_components)
        new_reduced = pca.fit_transform(new_matrix)

        # Compare reduced new system with current system
        current_norms = np.linalg.norm(current_matrix, axis=1)
        new_norms = np.linalg.norm(new_matrix, axis=1)
        new_reduced_norms = np.linalg.norm(new_reduced, axis=1)

        return {
            "dimensionality_reduction": {
                "pca_explained_variance_ratio": pca.explained_variance_ratio_[
                    :10
                ].tolist(),
                "total_variance_explained": float(
                    np.sum(pca.explained_variance_ratio_)
                ),
            },
            "norm_comparison": {
                "current_mean_norm": float(np.mean(current_norms)),
                "new_mean_norm": float(np.mean(new_norms)),
                "new_reduced_mean_norm": float(np.mean(new_reduced_norms)),
                "norm_ratio_new_vs_current": float(
                    np.mean(new_norms) / np.mean(current_norms)
                ),
                "norm_ratio_reduced_vs_current": float(
                    np.mean(new_reduced_norms) / np.mean(current_norms)
                ),
            },
        }

    def create_visualizations(self, analysis: dict[str, Any]) -> None:
        """Create visualization plots comparing the systems."""
        logger.info("Creating visualization plots...")

        # Set up the plotting style
        plt.style.use("default")
        sns.set_palette("husl")

        fig, axes = plt.subplots(2, 3, figsize=(18, 12))
        fig.suptitle(
            "Embedding Distribution Analysis: Current vs New System", fontsize=16
        )

        current_matrix = np.array(self.current_embeddings)
        new_matrix = np.array(self.new_embeddings)

        # 1. L2 Norm Distribution
        axes[0, 0].hist(
            np.linalg.norm(current_matrix, axis=1),
            bins=50,
            alpha=0.7,
            label="Current",
            density=True,
        )
        axes[0, 0].hist(
            np.linalg.norm(new_matrix, axis=1),
            bins=50,
            alpha=0.7,
            label="New",
            density=True,
        )
        axes[0, 0].set_title("L2 Norm Distribution")
        axes[0, 0].set_xlabel("L2 Norm")
        axes[0, 0].set_ylabel("Density")
        axes[0, 0].legend()

        # 2. Mean values per dimension (sample)
        current_means = np.mean(current_matrix, axis=0)
        new_means = np.mean(new_matrix, axis=0)[
            : len(current_means)
        ]  # Match dimensions for comparison

        axes[0, 1].plot(
            current_means[:100], alpha=0.7, label="Current (first 100 dims)"
        )
        axes[0, 1].plot(new_means[:100], alpha=0.7, label="New (first 100 dims)")
        axes[0, 1].set_title("Mean Values per Dimension (First 100)")
        axes[0, 1].set_xlabel("Dimension")
        axes[0, 1].set_ylabel("Mean Value")
        axes[0, 1].legend()

        # 3. Standard deviation per dimension (sample)
        current_stds = np.std(current_matrix, axis=0)
        new_stds = np.std(new_matrix, axis=0)[: len(current_stds)]

        axes[0, 2].plot(current_stds[:100], alpha=0.7, label="Current (first 100 dims)")
        axes[0, 2].plot(new_stds[:100], alpha=0.7, label="New (first 100 dims)")
        axes[0, 2].set_title("Std Deviation per Dimension (First 100)")
        axes[0, 2].set_xlabel("Dimension")
        axes[0, 2].set_ylabel("Standard Deviation")
        axes[0, 2].legend()

        # 4. Sparsity comparison
        sparsity_threshold = 0.01
        current_sparsity = np.mean(np.abs(current_matrix) < sparsity_threshold, axis=0)
        new_sparsity = np.mean(np.abs(new_matrix) < sparsity_threshold, axis=0)

        axes[1, 0].hist(
            current_sparsity, bins=50, alpha=0.7, label="Current", density=True
        )
        axes[1, 0].hist(new_sparsity, bins=50, alpha=0.7, label="New", density=True)
        axes[1, 0].set_title("Sparsity Distribution per Dimension")
        axes[1, 0].set_xlabel("Sparsity Ratio")
        axes[1, 0].set_ylabel("Density")
        axes[1, 0].legend()

        # 5. PCA explained variance
        pca = PCA(n_components=min(50, self.current_system["dimension"]))
        pca.fit(new_matrix)

        axes[1, 1].plot(np.cumsum(pca.explained_variance_ratio_), marker="o")
        axes[1, 1].set_title("PCA Explained Variance (New System)")
        axes[1, 1].set_xlabel("Number of Components")
        axes[1, 1].set_ylabel("Cumulative Explained Variance")
        axes[1, 1].grid(True)

        # 6. Similarity matrix heatmap (sample)
        sample_size = min(50, len(current_matrix))
        current_sample = current_matrix[:sample_size]
        similarity_matrix = cosine_similarity(current_sample)

        im = axes[1, 2].imshow(similarity_matrix, cmap="viridis", aspect="auto")
        axes[1, 2].set_title(
            f"Cosine Similarity Matrix (Current, {sample_size} samples)"
        )
        axes[1, 2].set_xlabel("Sample Index")
        axes[1, 2].set_ylabel("Sample Index")
        plt.colorbar(im, ax=axes[1, 2])

        plt.tight_layout()
        plot_path = self.output_dir / "embedding_distribution_analysis.png"
        plt.savefig(plot_path, dpi=300, bbox_inches="tight")
        logger.info(f"Visualization saved to {plot_path}")
        plt.close()

    def generate_report(self, analysis: dict[str, Any]) -> None:
        """Generate a comprehensive markdown report."""
        logger.info("Generating analysis report...")

        report_path = project_root / "docs" / "embedding-distribution-analysis.md"

        with open(report_path, "w") as f:
            f.write(f"""# Embedding Distribution Analysis Report

Generated: {time.strftime("%Y-%m-%d %H:%M:%S")}
Site: {self.site}
Sample Size: {self.sample_size}

## Executive Summary

This analysis compares embedding distributions between the Current System ({self.current_system["model"]}) 
and New System ({self.new_system["model"]}) to understand performance differences in RAG retrieval.

## System Configurations

### Current System
- **Model**: {self.current_system["model"]}
- **Dimensions**: {self.current_system["dimension"]}
- **Index**: {self.current_system["index_name"]}
- **Samples Analyzed**: {analysis["current_system"]["n_samples"]}

### New System
- **Model**: {self.new_system["model"]}
- **Dimensions**: {self.new_system["dimension"]}
- **Index**: {self.new_system["index_name"]}
- **Samples Analyzed**: {analysis["new_system"]["n_samples"]}

## Distribution Analysis

### Current System ({self.current_system["model"]})

#### Basic Statistics
- **Mean Embedding Norm**: {analysis["current_system"]["norms"]["mean_norm"]:.4f} ± {analysis["current_system"]["norms"]["std_norm"]:.4f}
- **Norm Range**: [{analysis["current_system"]["norms"]["norm_range"][0]:.4f}, {analysis["current_system"]["norms"]["norm_range"][1]:.4f}]
- **Overall Mean Value**: {analysis["current_system"]["mean_values"]["overall_mean"]:.6f}
- **Overall Std Value**: {analysis["current_system"]["std_values"]["overall_std"]:.6f}

#### Sparsity Analysis
- **Sparse Values**: {analysis["current_system"]["sparsity"]["percentage_sparse"]:.2f}% (< {analysis["current_system"]["sparsity"]["threshold"]})

#### Similarity Analysis
- **Mean Pairwise Cosine Similarity**: {analysis["current_system"]["similarity_analysis"]["mean_pairwise_similarity"]:.4f} ± {analysis["current_system"]["similarity_analysis"]["std_pairwise_similarity"]:.4f}
- **Similarity Range**: [{analysis["current_system"]["similarity_analysis"]["similarity_range"][0]:.4f}, {analysis["current_system"]["similarity_analysis"]["similarity_range"][1]:.4f}]

### New System ({self.new_system["model"]})

#### Basic Statistics
- **Mean Embedding Norm**: {analysis["new_system"]["norms"]["mean_norm"]:.4f} ± {analysis["new_system"]["norms"]["std_norm"]:.4f}
- **Norm Range**: [{analysis["new_system"]["norms"]["norm_range"][0]:.4f}, {analysis["new_system"]["norms"]["norm_range"][1]:.4f}]
- **Overall Mean Value**: {analysis["new_system"]["mean_values"]["overall_mean"]:.6f}
- **Overall Std Value**: {analysis["new_system"]["std_values"]["overall_std"]:.6f}

#### Sparsity Analysis
- **Sparse Values**: {analysis["new_system"]["sparsity"]["percentage_sparse"]:.2f}% (< {analysis["new_system"]["sparsity"]["threshold"]})

#### Similarity Analysis
- **Mean Pairwise Cosine Similarity**: {analysis["new_system"]["similarity_analysis"]["mean_pairwise_similarity"]:.4f} ± {analysis["new_system"]["similarity_analysis"]["std_pairwise_similarity"]:.4f}
- **Similarity Range**: [{analysis["new_system"]["similarity_analysis"]["similarity_range"][0]:.4f}, {analysis["new_system"]["similarity_analysis"]["similarity_range"][1]:.4f}]

## Comparative Analysis

### Dimensionality Reduction Analysis
- **Total Variance Explained by PCA**: {analysis["comparison"]["dimensionality_reduction"]["total_variance_explained"]:.4f}
- **First 10 Components Variance**: {[f"{x:.4f}" for x in analysis["comparison"]["dimensionality_reduction"]["pca_explained_variance_ratio"]]}

### Norm Comparison
- **Current System Mean Norm**: {analysis["comparison"]["norm_comparison"]["current_mean_norm"]:.4f}
- **New System Mean Norm**: {analysis["comparison"]["norm_comparison"]["new_mean_norm"]:.4f}
- **New/Current Norm Ratio**: {analysis["comparison"]["norm_comparison"]["norm_ratio_new_vs_current"]:.4f}
- **PCA Reduced New/Current Ratio**: {analysis["comparison"]["norm_comparison"]["norm_ratio_reduced_vs_current"]:.4f}

## Key Findings

### Hypothesis 1: Dimensionality Issues
""")

            # Analysis findings based on the data
            variance_explained = analysis["comparison"]["dimensionality_reduction"][
                "total_variance_explained"
            ]
            if variance_explained < 0.95:
                f.write(f"""
**⚠️ FINDING**: PCA analysis shows only {variance_explained:.1%} of variance can be explained by {self.current_system["dimension"]} components.
This suggests the New System's higher dimensionality contains significant information that would be lost in dimensionality reduction.
""")
            else:
                f.write(f"""
**✅ FINDING**: PCA analysis shows {variance_explained:.1%} of variance can be explained by {self.current_system["dimension"]} components.
This suggests dimensionality reduction may be viable without significant information loss.
""")

            # Sparsity comparison
            current_sparsity = analysis["current_system"]["sparsity"][
                "percentage_sparse"
            ]
            new_sparsity = analysis["new_system"]["sparsity"]["percentage_sparse"]

            f.write("""
### Hypothesis 2: Sparsity and Noise
""")

            if new_sparsity > current_sparsity * 1.5:
                f.write(f"""
**⚠️ FINDING**: New System shows significantly higher sparsity ({new_sparsity:.1f}% vs {current_sparsity:.1f}%).
This increased sparsity may indicate noise or redundant dimensions affecting retrieval quality.
""")
            else:
                f.write(f"""
**✅ FINDING**: Sparsity levels are comparable between systems ({new_sparsity:.1f}% vs {current_sparsity:.1f}%).
Sparsity is unlikely to be the primary cause of performance differences.
""")

            # Norm comparison
            norm_ratio = analysis["comparison"]["norm_comparison"][
                "norm_ratio_new_vs_current"
            ]

            f.write("""
### Hypothesis 3: Embedding Magnitude
""")

            if abs(norm_ratio - 1.0) > 0.2:
                f.write(f"""
**⚠️ FINDING**: Significant norm difference between systems (ratio: {norm_ratio:.2f}).
This magnitude difference may affect cosine similarity calculations and retrieval ranking.
""")
            else:
                f.write(f"""
**✅ FINDING**: Embedding magnitudes are comparable between systems (ratio: {norm_ratio:.2f}).
Magnitude differences are unlikely to significantly impact cosine similarity retrieval.
""")

            f.write(f"""

## Recommendations

Based on this analysis, the following experiments are recommended:

1. **Experiment 1.2: PCA Dimensionality Reduction**
   - Priority: {"HIGH" if variance_explained > 0.90 else "MEDIUM"}
   - Test reducing New System embeddings to {self.current_system["dimension"]} dimensions using PCA
   - Expected impact: {"Significant improvement" if variance_explained > 0.95 else "Moderate improvement"}

2. **Experiment 3.1: Similarity Threshold Tuning**
   - Priority: HIGH
   - Current similarity characteristics show different distributions between systems
   - Test threshold range: 0.2 to 0.8 in 0.1 increments

3. **Experiment 1.3: Alternative Embedding Models**
   - Priority: {"LOW" if variance_explained > 0.90 else "HIGH"}
   - Consider text-embedding-3-small as a middle-ground option
   - May provide better performance than 3-large without current system limitations

## Data Files

- **Visualization**: `experiments/embedding-analysis/embedding_distribution_analysis.png`
- **Raw Analysis Data**: `experiments/embedding-analysis/analysis_results.json`

## Next Steps

1. Review findings with the team
2. Prioritize follow-up experiments based on these insights
3. Implement the highest-priority recommendations
4. Re-run this analysis after implementing changes

---
*Generated by bin/analyze_embedding_distributions.py*
""")

        # Save raw analysis data
        analysis_data_path = self.output_dir / "analysis_results.json"
        with open(analysis_data_path, "w") as f:
            json.dump(analysis, f, indent=2)

        logger.info(f"Report saved to {report_path}")
        logger.info(f"Raw data saved to {analysis_data_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Analyze embedding distributions between Current and New Systems"
    )
    parser.add_argument(
        "--site",
        required=True,
        choices=["ananda", "crystal", "jairam", "ananda-public"],
        help="Site configuration to use",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=1000,
        help="Number of embeddings to sample from each system (default: 1000)",
    )

    args = parser.parse_args()

    try:
        analyzer = EmbeddingAnalyzer(args.site, args.sample_size)

        # Sample embeddings from both systems
        analyzer.sample_embeddings()

        # Perform analysis
        analysis = analyzer.analyze_distributions()

        # Create visualizations
        analyzer.create_visualizations(analysis)

        # Generate report
        analyzer.generate_report(analysis)

        logger.info(
            "Analysis complete! Check docs/embedding-distribution-analysis.md for results."
        )

    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
