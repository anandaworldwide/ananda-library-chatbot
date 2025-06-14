import argparse
import os

from pinecone import Pinecone
from util.env_utils import load_env


def get_pinecone_client():
    api_key = os.getenv("PINECONE_API_KEY")

    if not api_key:
        raise ValueError("Pinecone API key not set in .env file")

    return Pinecone(api_key=api_key)


def run():
    parser = argparse.ArgumentParser(description="Delete all Pinecone vectors")
    parser.add_argument('--site', required=True, help='Site ID for environment variables')
    args = parser.parse_args()

    # Load environment variables
    load_env(args.site)

    print("Connecting to Pinecone...")
    try:
        pinecone = get_pinecone_client()
    except Exception as e:
        print(f"Failed to initialize Pinecone: {e}")
        return

    index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")
    if not index_name:
        print("PINECONE_INGEST_INDEX_NAME not set in .env file")
        return

    print(f"Getting Pinecone index: {index_name}")
    try:
        index = pinecone.Index(index_name)
    except Exception as e:
        print(f"Error getting Pinecone index: {e}")
        return

    try:
        stats = index.describe_index_stats()
        total_vector_count = stats.total_vector_count
        print(f"Total vectors in the index: {total_vector_count}")

        if total_vector_count == 0:
            print("The index is already empty. No vectors to delete.")
            return

        confirm = input(
            f"Are you sure you want to delete all {total_vector_count} vectors? (yes/no): "
        )
        if confirm.lower() != "yes":
            print("Deletion cancelled.")
            return

        print("Deleting all vectors...")
        index.delete(delete_all=True)
        print("All vectors have been deleted.")

    except Exception as e:
        print(f"Error during operation: {e}")


if __name__ == "__main__":
    run()
