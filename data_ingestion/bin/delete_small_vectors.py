"""Utility to purge Pinecone vectors from the ingest index whose text content is shorter than a specified token threshold.

This script operates on the Pinecone ingest index (configured via PINECONE_INGEST_INDEX_NAME)
to remove vectors with minimal text content that may not provide meaningful search results.

Located in data_ingestion/bin to match other maintenance scripts.

Usage:
    python delete_small_vectors.py --site ananda-public --threshold 10 --library ananda.org [--dry-run]
"""

from __future__ import annotations

import argparse
import sys

import tiktoken
from pinecone import Index  # type: ignore
from tqdm import tqdm

from data_ingestion.utils.pinecone_utils import (
    get_pinecone_client,
    get_pinecone_ingest_index_name,
)
from pyutil.env_utils import load_env  # noqa: E402

BATCH_LIST_LIMIT = 100  # max ids returned per `list` call
BATCH_FETCH_LIMIT = 100  # ids to fetch per request
BATCH_DELETE_LIMIT = 1000  # ids to delete per request


def _count_tokens(text: str, encoder) -> int:  # type: ignore[arg-type]
    """Return GPT-style token count using *encoder*."""
    return len(encoder.encode(text)) if text else 0


def _gather_candidate_ids(
    index: Index,
    token_threshold: int,
    encoder,
    library: str | None = None,
    verbose: bool = True,
) -> list[str]:
    """Return vector IDs whose text metadata has < *token_threshold* tokens."""

    prefix = f"text||{library}||" if library else None
    list_kwargs: dict = {"limit": BATCH_LIST_LIMIT}
    if prefix:
        list_kwargs["prefix"] = prefix

    ids_to_delete: list[str] = []
    total_seen = 0

    scope = f"library '{library}'" if library else "entire index"
    print(f"Scanning {scope} for vectors below {token_threshold} tokens…")

    pbar = tqdm(total=None, desc="Scanning", unit="vec")

    for id_batch in index.list(**list_kwargs):
        if not id_batch:
            continue
        ids = [getattr(v, "id", v) for v in id_batch]
        total_seen += len(ids)
        for i in range(0, len(ids), BATCH_FETCH_LIMIT):
            fetch_ids = ids[i : i + BATCH_FETCH_LIMIT]
            fetched = index.fetch(ids=fetch_ids)
            for vid, vector in fetched.vectors.items():
                text = (
                    vector.metadata.get("text")
                    or vector.metadata.get("pageContent")
                    or ""
                )
                if _count_tokens(text, encoder) <= token_threshold:
                    ids_to_delete.append(vid)
            pbar.update(len(fetch_ids))

    pbar.close()

    if verbose:
        print(
            f"Scanned {total_seen:,} vectors. Identified {len(ids_to_delete):,} candidates for deletion."
        )
    return ids_to_delete


def _delete_vectors(
    index: Index, ids: list[str], dry_run: bool, verbose: bool = True
) -> None:
    """Delete *ids* from *index* in batches; honour *dry_run*."""
    if dry_run:
        print("Dry-run active—no vectors deleted.")
        return
    if not ids:
        print("No vectors matched criteria; nothing to delete.")
        return

    for i in range(0, len(ids), BATCH_DELETE_LIMIT):
        batch = ids[i : i + BATCH_DELETE_LIMIT]
        index.delete(ids=batch)
        if verbose:
            print(f"Deleted {i + len(batch):,}/{len(ids):,} vectors…")
    if verbose:
        print("Deletion complete.")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Delete Pinecone vectors below a token threshold."
    )
    p.add_argument(
        "--site",
        required=True,
        help="Site ID (ananda, crystal, etc.) used to load .env.<site> file.",
    )
    p.add_argument(
        "--threshold",
        type=int,
        required=True,
        help="Token cutoff (inclusive). Vectors with <= this token count are deleted.",
    )
    p.add_argument(
        "--library",
        help="Filter by library prefix (e.g., ananda.org). If omitted, scans entire index.",
    )
    p.add_argument(
        "--dry-run", action="store_true", help="Show counts only; don't delete."
    )
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    if args.threshold <= 0:
        sys.exit("Threshold must be a positive integer.")

    load_env(args.site)

    pc = get_pinecone_client()
    index = pc.Index(get_pinecone_ingest_index_name())
    encoder = tiktoken.get_encoding("cl100k_base")

    ids = _gather_candidate_ids(index, args.threshold, encoder, library=args.library)
    _delete_vectors(index, ids, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
