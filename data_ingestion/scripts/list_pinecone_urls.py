#!/usr/bin/env python3
"""
List sample URLs in Pinecone to see what's actually there.

Usage:
    python scripts/list_pinecone_urls.py --site ananda --limit 20
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


def list_sample_urls(site: str, limit: int = 20):
    """List sample URLs from Pinecone to see what's available."""

    # Load environment
    load_environment_for_site(site)

    # Initialize Pinecone
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        print("Error: PINECONE_API_KEY not found in environment")
        sys.exit(1)

    pc = Pinecone(api_key=api_key)
    index_name = os.getenv("PINECONE_INDEX_NAME", "mega-rag-chatbot")
    index = pc.Index(index_name)

    try:
        # Query for any vectors with web content
        vector_dimension = int(os.getenv("OPENAI_EMBEDDING_DIMENSION", 3072))
        dummy_vector = [0.0] * vector_dimension

        # Query for web content (type = "text")
        query_response = index.query(
            vector=dummy_vector,
            filter={"type": {"$eq": "text"}},
            top_k=limit,
            include_metadata=True,
        )

        print(f"\n🔍 Found {len(query_response.matches)} web content vectors:")
        print("=" * 100)

        # Group by URL
        urls_seen = set()
        url_count = 0

        for match in query_response.matches:
            if match.metadata:
                source_url = match.metadata.get("source", "N/A")
                if source_url not in urls_seen and source_url != "N/A":
                    urls_seen.add(source_url)
                    url_count += 1

                    title = match.metadata.get("title", "N/A")
                    library = match.metadata.get("library", "N/A")

                    print(f"\n📄 URL {url_count}: {source_url}")
                    print(f"   Title: {title}")
                    print(f"   Library: {library}")

                    if url_count >= 10:  # Show first 10 unique URLs
                        break

        print(f"\n✅ Total unique URLs found: {len(urls_seen)}")
        return list(urls_seen)

    except Exception as e:
        print(f"❌ Error querying Pinecone: {e}")
        return []


def main():
    parser = argparse.ArgumentParser(description="List sample URLs in Pinecone")
    parser.add_argument("--site", required=True, help="Site identifier (e.g., ananda)")
    parser.add_argument(
        "--limit", type=int, default=50, help="Maximum number of vectors to query"
    )

    args = parser.parse_args()

    print("🔍 Listing sample URLs in Pinecone...")
    print(f"Site: {args.site}")

    urls = list_sample_urls(args.site, args.limit)

    if urls:
        print("\n📋 Sample URLs for testing removal:")
        for i, url in enumerate(urls[:5], 1):
            print(f"{i}. {url}")


if __name__ == "__main__":
    main()
