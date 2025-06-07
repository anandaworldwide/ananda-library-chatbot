#!/usr/bin/env python3
"""
Lightweight Test: Compare text-embedding-ada-002 vs voyage-3-large on Spiritual Content

This script tests embedding model performance on a small dataset of spiritual content
without requiring a full Pinecone ingestion pipeline.

Usage:
    python bin/compare_embedding_models.py
    python bin/compare_embedding_models.py --verbose
    python bin/compare_embedding_models.py --save-results results.json
"""

import argparse
import json
import os

# Text splitter for chunking
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import voyageai
from openai import OpenAI
from sklearn.metrics.pairwise import cosine_similarity

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from data_ingestion.utils.text_splitter_utils import SpacyTextSplitter
from pyutil.env_utils import load_env


@dataclass
class EmbeddingResult:
    """Result from embedding a text chunk"""

    text: str
    embedding: list[float]
    model: str
    chunk_id: str


@dataclass
class QueryResult:
    """Result from querying against embedded chunks"""

    query: str
    model: str
    top_chunks: list[tuple[float, str, str]]  # (similarity_score, chunk_text, chunk_id)
    avg_similarity: float
    processing_time: float


@dataclass
class ComparisonSummary:
    """Summary comparing two models"""

    ada_002_avg_similarity: float
    voyage_large_2048_avg_similarity: float
    ada_002_avg_time: float
    voyage_large_2048_avg_time: float
    ada_002_precision_at_5: float
    voyage_large_2048_precision_at_5: float


