#!/usr/bin/env python3
"""
Inspect what's actually in a Pinecone namespace.

Usage:
    python scripts/inspect_pinecone_namespace.py --site ananda-public
"""

import argparse
import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

import dotenv
from pinecone import Pinecone


def load_environment_for_site(site: str):
    """Load environment variables for the specified site."""
    project_root = Path(__file__).parent.parent.parent
    env_path = project_root / f".env.{site}"

    if not env_path.exists():
        print(f"Error: Environment file {env_path} not found")
        sys.exit(1)

    dotenv.load_dotenv(env_path)
    print(f"Loaded environment from {env_path}")


def inspect_namespace(site: str):
    """Inspect what's in the Pinecone namespace."""

    # Load environment
    load_environment_for_site(site)

    # Initialize Pinecone
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        print("Error: PINECONE_API_KEY not found in environment")
        sys.exit(1)

    pc = Pinecone(api_key=api_key)
    index_name = os.getenv("PINECONE_INDEX_NAME", "ananda-library-chatbot")
    index = pc.Index(index_name)

    print(f"\n🔍 Inspecting Pinecone namespace: {site}")
    print("=" * 60)

    try:
        # Get index stats
        stats = index.describe_index_stats()
        print(f"Total vectors: {stats.total_vector_count}")

        if hasattr(stats, "namespaces") and stats.namespaces:
            print("\nNamespaces:")
            for ns_name, ns_stats in stats.namespaces.items():
                print(f"  {ns_name}: {ns_stats.vector_count} vectors")

        # Try to query for any vectors in this namespace
        dummy_vector = [0.0] * 1536

        # Query without any filters to see what's there
        query_response = index.query(
            vector=dummy_vector,
            top_k=10,
            include_metadata=True,
            namespace=site,
        )

        print(
            f"\n📊 Found {len(query_response.matches)} vectors in namespace '{site}':"
        )

        if query_response.matches:
            # Analyze content types
            content_types = {}
            libraries = {}
            sources = set()

            for match in query_response.matches:
                if match.metadata:
                    # Count content types
                    content_type = match.metadata.get("content_type", "unknown")
                    content_types[content_type] = content_types.get(content_type, 0) + 1

                    # Count libraries
                    library = match.metadata.get("library", "unknown")
                    libraries[library] = libraries.get(library, 0) + 1

                    # Collect source types
                    source_location = match.metadata.get("source_location", "")
                    if source_location:
                        if source_location.startswith("http"):
                            sources.add("web")
                        elif source_location.endswith(".pdf"):
                            sources.add("pdf")
                        else:
                            sources.add("other")

            print("\n📋 Content Types Found:")
            for ct, count in content_types.items():
                print(f"  {ct}: {count}")

            print("\n📚 Libraries Found:")
            for lib, count in libraries.items():
                print(f"  {lib}: {count}")

            print("\n🔗 Source Types:")
            for source in sources:
                print(f"  {source}")

            print("\n📄 Sample vectors:")
            for i, match in enumerate(query_response.matches[:3], 1):
                print(f"\n  Vector {i}:")
                print(f"    ID: {match.id}")
                if match.metadata:
                    print(
                        f"    Content Type: {match.metadata.get('content_type', 'N/A')}"
                    )
                    print(f"    Library: {match.metadata.get('library', 'N/A')}")
                    print(f"    Title: {match.metadata.get('title', 'N/A')}")
                    print(f"    Source: {match.metadata.get('source_location', 'N/A')}")
        else:
            print("❌ No vectors found in this namespace")

    except Exception as e:
        print(f"❌ Error inspecting namespace: {e}")


def main():
    parser = argparse.ArgumentParser(description="Inspect Pinecone namespace contents")
    parser.add_argument(
        "--site", required=True, help="Site identifier (e.g., ananda-public)"
    )

    args = parser.parse_args()

    inspect_namespace(args.site)


if __name__ == "__main__":
    main()
