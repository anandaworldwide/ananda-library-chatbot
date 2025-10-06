#!/usr/bin/env python3
"""
Migration script to delete old per-category rate limit collections.

This script deletes all the old separate rate limit collections
(e.g., dev_login_rateLimits, prod_query_rateLimits, etc.) since
they've been consolidated into unified dev_rateLimits and prod_rateLimits
collections with a category field.

Usage:
    python bin/migrate_rate_limits.py --site ananda --env dev
    python bin/migrate_rate_limits.py --site ananda --env prod --dry-run
"""

import argparse
import json
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

from pyutil.env_utils import load_env


def initialize_firebase():
    """Initialize Firebase Admin SDK using GOOGLE_APPLICATION_CREDENTIALS."""

    try:
        # Try to get existing app
        firebase_admin.get_app()
        print("Using existing Firebase app")
    except ValueError:
        # Initialize new app
        credentials_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not credentials_json:
            raise ValueError(
                "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set"
            ) from None

        try:
            credentials_dict = json.loads(credentials_json)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Error decoding GOOGLE_APPLICATION_CREDENTIALS JSON: {e}"
            ) from e

        cred = credentials.Certificate(credentials_dict)
        firebase_admin.initialize_app(cred)
        print("Initialized new Firebase app")

    return firestore.client()


def get_all_collections(db):
    """Get all collection names from Firestore."""
    collections = db.collections()
    return [col.id for col in collections]


def delete_collection(db, collection_name, batch_size=100):
    """
    Delete all documents in a collection in batches.

    Args:
        db: Firestore client
        collection_name: Name of collection to delete
        batch_size: Number of documents to delete per batch
    """
    coll_ref = db.collection(collection_name)
    deleted = 0

    while True:
        # Get a batch of documents
        docs = coll_ref.limit(batch_size).stream()
        doc_list = list(docs)

        if not doc_list:
            break

        # Delete documents in batch
        batch = db.batch()
        for doc in doc_list:
            batch.delete(doc.reference)
        batch.commit()

        deleted += len(doc_list)
        print(f"  Deleted {deleted} documents from {collection_name}...")

    return deleted


def main():
    """Parse arguments and run the migration."""
    parser = argparse.ArgumentParser(
        description="Delete old per-category rate limit collections"
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site name for loading environment variables (e.g., ananda, crystal)",
    )
    parser.add_argument(
        "--env",
        required=True,
        choices=["dev", "prod"],
        help="Environment to migrate (dev or prod)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview collections that would be deleted without actually deleting them",
    )

    args = parser.parse_args()

    # Load environment variables for the specified site
    print(f"Loading environment for site: {args.site}")
    load_env(args.site)
    print()

    print("=" * 70)
    print(f"Rate Limits Collection Migration ({args.env.upper()})")
    if args.dry_run:
        print("DRY RUN MODE - No changes will be made")
    print("=" * 70)
    print()

    # Check for required environment variable
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        print("ERROR: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set")
        print()
        print(f"Please check your .env.{args.site} file")
        print("This should contain the Firebase service account JSON as a string")
        sys.exit(1)

    # Initialize Firestore
    print("Initializing Firestore connection...")
    db = initialize_firebase()
    print()

    # Get all collections
    print("Fetching all collections...")
    all_collections = get_all_collections(db)
    print(f"Found {len(all_collections)} total collections")
    print()

    # Identify old rate limit collections for the specified environment
    # Pattern: {prefix}_{name}_rateLimits
    env_prefix = args.env
    old_rate_limit_collections = [
        col
        for col in all_collections
        if col.startswith(f"{env_prefix}_")
        and col.endswith("_rateLimits")
        and col != f"{env_prefix}_rateLimits"
    ]

    if not old_rate_limit_collections:
        print(
            f"No old {args.env} rate limit collections found. Migration already complete!"
        )
        return

    print(
        f"Found {len(old_rate_limit_collections)} old {args.env} rate limit collections to delete:"
    )
    for col in sorted(old_rate_limit_collections):
        print(f"  - {col}")
    print()

    if args.dry_run:
        print("=" * 70)
        print("DRY RUN COMPLETE - No changes were made")
        print(f"Would delete {len(old_rate_limit_collections)} collections")
        print("=" * 70)
        return

    # Confirm deletion
    response = (
        input("Do you want to delete these collections? (yes/no): ").strip().lower()
    )
    if response not in ["yes", "y"]:
        print("Migration cancelled.")
        return

    print()
    print(f"Deleting old {args.env} rate limit collections...")
    print()

    total_deleted = 0
    for collection_name in sorted(old_rate_limit_collections):
        print(f"Processing {collection_name}...")
        deleted = delete_collection(db, collection_name)
        total_deleted += deleted
        print(f"  ✓ Deleted {deleted} documents from {collection_name}")
        print()

    print("=" * 70)
    print("Migration complete!")
    print(f"  Collections deleted: {len(old_rate_limit_collections)}")
    print(f"  Total documents deleted: {total_deleted}")
    print()
    print(f"The unified {args.env} collection:")
    print(f"  - {env_prefix}_rateLimits")
    print("=" * 70)


if __name__ == "__main__":
    main()