class EmbeddingModelComparator:
    """Compare embedding models on spiritual content"""

    def __init__(self):
        # Initialize both OpenAI and Voyage AI clients
        self.openai_client = OpenAI()
        self.voyage_client = voyageai.Client()

        self.models = [
            "text-embedding-ada-002",
            "voyage-3-large-2048",
        ]

        # Model configurations with provider and dimension info
        self.model_configs = {
            "text-embedding-ada-002": {
                "provider": "openai",
                "model_name": "text-embedding-ada-002",
                "dimensions": None,  # Fixed at 1536
            },
            "voyage-3-large-2048": {
                "provider": "voyage",
                "model_name": "voyage-3-large",
                "dimensions": 2048,  # High-dimensional version
            },
        }

        # Spiritual content dataset - key texts from Ananda teachings
        self.spiritual_texts = [
            {
                "id": "seclusion_1",
                "text": "If you've never taken a seclusion before, it's best to start slowly. Don't rush into a week-long seclusion; rather, convince yourself first that you need it, that you deserve it. Take a day's seclusion first. If that goes well, then try a weekend retreat. From there, you might try a three-day seclusion, then perhaps a week. The important thing is to be regular in your practice, and to take seclusions as often as you reasonably can.",
            },
            {
                "id": "ida_pingala",
                "text": "Ida and Pingala are the two main energy channels that run alongside the spine, to the left and right of the central channel, Sushumna. Ida is the lunar, cooling, feminine energy channel on the left side. Pingala is the solar, heating, masculine energy channel on the right side. The goal of pranayama and yoga practices is to balance these two currents and direct the energy up through Sushumna to the spiritual eye.",
            },
            {
                "id": "affirmation_learning",
                "text": "I am open and ready to learn. My mind is calm and receptive to new knowledge. I absorb information easily and remember it clearly. Every challenge I face is an opportunity to grow in wisdom and understanding. I trust in my ability to master new skills with patience and practice. Divine intelligence flows through me, guiding my learning process.",
            },
            {
                "id": "meditation_posture",
                "text": "Sit upright with your spine straight but not rigid. Your head should be balanced naturally on your shoulders, with your chin slightly tucked. Rest your hands comfortably on your thighs or in your lap. Keep your shoulders relaxed and let your body find its natural equilibrium. The correct posture allows energy to flow freely up the spine while maintaining alertness and relaxation simultaneously.",
            },
            {
                "id": "guru_disciple",
                "text": "The guru-disciple relationship is the most sacred of all human relationships. It is not based on personality or human affection, but on the transmission of divine consciousness from teacher to student. The true guru is one who has realized God and can guide others along the spiritual path. The disciple's role is to be receptive, obedient, and willing to surrender the ego to receive the guru's blessings and guidance.",
            },
            {
                "id": "kriya_yoga",
                "text": "Kriya Yoga is a sacred science of breath and energy control that directly accelerates spiritual evolution. Through the practice of specific breathing techniques, the Kriya Yogi can consciously direct the life force up and down the spine, gradually dissolving the ego and merging with cosmic consciousness. This ancient technique was brought to the West by Paramhansa Yogananda and offers a direct path to Self-realization.",
            },
            {
                "id": "inner_peace",
                "text": "True inner peace is not merely the absence of conflict, but the presence of divine harmony within. It comes from recognizing that happiness cannot be found in outer circumstances, but only through attunement with the infinite joy of your soul. When you rest in this inner sanctuary, you become a beacon of peace for all those around you, radiating calmness and divine love.",
            },
            {
                "id": "divine_friendship",
                "text": "Divine friendship is the highest form of human relationship, where two souls meet in their mutual love for God. In such friendships, there is no possessiveness, jealousy, or ego-involvement. Instead, there is only pure love, understanding, and the shared joy of seeking truth together. These relationships become stepping stones to cosmic consciousness and divine love.",
            },
            {
                "id": "self_realization",
                "text": "Self-realization is the goal of all true spiritual seeking. It is the direct experience of your essential nature as infinite consciousness, beyond all limitations of body, mind, and ego. In this state, you know yourself as one with all existence, filled with eternal bliss, wisdom, and love. This is not a belief or philosophy, but a direct, unshakeable experience of ultimate truth.",
            },
            {
                "id": "energy_meditation",
                "text": "Energy meditation involves consciously working with the subtle life force that animates your body. Begin by feeling the energy in your hands, then gradually expand your awareness to include the energy flowing throughout your entire being. With practice, you can learn to direct this energy to heal yourself and others, and ultimately to merge this individual energy with the cosmic energy that pervades all creation.",
            },
            {
                "id": "spiritual_tests",
                "text": "Every spiritual seeker faces tests on the path to God. These tests come in many forms: temptations, difficulties, moments of doubt, and challenges to our faith and devotion. The wise disciple understands that these tests are opportunities for spiritual growth, sent by divine grace to strengthen our resolve and deepen our commitment to the spiritual path. Welcome them with gratitude and learn from each experience.",
            },
            {
                "id": "devotional_chanting",
                "text": "Devotional chanting is one of the most direct ways to connect with divine consciousness. When you chant with deep feeling and concentration, your heart opens like a flower to receive God's love. The sacred vibrations of spiritual chants have the power to transform consciousness, dissolve negative karma, and awaken the soul's natural joy. Sing to God with all your heart, and feel His presence responding within you.",
            },
            {
                "id": "yogananda_teachings",
                "text": "Paramhansa Yogananda brought the ancient science of yoga to the West, showing how Eastern wisdom and Western practicality could be perfectly combined. His teachings emphasize that God-realization is the birthright of every soul, and that through meditation, self-discipline, and devotion, anyone can achieve divine communion. His message of universal love and practical spirituality continues to inspire millions of seekers worldwide.",
            },
        ]

        # Test queries - mix of spiritual and general but related
        self.test_queries = [
            # Spiritual queries
            "How do I start taking spiritual seclusions?",
            "What are Ida and Pingala energy channels?",
            "Give me an affirmation for learning new skills",
            "What is the correct meditation posture?",
            "Explain the guru-disciple relationship",
            "What is Kriya Yoga practice?",
            "How do I find inner peace?",
            "What is Self-realization?",
            # General but related queries
            "What is meditation?",
            "How do energy practices work?",
            "What are breathing techniques?",
            "How do I develop spiritually?",
            "What is yoga philosophy?",
        ]

        # Initialize text splitters for different chunking strategies
        self.splitters = {
            "paragraph": SpacyTextSplitter(chunk_size=600, chunk_overlap=120),
            "fixed_small": SpacyTextSplitter(chunk_size=256, chunk_overlap=50),
            "fixed_medium": SpacyTextSplitter(chunk_size=400, chunk_overlap=80),
        }

    def chunk_texts(self, strategy: str = "paragraph") -> list[dict[str, Any]]:
        """Chunk all texts using specified strategy"""
        print(f"Chunking texts using {strategy} strategy...")

        splitter = self.splitters[strategy]
        chunks = []

        for text_item in self.spiritual_texts:
            text_chunks = splitter.split_text(text_item["text"])

            for i, chunk in enumerate(text_chunks):
                chunks.append(
                    {
                        "chunk_id": f"{text_item['id']}_chunk_{i}",
                        "text": chunk,
                        "source_id": text_item["id"],
                        "chunk_index": i,
                    }
                )

        print(f"Created {len(chunks)} chunks from {len(self.spiritual_texts)} texts")
        return chunks

    def embed_chunks(
        self, chunks: list[dict[str, Any]], verbose: bool = False
    ) -> dict[str, list[EmbeddingResult]]:
        """Generate embeddings for all chunks using all models"""
        results = {model: [] for model in self.models}

        for model in self.models:
            print(f"Generating embeddings with {model}...")
            start_time = time.time()

            # Process all chunks in batch for Voyage AI models
            config = self.model_configs[model]

            if config["provider"] == "voyage":
                # Batch process for Voyage AI
                texts = [chunk["text"] for chunk in chunks]
                try:
                    embedding_args = {
                        "texts": texts,
                        "model": config["model_name"],
                        "input_type": "document",
                    }
                    if config["dimensions"] is not None:
                        embedding_args["output_dimension"] = config["dimensions"]

                    response = self.voyage_client.embed(**embedding_args)

                    for i, (chunk, embedding) in enumerate(
                        zip(chunks, response.embeddings, strict=False)
                    ):
                        embedding_result = EmbeddingResult(
                            text=chunk["text"],
                            embedding=embedding,
                            model=model,
                            chunk_id=chunk["chunk_id"],
                        )
                        results[model].append(embedding_result)

                        if verbose:
                            print(
                                f"  Embedded chunk {chunk['chunk_id']} ({len(chunk['text'])} chars)"
                            )

                except Exception as e:
                    print(f"Error embedding chunks with {model}: {e}")

            else:
                # Individual processing for OpenAI
                for chunk in chunks:
                    try:
                        # Create embedding request with optional dimensions parameter
                        embedding_args = {
                            "input": chunk["text"],
                            "model": config["model_name"],
                        }
                        if config["dimensions"] is not None:
                            embedding_args["dimensions"] = config["dimensions"]

                        response = self.openai_client.embeddings.create(
                            **embedding_args
                        )

                        embedding_result = EmbeddingResult(
                            text=chunk["text"],
                            embedding=response.data[0].embedding,
                            model=model,
                            chunk_id=chunk["chunk_id"],
                        )
                        results[model].append(embedding_result)

                        if verbose:
                            print(
                                f"  Embedded chunk {chunk['chunk_id']} ({len(chunk['text'])} chars)"
                            )

                    except Exception as e:
                        print(
                            f"Error embedding chunk {chunk['chunk_id']} with {model}: {e}"
                        )

            total_time = time.time() - start_time
            print(f"  Completed {len(results[model])} embeddings in {total_time:.2f}s")

        return results

    def query_embeddings(
        self,
        query: str,
        model: str,
        embeddings: list[EmbeddingResult],
        verbose: bool = False,
    ) -> QueryResult:
        """Query embeddings and return top 5 results"""
        start_time = time.time()

        # Generate query embedding
        config = self.model_configs[model]

        try:
            if config["provider"] == "voyage":
                # Use Voyage AI for query embedding
                embedding_args = {
                    "texts": [query],
                    "model": config["model_name"],
                    "input_type": "query",
                }
                if config["dimensions"] is not None:
                    embedding_args["output_dimension"] = config["dimensions"]

                query_response = self.voyage_client.embed(**embedding_args)
                query_embedding = query_response.embeddings[0]
            else:
                # Use OpenAI for query embedding
                embedding_args = {"input": query, "model": config["model_name"]}
                if config["dimensions"] is not None:
                    embedding_args["dimensions"] = config["dimensions"]

                query_response = self.openai_client.embeddings.create(**embedding_args)
                query_embedding = query_response.data[0].embedding

        except Exception as e:
            print(f"Error generating query embedding for '{query}' with {model}: {e}")
            return None

        # Calculate similarities
        similarities = []
        for emb_result in embeddings:
            similarity = cosine_similarity([query_embedding], [emb_result.embedding])[
                0
            ][0]
            similarities.append((similarity, emb_result.text, emb_result.chunk_id))

        # Sort by similarity and get top 5
        similarities.sort(reverse=True)
        top_5 = similarities[:5]

        processing_time = time.time() - start_time
        avg_similarity = np.mean([sim for sim, _, _ in top_5])

        if verbose:
            print(
                f"  Query: '{query[:30]}...' | Model: {model} | Avg Score: {avg_similarity:.3f}"
            )

        return QueryResult(
            query=query,
            model=model,
            top_chunks=top_5,
            avg_similarity=avg_similarity,
            processing_time=processing_time,
        )

    def run_evaluation(
        self, chunking_strategy: str = "paragraph", verbose: bool = False
    ) -> list[QueryResult]:
        """Run full evaluation with specified chunking strategy"""
        print(f"\n=== Running Evaluation with {chunking_strategy} chunking ===")

        # Chunk texts
        chunks = self.chunk_texts(chunking_strategy)

        # Generate embeddings
        embeddings = self.embed_chunks(chunks, verbose)

        # Run queries
        all_results = []

        for query in self.test_queries:
            for model in self.models:
                result = self.query_embeddings(query, model, embeddings[model], verbose)
                if result:
                    all_results.append(result)

        return all_results

    def manual_relevance_scoring(self, results: list[QueryResult]) -> dict[str, Any]:
        """Placeholder for manual relevance scoring - returns dummy scores for demo"""
        print("\n=== Manual Relevance Scoring ===")
        print(
            "In a real evaluation, you would manually rate each chunk's relevance (0-3)"
        )
        print("For this demo, we'll use similarity scores as a proxy")

        # Group results by model
        ada_results = [r for r in results if r.model == "text-embedding-ada-002"]
        voyage_results = [r for r in results if r.model == "voyage-3-large-2048"]

        # Calculate precision@5 using similarity threshold (0.3 as "relevant")
        def calc_precision_at_5(model_results):
            relevant_count = 0
            total_count = 0

            for result in model_results:
                for sim_score, _, _ in result.top_chunks:
                    total_count += 1
                    if sim_score > 0.3:  # Threshold for "relevant"
                        relevant_count += 1

            return relevant_count / total_count if total_count > 0 else 0

        ada_precision = calc_precision_at_5(ada_results)
        voyage_precision = calc_precision_at_5(voyage_results)

        return {
            "ada_002_precision_at_5": ada_precision,
            "voyage_large_2048_precision_at_5": voyage_precision,
            "total_ada_queries": len(ada_results),
            "total_voyage_queries": len(voyage_results),
        }

    def generate_comparison_summary(
        self, results: list[QueryResult]
    ) -> ComparisonSummary:
        """Generate comparison summary between models"""
        ada_results = [r for r in results if r.model == "text-embedding-ada-002"]
        voyage_results = [r for r in results if r.model == "voyage-3-large-2048"]

        ada_avg_sim = np.mean([r.avg_similarity for r in ada_results])
        voyage_avg_sim = np.mean([r.avg_similarity for r in voyage_results])

        ada_avg_time = np.mean([r.processing_time for r in ada_results])
        voyage_avg_time = np.mean([r.processing_time for r in voyage_results])

        # Get precision scores
        precision_data = self.manual_relevance_scoring(results)

        return ComparisonSummary(
            ada_002_avg_similarity=ada_avg_sim,
            voyage_large_2048_avg_similarity=voyage_avg_sim,
            ada_002_avg_time=ada_avg_time,
            voyage_large_2048_avg_time=voyage_avg_time,
            ada_002_precision_at_5=precision_data["ada_002_precision_at_5"],
            voyage_large_2048_precision_at_5=precision_data[
                "voyage_large_2048_precision_at_5"
            ],
        )

    def print_results(
        self,
        summary: ComparisonSummary,
        results: list[QueryResult],
        verbose: bool = False,
    ):
        """Print formatted results"""
        print("\n" + "=" * 80)
        print("EMBEDDING MODEL COMPARISON RESULTS")
        print("=" * 80)

        print("\nPERFORMANCE METRICS:")
        print(f"{'Metric':<25} {'ada-002':<15} {'voyage-2048':<15}")
        print("-" * 55)

        print(
            f"{'Avg Similarity':<25} {summary.ada_002_avg_similarity:<15.3f} {summary.voyage_large_2048_avg_similarity:<15.3f}"
        )
        print(
            f"{'Avg Time (s)':<25} {summary.ada_002_avg_time:<15.3f} {summary.voyage_large_2048_avg_time:<15.3f}"
        )
        print(
            f"{'Precision@5':<25} {summary.ada_002_precision_at_5:<15.3f} {summary.voyage_large_2048_precision_at_5:<15.3f}"
        )

        # Comparison against ada-002 as baseline
        print("\nIMPROVEMENT vs ada-002:")
        print(f"{'Metric':<25} {'voyage-2048':<15}")
        print("-" * 40)

        voyage_sim_improvement = (
            (summary.voyage_large_2048_avg_similarity / summary.ada_002_avg_similarity)
            - 1
        ) * 100
        voyage_time_improvement = (
            (summary.ada_002_avg_time / summary.voyage_large_2048_avg_time) - 1
        ) * 100
        voyage_precision_improvement = (
            (summary.voyage_large_2048_precision_at_5 / summary.ada_002_precision_at_5)
            - 1
        ) * 100

        print(f"{'Similarity':<25} {voyage_sim_improvement:>+.1f}%")
        print(f"{'Speed':<25} {voyage_time_improvement:>+.1f}%")
        print(f"{'Precision@5':<25} {voyage_precision_improvement:>+.1f}%")

        if verbose:
            print("\nSAMPLE QUERY RESULTS:")
            sample_query = "How do I start taking spiritual seclusions?"

            for model in [
                "text-embedding-ada-002",
                "voyage-3-large-1024",
                "voyage-3-large-1536",
            ]:
                model_results = [
                    r for r in results if r.model == model and r.query == sample_query
                ]
                if model_results:
                    result = model_results[0]
                    print(f"\nQuery: '{sample_query}'")
                    print(f"Model: {model}")
                    print(f"Top chunk: {result.top_chunks[0][1][:100]}...")
                    print(f"Similarity: {result.top_chunks[0][0]:.3f}")

        # Recommendations
        print("\nRECOMMENDATIONS:")

        # Find best performing model for similarity
        similarities = [
            ("ada-002", summary.ada_002_avg_similarity),
            ("voyage-2048", summary.voyage_large_2048_avg_similarity),
        ]
        best_similarity = max(similarities, key=lambda x: x[1])

        # Find fastest model
        times = [
            ("ada-002", summary.ada_002_avg_time),
            ("voyage-2048", summary.voyage_large_2048_avg_time),
        ]
        fastest = min(times, key=lambda x: x[1])

        # Find best precision
        precisions = [
            ("ada-002", summary.ada_002_precision_at_5),
            ("voyage-2048", summary.voyage_large_2048_precision_at_5),
        ]
        best_precision = max(precisions, key=lambda x: x[1])

        print(f"🎯 Best similarity: {best_similarity[0]} ({best_similarity[1]:.3f})")
        print(f"⚡ Fastest: {fastest[0]} ({fastest[1]:.3f}s)")
        print(f"🔍 Best precision@5: {best_precision[0]} ({best_precision[1]:.3f})")

        # Overall recommendation
        if best_similarity[0] == "ada-002" and best_precision[0] == "ada-002":
            print(
                "\n✅ OVERALL: Continue using text-embedding-ada-002 for spiritual content"
            )
        elif "voyage" in best_similarity[0] and "voyage" in best_precision[0]:
            print(
                f"\n🚀 OVERALL: {best_similarity[0]} shows promise for spiritual content"
            )
        else:
            print(
                "\n⚖️  OVERALL: Mixed results - consider use case priorities (speed vs accuracy)"
            )


