#!/usr/bin/env python3
"""
Query Pinecone to see what vectors exist for a specific URL.

Usage:
    python scripts/query_pinecone_url.py --site ananda --url "https://www.ananda.org/?p=582483&preview=true"
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


def normalize_url(url: str) -> str:
    """Normalize URL for consistent matching."""
    # Basic normalization - remove www, trailing slash, convert to lowercase
    normalized = url.lower().strip()
    if normalized.startswith("http://www."):
        normalized = normalized.replace("http://www.", "http://", 1)
    elif normalized.startswith("https://www."):
        normalized = normalized.replace("https://www.", "https://", 1)

    if normalized.endswith("/"):
        normalized = normalized[:-1]

    return normalized


def query_url_vectors(site: str, url: str, limit: int = 100):
    """Query Pinecone for vectors matching the given URL."""

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

    # Normalize URL for consistent matching
    normalized_url = normalize_url(url)
    print(f"Searching for URL: {normalized_url}")
    print(f"Original URL: {url}")

    try:
        # Query using metadata filter
        vector_dimension = int(os.getenv("OPENAI_EMBEDDING_DIMENSION", 3072))
        dummy_vector = [0.0] * vector_dimension

        # Query with metadata filter for the URL
        query_response = index.query(
            vector=dummy_vector,
            filter={"source": {"$eq": normalized_url}},
            top_k=limit,
            include_metadata=True,
        )

        print(f"\n🔍 Found {len(query_response.matches)} vectors for this URL:")
        print("=" * 80)

        for i, match in enumerate(query_response.matches, 1):
            print(f"\n📄 Vector {i}:")
            print(f"   ID: {match.id}")
            print(f"   Score: {match.score:.4f}")

            if match.metadata:
                metadata = match.metadata
                print(f"   Title: {metadata.get('title', 'N/A')}")
                print(f"   Content Type: {metadata.get('content_type', 'N/A')}")
                print(f"   Library: {metadata.get('library', 'N/A')}")
                print(f"   Source: {metadata.get('source', 'N/A')}")
                print(f"   URL: {metadata.get('url', 'N/A')}")
                print(f"   Type: {metadata.get('type', 'N/A')}")
                print(f"   Chunk Index: {metadata.get('chunk_index', 'N/A')}")
                print(f"   Total Chunks: {metadata.get('total_chunks', 'N/A')}")

                # Show first 200 chars of content
                content = metadata.get("content", "")
                if content:
                    preview = content[:200] + "..." if len(content) > 200 else content
                    print(f"   Content Preview: {preview}")
            else:
                print("   No metadata available")

        if not query_response.matches:
            print("❌ No vectors found for this URL")
            print("\nPossible reasons:")
            print("1. URL hasn't been crawled yet")
            print("2. URL normalization mismatch")
            print("3. Content is in a different namespace")
            print("4. URL was already removed")

        return len(query_response.matches)

    except Exception as e:
        print(f"❌ Error querying Pinecone: {e}")
        return 0


def main():
    parser = argparse.ArgumentParser(
        description="Query Pinecone for vectors from a specific URL"
    )
    parser.add_argument("--site", required=True, help="Site identifier (e.g., ananda)")
    parser.add_argument("--url", required=True, help="URL to search for")
    parser.add_argument(
        "--limit", type=int, default=100, help="Maximum number of vectors to return"
    )

    args = parser.parse_args()

    print("🔍 Querying Pinecone for URL vectors...")
    print(f"Site: {args.site}")
    print(f"URL: {args.url}")

    count = query_url_vectors(args.site, args.url, args.limit)

    print(f"\n✅ Query complete. Found {count} vectors.")


if __name__ == "__main__":
    main()