def main():
    parser = argparse.ArgumentParser(
        description="Compare embedding models on spiritual content"
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--save-results", "-s", help="Save results to JSON file")
    parser.add_argument(
        "--chunking",
        "-c",
        choices=["paragraph", "fixed_small", "fixed_medium"],
        default="paragraph",
        help="Chunking strategy",
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID to load environment variables (e.g., ananda)",
    )

    args = parser.parse_args()

    # Load environment variables for the specified site
    try:
        load_env(args.site)
        print(f"✓ Successfully loaded .env.{args.site}")
    except Exception as e:
        print(f"✗ Error loading environment: {e}")
        return 1

    # Check for required API keys
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set")
        return 1

    if not os.getenv("VOYAGE_API_KEY"):
        print("Error: VOYAGE_API_KEY environment variable not set")
        return 1

    comparator = EmbeddingModelComparator()

    try:
        # Run evaluation
        results = comparator.run_evaluation(args.chunking, args.verbose)

        # Generate summary
        summary = comparator.generate_comparison_summary(results)

        # Print results
        comparator.print_results(summary, results, args.verbose)

        # Save results if requested
        if args.save_results:
            output_data = {
                "summary": asdict(summary),
                "results": [asdict(r) for r in results],
                "chunking_strategy": args.chunking,
                "timestamp": time.time(),
            }

            with open(args.save_results, "w") as f:
                json.dump(output_data, f, indent=2)

            print(f"\nResults saved to {args.save_results}")

    except Exception as e:
        print(f"Error during evaluation: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
