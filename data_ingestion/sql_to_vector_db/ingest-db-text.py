#!/usr/bin/env python
"""
Ingests text content directly from a WordPress MySQL database into a Pinecone vector index.

This script connects to a specified MySQL database, fetches published posts/pages
based on site-specific configurations (post types, taxonomies), cleans the HTML content,
calculates metadata (like author, permalink, categories), splits the text into chunks,
generates embeddings using OpenAI, and upserts the resulting vectors into a specified
Pinecone index. It includes features for checkpointing to resume interrupted ingestions
and options to clear existing data for a specific library before starting.

Command Line Arguments:
    --site: Required. Site name (e.g., ananda, jairam) for config and env loading.
    --database: Required. Name of the MySQL database to connect to.
    --library-name: Required. Name of the library for Pinecone metadata.
    --keep-data: Optional. Keep existing data in Pinecone (resume from checkpoint).
    --batch-size: Optional. Number of documents to process in parallel for embeddings/upserts (default: 50).
    --dry-run: Optional. Perform all steps except Pinecone index creation, deletion, and upsertion.

Example Usage:
    python ingest-db-text.py --site ananda --database wp_ananda --library-name "Ananda Library" --keep-data
"""

import os
import sys
import argparse
import pymysql
import signal
import json
import hashlib
import time
from datetime import datetime
from tqdm import tqdm
from bs4 import BeautifulSoup
from langchain_text_splitters import TokenTextSplitter
from langchain_openai import OpenAIEmbeddings
from pinecone import Pinecone, ServerlessSpec, NotFoundException
from langchain_core.documents import Document
import re 
import math 
# Add the python directory to the path so we can import util
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))
from pyutil.env_utils import load_env

# Directory to store checkpoint files
CHECKPOINT_DIR = os.path.join(os.path.dirname(__file__), 'ingestion_checkpoints')

# Template for naming checkpoint files, specific to each site
CHECKPOINT_FILE_TEMPLATE = os.path.join(CHECKPOINT_DIR, 'db_text_ingestion_checkpoint_{site}.json')

# Default number of documents to process in each embedding/upsert batch
DEFAULT_BATCH_SIZE = 50

# Flag to indicate if a shutdown signal (SIGINT) has been received
is_exiting = False

# --- Signal Handler ---
def signal_handler(sig, frame):
    """Handles SIGINT (Ctrl+C) for graceful shutdown."""
    global is_exiting
    if is_exiting:
        print("\nForced exit. Data may be inconsistent.")
        sys.exit(1)
    else:
        print("\nGraceful shutdown initiated. Finishing current batch and saving checkpoint...")
        is_exiting = True

# --- Argument Parsing ---
def parse_arguments():
    """Parses command-line arguments."""
    parser = argparse.ArgumentParser(description="Ingest text data directly from MySQL DB to Pinecone.")
    parser.add_argument("--site", required=True, help="Site name (e.g., ananda, jairam) for config and env loading.")
    parser.add_argument("--database", required=True, help="Name of the MySQL database to connect to.")
    parser.add_argument("--library-name", required=True, help="Name of the library for Pinecone metadata.")
    parser.add_argument("--keep-data", action="store_true", help="Keep existing data in Pinecone (resume from checkpoint).")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help=f"Number of documents to process in parallel for embeddings/upserts (default: {DEFAULT_BATCH_SIZE}).")
    parser.add_argument("--dry-run", action="store_true", help="Perform all steps except Pinecone index creation, deletion, and upsertion.")
    return parser.parse_args()

# --- Environment Loading ---
def load_environment(site: str):
    """Loads environment variables from the site-specific .env file using the load_env utility."""
    try:
        load_env(site)
        print(f"Loaded environment for site: {site} using load_env utility.")
    except Exception as e:
        # Catch potential errors from load_env (e.g., file not found handled inside)
        print(f"Error loading environment using load_env for site '{site}': {e}")
        sys.exit(1)

    required_vars = ["DB_USER", "DB_PASSWORD", "DB_HOST", "PINECONE_API_KEY", "OPENAI_API_KEY", "PINECONE_INGEST_INDEX_NAME"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)

# --- Database Utilities ---
def get_db_config(args):
    """Constructs the database connection configuration dictionary from environment variables."""
    # Loads DB config from environment variables, similar to db-to-pdfs.py
    # Ensure DB_CHARSET and DB_COLLATION are set in your .env file if needed
    return {
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
        "host": os.getenv("DB_HOST"),
        "database": args.database,
        "charset": os.getenv("DB_CHARSET", "utf8mb4"),
        "collation": os.getenv("DB_COLLATION", "utf8mb4_unicode_ci"),
        "cursorclass": pymysql.cursors.DictCursor # Use DictCursor for easier row access by column name
    }

def get_db_connection(db_config):
    """Establishes and returns a database connection with retry logic."""
    # Establishes DB connection, similar to db-to-pdfs.py
    max_retries = 5
    attempt = 0
    while attempt < max_retries:
        try:
            connection = pymysql.connect(**db_config)
            print("Successfully connected to the database.")
            return connection
        except pymysql.MySQLError as err:
            print(f"Error connecting to MySQL (Attempt {attempt + 1}/{max_retries}): {err}")
            if attempt == max_retries - 1:
                print("Max retries reached. Exiting.")
                sys.exit(1)
            # Exponential backoff
            time.sleep(2**attempt)
            attempt += 1
    return None # Should not be reached if exit occurs

def close_db_connection(connection):
    """Closes the database connection if it's open."""
    if connection and connection.open:
        connection.close()
        print("Database connection closed.")

# --- Pinecone Utilities ---
def get_pinecone_client() -> Pinecone:
    """Initializes and returns a Pinecone client instance."""
    api_key = os.getenv("PINECONE_API_KEY")
    if not api_key:
        raise ValueError("PINECONE_API_KEY environment variable not set.")
    # Environment might not be needed for serverless initialization
    # return Pinecone(api_key=api_key, environment=environment)
    return Pinecone(api_key=api_key)


def create_pinecone_index_if_not_exists(pinecone: Pinecone, index_name: str, dry_run: bool = False):
    """Checks if the specified Pinecone index exists, creates it if not, respecting dry_run."""
    # Adapted from ingest-text-data.ts
    try:
        print(f"Checking status of index '{index_name}'...")
        pinecone.describe_index(index_name)
        print(f"Index '{index_name}' already exists.")
    except NotFoundException:
        # This is the expected exception when the index does not exist
        if dry_run:
            print(f"Dry run: Index '{index_name}' does not exist.")
            # Ask if the user wants to create the index even in dry run mode
            confirm = input(f"Would you like to create the index '{index_name}' even in dry run mode? (Y/n): ")
            # Default to yes if user just presses enter or enters anything starting with Y/y
            if confirm.lower() not in ['n', 'no']:
                print(f"Creating index '{index_name}' in dry run mode...")
                try:
                    # Create the index with the same parameters as the non-dry-run case
                    dimension_str = os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION")
                    if not dimension_str:
                        raise ValueError("OPENAI_INGEST_EMBEDDINGS_DIMENSION environment variable not set")
                    dimension = int(dimension_str)
                    metric = 'cosine'
                    spec = ServerlessSpec(
                        cloud=os.getenv("PINECONE_CLOUD", 'aws'),
                        region=os.getenv("PINECONE_REGION", 'us-west-2')
                    )

                    pinecone.create_index(
                        name=index_name,
                        dimension=dimension,
                        metric=metric,
                        spec=spec
                    )
                    
                    print(f"Waiting for index '{index_name}' to be created (this may take a moment)...")
                    start_wait_time = time.time()
                    wait_timeout = 300  # 5 minutes timeout for index creation
                    while not pinecone.describe_index(index_name).status['ready']:
                        time.sleep(5)
                        if time.time() - start_wait_time > wait_timeout:
                            print(f"Error: Timeout waiting for index '{index_name}' to become ready.")
                            sys.exit(1)
                    print(f"Index '{index_name}' created successfully.")
                    
                except Exception as create_error:
                    print(f"Error creating Pinecone index '{index_name}': {create_error}")
                    sys.exit(1)
            else:
                # User declined to create the index
                print("Index creation declined. Cannot proceed in dry run mode without an existing index.")
                sys.exit(1)
        else:
            print(f"Index '{index_name}' does not exist. Creating...")
            try:
                # Dimension for OpenAI text-embedding-ada-002
                dimension_str = os.getenv("OPENAI_INGEST_EMBEDDINGS_DIMENSION")
                if not dimension_str:
                    raise ValueError("OPENAI_INGEST_EMBEDDINGS_DIMENSION environment variable not set")
                dimension = int(dimension_str)
                # Using cosine similarity as it's common for text embeddings
                metric = 'cosine'
                # Specify serverless configuration
                # Ensure the cloud and region match your Pinecone setup
                spec = ServerlessSpec(
                    cloud=os.getenv("PINECONE_CLOUD", 'aws'),
                    region=os.getenv("PINECONE_REGION", 'us-west-2')
                )

                pinecone.create_index(
                    name=index_name,
                    dimension=dimension,
                    metric=metric,
                    spec=spec
                )
                # Wait for index to be ready before proceeding
                print(f"Waiting for index '{index_name}' to be created (this may take a moment)...")
                # Add a timeout check within the wait loop?
                start_wait_time = time.time()
                wait_timeout = 300 # 5 minutes timeout for index creation
                while not pinecone.describe_index(index_name).status['ready']:
                    time.sleep(5)
                    if time.time() - start_wait_time > wait_timeout:
                        print(f"Error: Timeout waiting for index '{index_name}' to become ready.")
                        sys.exit(1)
                print(f"Index '{index_name}' created successfully.")
            except Exception as create_error:
                # Catch Pinecone specific API errors during creation
                print(f"Error creating Pinecone index '{index_name}': {create_error}")
                sys.exit(1)
            except Exception as general_create_error:
                # Catch any other unexpected errors during creation
                print(f"Unexpected error creating Pinecone index '{index_name}': {general_create_error}")
                sys.exit(1)

    except Exception as e:
        # Catch any other unexpected errors during description
        print(f"Unexpected error checking Pinecone index status for '{index_name}': {e}")
        sys.exit(1)

# --- Checkpoint Utilities ---
def get_checkpoint_file_path(site: str) -> str:
    """Constructs the full path for the site's checkpoint file."""
    return CHECKPOINT_FILE_TEMPLATE.format(site=site)

def load_checkpoint(checkpoint_file: str) -> dict | None:
    """Loads checkpoint data from a JSON file if it exists and is valid."""
    if not os.path.exists(checkpoint_file):
        return None
    try:
        with open(checkpoint_file, 'r', encoding='utf-8') as f:
            checkpoint_data = json.load(f)
            # Basic validation of checkpoint structure
            if isinstance(checkpoint_data.get('processed_doc_ids'), list) and isinstance(checkpoint_data.get('last_processed_id'), int):
                 print(f"Loaded checkpoint from {checkpoint_file}")
                 return checkpoint_data
            else:
                print(f"Invalid checkpoint format in {checkpoint_file}. Ignoring.")
                return None
    except json.JSONDecodeError:
        print(f"Error decoding JSON from checkpoint file {checkpoint_file}. Ignoring.")
        return None
    except Exception as e:
        print(f"Error loading checkpoint {checkpoint_file}: {e}")
        return None

def save_checkpoint(checkpoint_file: str, processed_doc_ids: list[int], last_processed_id: int):
    """Saves the current ingestion state (processed IDs) to a checkpoint file."""
    try:
        os.makedirs(CHECKPOINT_DIR, exist_ok=True)
        # Store unique, sorted IDs for consistency
        checkpoint_data = {
            'processed_doc_ids': sorted(list(set(processed_doc_ids))),
            'last_processed_id': last_processed_id,
            'timestamp': datetime.now().isoformat()
        }
        with open(checkpoint_file, 'w', encoding='utf-8') as f:
            json.dump(checkpoint_data, f, indent=2)
        # Frequent saving can be noisy, uncomment if needed for debugging
        # print(f"Checkpoint saved to {checkpoint_file} (Last ID: {last_processed_id})")
    except Exception as e:
        print(f"Error saving checkpoint to {checkpoint_file}: {e}")


# --- Text Cleaning Utilities (adapted from db-to-pdfs.py) ---
def remove_html_tags(text):
    """Removes HTML tags, script, style elements, and excessive whitespace from text."""
    if not text:
        return ""
    # Use BeautifulSoup to parse and remove unwanted tags
    soup = BeautifulSoup(text, "html.parser")
    for script_or_style in soup(["script", "style"]):
        script_or_style.decompose() # Remove script and style elements
    # Get text content
    text = soup.get_text()
    # Replace multiple whitespace characters with a single space and strip leading/trailing whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def replace_smart_quotes(text):
    """Replaces common 'smart' quotes and other special characters with standard ASCII equivalents."""
    if not text:
        return ""
    # Dictionary mapping smart characters to standard ones
    smart_quotes = {
        "\u2018": "'", "\u2019": "'", # Single quotes
        "\u201c": '"', "\u201d": '"', # Double quotes
        "\u2032": "'", "\u2033": '"', # Prime symbols
        "\u2014": "-", "\u2013": "-", # Dashes
        "\u2026": "...",             # Ellipsis
        "\u2011": "-",               # Non-breaking hyphen
        "\u00A0": " ",               # Non-breaking space
        "\u00AB": '"', "\u00BB": '"', # Guillemets
        "\u201A": ",", "\u201E": ",", # Low single/double quotes as commas
        "\u2022": "*",               # Bullet
        "\u2010": "-",               # Hyphen
    }
    for smart, standard in smart_quotes.items():
        text = text.replace(smart, standard)
    # Optionally remove any remaining non-ASCII characters
    # This version keeps basic ASCII and common whitespace characters
    # Adjust this line if other specific Unicode characters need to be preserved
    text = ''.join(c for c in text if ord(c) < 128 or c in [' ', '\n', '\t'])
    return text

# --- Site Configuration ---
def get_config(site):
    """Loads site-specific configuration details."""
    config = {
        "ananda": {
            "base_url": "https://www.anandalibrary.org/", # Base URL for constructing permalinks
            "post_types": ["content"], # WordPress post types to ingest
            "category_taxonomy": "library-category" # The WP taxonomy name used for categories
        },
    }
    if site not in config:
        print(f"Error: Site configuration for '{site}' not found.")
        sys.exit(1)
    print(f"Using configuration for site: {site}")
    return config[site]

# --- Data Fetching Logic ---
def fetch_authors(db_connection) -> dict[int, str]:
    """Fetches user IDs and display names from the wp_users table."""
    authors = {}
    try:
        with db_connection.cursor() as cursor:
            cursor.execute("SELECT ID, display_name FROM wp_users")
            results = cursor.fetchall()
            for row in results:
                authors[row['ID']] = row['display_name']
        print(f"Fetched {len(authors)} authors from wp_users.")
        return authors
    except pymysql.MySQLError as e:
        print(f"Error fetching authors: {e}")
        # Treat this as a critical error, as author info is important metadata
        sys.exit(1)

def calculate_permalink(
    base_url: str,
    post_type: str,
    post_date: datetime,
    post_name: str,
    parent_slug_1: str | None,
    parent_slug_2: str | None,
    parent_slug_3: str | None,
    site: str = None
) -> str:
    """Calculates the likely permalink based on WP structure and site-specific configurations, including multiple parent slugs."""

    if site == "ananda" and post_type == "content":
        # Build the ancestor path by filtering out None slugs and joining them
        ancestor_slugs = [slug for slug in [parent_slug_3, parent_slug_2, parent_slug_1] if slug]
        # Join slugs in the correct order: great-grandparent/grandparent/parent
        ancestor_path = "/".join(ancestor_slugs)

        if ancestor_path:
            path_part = f"content/{ancestor_path}/{post_name}/"
        else:
            # Fallback if no parent slugs are found
            path_part = f"content/{post_name}/"
    elif post_type == 'page':
        # Pages typically use just the slug
        path_part = f"{post_name}/"
    else:
        # Default: Posts typically use year/month/slug structure
        path_part = f"{post_date.year}/{post_date.month:02d}/{post_name}/"

    # Ensure base_url ends with a slash and path_part doesn't start with one for clean joining
    if not base_url.endswith('/'):
        base_url += '/'
    if path_part.startswith('/'):
        path_part = path_part[1:]

    return base_url + path_part

def fetch_data(db_connection, site_config: dict, library_name: str, authors: dict, site: str) -> list[dict]:
    """Fetches, cleans, and prepares post data from the database for ingestion."""
    post_types = site_config['post_types']
    category_taxonomy = site_config['category_taxonomy']
    # Use the confirmed taxonomy slug for authors
    author_taxonomy = 'library-author'
    base_url = site_config['base_url']
    # Create placeholders for the SQL query IN clauses
    placeholders = ', '.join(['%s'] * len(post_types))

    # Construct the main SQL query to fetch posts, their parent titles (up to 3 levels),
    # associated categories, and associated authors from the specified taxonomies.
    query = f"""
        SELECT
            child.ID,
            child.post_content,
            child.post_name,
            parent.post_title AS PARENT_TITLE_1,  -- Immediate parent
            parent.post_name AS PARENT_SLUG_1,    -- Immediate parent slug
            parent2.post_title AS PARENT_TITLE_2, -- Grandparent
            parent2.post_name AS PARENT_SLUG_2,   -- Grandparent slug
            parent3.post_title AS PARENT_TITLE_3, -- Great-grandparent
            parent3.post_name AS PARENT_SLUG_3,   -- Great-grandparent slug
            parent3.post_author AS PARENT3_AUTHOR_ID, -- Great-grandparent User ID (might be unused now)
            child.post_title AS CHILD_TITLE,      -- The post's own title
            child.post_author,                     -- Child User ID (might be unused now)
            child.post_date,
            child.post_type,
            -- Concatenate distinct category names using a unique separator
            GROUP_CONCAT(DISTINCT cat_terms.name SEPARATOR '|||') AS categories,
            -- Concatenate distinct author names using a unique separator
            GROUP_CONCAT(DISTINCT author_terms.name SEPARATOR '|||') AS authors_list
        FROM
            wp_posts AS child
            -- Joins for parent hierarchy
            LEFT JOIN wp_posts AS parent ON child.post_parent = parent.ID AND parent.post_type IN ({placeholders})
            LEFT JOIN wp_posts AS parent2 ON parent.post_parent = parent2.ID AND parent2.post_type IN ({placeholders})
            LEFT JOIN wp_posts AS parent3 ON parent2.post_parent = parent3.ID AND parent3.post_type IN ({placeholders})
            -- Joins for Categories
            LEFT JOIN wp_term_relationships AS cat_tr ON child.ID = cat_tr.object_id
            LEFT JOIN wp_term_taxonomy AS cat_tt ON cat_tr.term_taxonomy_id = cat_tt.term_taxonomy_id AND cat_tt.taxonomy = %s
            LEFT JOIN wp_terms AS cat_terms ON cat_tt.term_id = cat_terms.term_id
            -- Joins for Authors (using assumed 'author' taxonomy)
            LEFT JOIN wp_term_relationships AS author_tr ON child.ID = author_tr.object_id
            LEFT JOIN wp_term_taxonomy AS author_tt ON author_tr.term_taxonomy_id = author_tt.term_taxonomy_id AND author_tt.taxonomy = %s
            LEFT JOIN wp_terms AS author_terms ON author_tt.term_id = author_terms.term_id
        WHERE
            child.post_status = 'publish'           -- Only published posts
            AND child.post_type IN ({placeholders}) -- Only desired post types
        GROUP BY
            -- Group by all selected post fields to ensure one row per post
            child.ID, child.post_content, child.post_name, PARENT_TITLE_1, PARENT_TITLE_2, PARENT_TITLE_3, PARENT3_AUTHOR_ID,
            CHILD_TITLE, child.post_author, child.post_date, child.post_type
        ORDER BY
            child.ID; -- Order by ID for potentially easier debugging/checkpointing
        """

    processed_data = []
    try:
        with db_connection.cursor() as cursor:
            # Parameters: post_types for parents, category taxonomy, author taxonomy, post_types for child WHERE clause
            params = post_types * 3 + [category_taxonomy, author_taxonomy] + post_types
            print("Executing main data fetching query (including authors)...")
            start_time = time.time()
            cursor.execute(query, params)
            results = cursor.fetchall() # Fetch all results at once
            end_time = time.time()
            print(f"Query executed in {end_time - start_time:.2f} seconds. Found {len(results)} posts matching criteria.")

            print("Processing fetched rows to prepare for ingestion...")
            # Iterate through fetched rows with a progress bar
            for row in tqdm(results, desc="Preparing Data"):
                # Combine parent titles and the post's title into a hierarchical string
                titles = [
                    title for title in [
                        row.get('PARENT_TITLE_3'), # Use .get for safety if columns might be missing
                        row.get('PARENT_TITLE_2'),
                        row.get('PARENT_TITLE_1'),
                        row.get('CHILD_TITLE')
                    ] if title # Filter out None or empty titles
                ]
                full_title = ":: ".join(titles) # Use ':: ' as a separator

                # Skip processing if any part of the title indicates it should be excluded
                # This is a convention used in the Ananda Library data
                if any("DO NOT USE" in (title or "") for title in titles):
                    # print(f"Skipping 'DO NOT USE' post ID: {row['ID']}")
                    continue

                # Clean the raw HTML content
                cleaned_content = remove_html_tags(row['post_content'])
                cleaned_content = replace_smart_quotes(cleaned_content)
                # Skip if content becomes empty after cleaning (e.g., posts with only shortcodes/HTML)
                if not cleaned_content:
                    # print(f"Skipping post ID {row['ID']} due to empty content after cleaning.")
                    continue

                # Parse the concatenated categories string
                category_list = []
                if row.get('categories'):
                    # Split by the '|||' separator used in GROUP_CONCAT and strip whitespace
                    category_list = [cat.strip() for cat in row['categories'].split('|||') if cat.strip()]

                # --- Author Assignment (using taxonomy) ---
                author_name = "Unknown" # Default author
                authors_list_str = row.get('authors_list')
                if authors_list_str:
                    # Split the concatenated string, take the first author, strip whitespace
                    potential_authors = [name.strip() for name in authors_list_str.split('|||') if name.strip()]
                    if potential_authors:
                        author_name = potential_authors[0] # Use the first author found
                        # Optional: Handle multiple authors differently if needed, e.g., join them
                        # if len(potential_authors) > 1:
                        #     author_name = ", ".join(potential_authors)
                # --- End Author Assignment ---

                # Calculate the permalink
                permalink = calculate_permalink(
                    base_url=base_url,
                    post_type=row['post_type'],
                    post_date=row['post_date'],
                    post_name=row['post_name'],
                    parent_slug_1=row.get('PARENT_SLUG_1'),
                    parent_slug_2=row.get('PARENT_SLUG_2'),
                    parent_slug_3=row.get('PARENT_SLUG_3'),
                    site=site
                )

                # Append the processed data dictionary to the list
                processed_data.append({
                    "id": row['ID'], # Original WordPress Post ID
                    "title": full_title,
                    "author": author_name, # Now using the name from taxonomy
                    "permalink": permalink, # URL source
                    "content": cleaned_content, # The main text content for embedding
                    "categories": category_list, # Associated categories
                    "library": library_name # Library name for Pinecone metadata filtering
                })
        print(f"Finished processing rows. {len(processed_data)} posts prepared for ingestion.")
        return processed_data

    except pymysql.MySQLError as e:
        print(f"Database error during data fetching or processing: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error during data preparation: {e}")
        import traceback
        traceback.print_exc() # Print traceback for unexpected errors
        sys.exit(1)

# --- Pinecone Vector Deletion ---
def clear_library_vectors(pinecone_index, library_name: str, dry_run: bool = False) -> bool:
    """Deletes all vectors associated with a specific library name prefix, respecting dry_run."""
    if dry_run:
        print(f"Dry run: Skipping vector deletion check for library '{library_name}'.")
        return True # Simulate successful skipping

    # Construct the prefix used for vectors belonging to this library
    prefix = f"text||{library_name}||"
    print(f"Listing existing vectors with prefix '{prefix}' for potential deletion...")
    vector_ids = []
    total_listed = 0
    # batch_limit is not directly used by the generator, but list() might use it internally.
    # Keeping it for clarity or potential future API changes, but removing explicit pagination.
    batch_limit = 100

    try:
        # Iterate directly over the generator returned by list()
        list_response_generator = pinecone_index.list(prefix=prefix, limit=batch_limit)

        # The generator yields lists of IDs per batch
        for id_batch in list_response_generator:
            if is_exiting:
                print("Shutdown signal received during vector listing. Aborting deletion.")
                return False

            # Check if the yielded item is a list (expected format)
            if isinstance(id_batch, list):
                # Add all IDs from the current batch to our main list
                vector_ids.extend(id_batch)
                total_listed += len(id_batch)
            else:
                # Handle potential variations in response format or log a warning
                print(f"Warning: Vector info format unexpected, skipping: {id_batch}")

            # Print progress periodically
            if total_listed > 0 and total_listed % 1000 == 0:
                print(f"Listed {total_listed} vectors so far...")

        print(f"Finished listing. Found a total of {len(vector_ids)} vectors for library '{library_name}'")

    except Exception as e:
        print(f"Error listing vectors for deletion: {e}")
        import traceback
        traceback.print_exc()  # Print full traceback for better debugging
        return False # Indicate error during listing

    if not vector_ids:
        print("No existing vectors found for this library. Nothing to delete.")
        return True # Indicate success (nothing needed to be done)

    print(f"\nFound {len(vector_ids)} existing vectors for library '{library_name}'.")
    # Get user confirmation before deleting
    confirm = input("Proceed with deleting ALL these vectors? This cannot be undone. (y/N): ")
    if confirm.lower() != 'y':
        print("Deletion aborted by user.")
        return False # Indicate aborted by user

    print("Deleting vectors in batches...")
    # Pinecone delete operation can handle up to 1000 IDs per call
    delete_batch_size = 1000
    total_deleted = 0
    try:
        # Iterate through the vector IDs in batches
        for i in tqdm(range(0, len(vector_ids), delete_batch_size), desc="Deleting Batches"):
            if is_exiting:
                 print("Shutdown signal received during deletion. Deletion may be incomplete.")
                 # Saving checkpoint here might be misleading as deletion wasn't fully confirmed complete
                 return False # Indicate incomplete deletion

            batch_ids = vector_ids[i : i + delete_batch_size]
            delete_response = pinecone_index.delete(ids=batch_ids)
            # print(f"Delete response: {delete_response}") # Can be verbose
            total_deleted += len(batch_ids) # Assuming success if no exception

        print(f"Successfully deleted {total_deleted} vectors.")
        return True # Indicate successful deletion
    except Exception as e:
        print(f"Error deleting vectors: {e}")
        # Deletion failed partway through
        return False # Indicate error during deletion

# --- Processing & Upsertion ---
def generate_vector_id(library_name: str, title: str, content_chunk: str, chunk_index: int) -> str:
    """Generates a unique and reproducible vector ID based on metadata and content."""
    # Replicates the ID generation logic from the TypeScript ingest script for consistency.
    # Format: text||libraryName||sanitizedTitle||contentHash||chunkN

    # Sanitize title: replace whitespace, remove non-alphanumeric/underscore, limit length
    sanitized_title = re.sub(r'\s+', '_', title)
    sanitized_title = re.sub(r'[^a-zA-Z0-9_\-]', '', sanitized_title) # Allow hyphens too
    sanitized_title = sanitized_title[:50] # Limit title part length to avoid overly long IDs

    # Generate a short hash of the content chunk to ensure uniqueness if title/chunk# collide
    content_hash = hashlib.md5(content_chunk.encode('utf-8')).hexdigest()[:8]

    # Combine parts with '||' separator
    return f"text||{library_name}||{sanitized_title}||{content_hash}||chunk{chunk_index + 1}"

def process_and_upsert_batch(batch_data: list[dict], pinecone_index, embeddings_model, text_splitter, dry_run: bool = False) -> tuple[bool, list[int]]:
    """Processes a batch of documents: splits, embeds, and upserts to Pinecone, respecting dry_run.

    Returns:
        tuple[bool, list[int]]: A tuple containing:
            - bool: True if any processing errors occurred during the batch, False otherwise.
            - list[int]: A list of post IDs successfully processed in this batch.
    """
    vectors_to_upsert = []
    errors_in_batch = 0
    total_chunks_in_batch = 0
    processed_ids_in_batch = [] # Track IDs successfully processed in this batch

    # Add counter for total chunks processed across all batches (as a list for mutability)
    # Using a list encapsulation to create a mutable reference that persists between function calls
    if not hasattr(process_and_upsert_batch, 'total_chunks_processed'):
        process_and_upsert_batch.total_chunks_processed = [0]

    for post_data in batch_data:
        post_id = post_data.get('id', 'N/A') # Get post ID for logging
        if is_exiting:
            print("Exiting batch processing due to shutdown signal.")
            # Return True if errors occurred before exiting, indicating batch wasn't fully successful
            return True, [] # Return error and empty processed list

        try:
            # 1. Split content into manageable chunks
            # Using Langchain's Document structure helps maintain consistency, though only page_content is strictly needed here
            langchain_doc = Document(page_content=post_data['content'])
            # Split the document using the provided text splitter
            docs = text_splitter.split_documents([langchain_doc])
            total_chunks_in_batch += len(docs)

            if not docs:
                print(f"Warning: Post ID {post_id} resulted in zero chunks after splitting. Skipping.")
                continue # Skip this post if splitting results in nothing

            # 2. Prepare chunk data for embedding and Pinecone upsert
            batch_chunk_texts = [doc.page_content for doc in docs]
            prepared_vectors_data = [] # Store data before embedding

            # Print periodic samples of text being embedded
            for i, doc in enumerate(docs):
                # Update total count and check if we should print a sample
                process_and_upsert_batch.total_chunks_processed[0] += 1

                # Generate the unique ID for this specific chunk vector
                pinecone_id = generate_vector_id(
                    post_data['library'],
                    post_data['title'],
                    doc.page_content,
                    i # Chunk index (0-based)
                )
                # Construct the metadata dictionary to be stored with the vector in Pinecone
                metadata = {
                    # "id": pinecone_id, # ID is provided at the top level in the upsert tuple/dict
                    "library": post_data['library'],
                    "type": 'text', # Indicate the source type
                    "author": post_data['author'],
                    "source": post_data['permalink'], # URL of the original post
                    "title": post_data['title'],
                    "categories": post_data['categories'], # List of categories
                    "text": doc.page_content, # Store the actual text chunk in metadata for retrieval context
                    "wp_id": post_id, # Store original WP ID if needed later
                    "chunk_index": i + 1 # Store 1-based chunk index
                }
                prepared_vectors_data.append({"id": pinecone_id, "metadata": metadata, "page_content": doc.page_content})

            # 3. Generate Embeddings using the provided OpenAI model
            # This makes one API call for all chunks belonging to the current post
            embeddings = embeddings_model.embed_documents(batch_chunk_texts)

            # 4. Combine ID, Embeddings, and Metadata for each chunk into Pinecone's expected format
            for i, vec_data in enumerate(prepared_vectors_data):
                if i < len(embeddings): # Ensure we have a corresponding embedding
                    vectors_to_upsert.append(
                        # Pinecone expects tuples (id, values, metadata) or dicts
                        {"id": vec_data["id"],
                         "values": embeddings[i],
                         "metadata": vec_data["metadata"]}
                    )
                else:
                    print(f"Error: Mismatch between prepared vector data and embeddings for post {post_id}, chunk {i}. Skipping chunk.")
                    errors_in_batch += 1

            # If processing reached this point without critical errors for the post, mark its ID as processed in this batch
            processed_ids_in_batch.append(post_id)

        except Exception as e:
            print(f"Error processing post ID {post_id}: {e}")
            import traceback
            traceback.print_exc() # Print full traceback for debugging
            errors_in_batch += 1
            # Decide whether to continue with the rest of the batch or stop
            continue # Continue processing other posts in the batch for robustness

    # 5. Upsert the accumulated vectors for the entire batch to Pinecone (or simulate in dry run)
    if vectors_to_upsert:
        if not dry_run:
            try:
                print(f"Upserting {len(vectors_to_upsert)} vectors from {len(processed_ids_in_batch)} successfully processed posts ({total_chunks_in_batch} chunks) in this batch...")
                # Pinecone client handles internal batching for upserts, but ensure the list isn't excessively large
                # Upsert vectors; Pinecone client library handles potential batching within the upsert call itself.
                max_upsert_batch_size = 100 # Pinecone recommends batches of 100 or fewer vectors for optimal performance.

                total_upserted = 0

                for j in range(0, len(vectors_to_upsert), max_upsert_batch_size):
                    upsert_batch = vectors_to_upsert[j : j + max_upsert_batch_size]
                    upsert_response = pinecone_index.upsert(vectors=upsert_batch)
                    batch_upserted = getattr(upsert_response, 'upserted_count', len(upsert_batch))
                    total_upserted += batch_upserted

            except Exception as e:
                print(f"Error during Pinecone upsert for batch: {e}")
                # If upsert fails, all posts intended for this batch are considered errored
                errors_in_batch += len(processed_ids_in_batch) # Increment error count
                return True, [] # Indicate error and no newly processed IDs
        else:
             # Dry run: Simulate upsert
             print(f"Dry run: Skipping Pinecone upsert for {len(vectors_to_upsert)} vectors from {len(processed_ids_in_batch)} posts.")
             # Do not increment errors_in_batch here for dry run simulation

    # Return error status and the list of IDs processed in this batch
    return errors_in_batch > 0, processed_ids_in_batch


# --- Setup Functions ---
def setup_connections_and_index(args: argparse.Namespace, dry_run: bool) -> tuple[pymysql.Connection, Pinecone.Index]:
    """Establishes database and Pinecone connections and ensures the index exists."""
    print("Establishing connections...")
    db_config = get_db_config(args)
    db_connection = get_db_connection(db_config)
    pinecone_client = get_pinecone_client()
    index_name = os.getenv("PINECONE_INGEST_INDEX_NAME")
    if not index_name:
        print("Error: PINECONE_INGEST_INDEX_NAME not set in environment.")
        sys.exit(1)
    print(f"Ensuring Pinecone index '{index_name}' exists...")
    create_pinecone_index_if_not_exists(pinecone_client, index_name, dry_run=dry_run)
    pinecone_index = pinecone_client.Index(index_name)
    print("Connections and index ready.")
    return db_connection, pinecone_index


def handle_checkpoint_or_clear_data(args: argparse.Namespace, pinecone_index, checkpoint_file: str, dry_run: bool) -> set[int]:
    """Loads checkpoint or clears existing library data based on args."""
    processed_doc_ids = set()
    if args.keep_data:
        checkpoint = load_checkpoint(checkpoint_file)
        if checkpoint:
            loaded_ids = checkpoint.get('processed_doc_ids', [])
            processed_doc_ids = set(loaded_ids)
            last_processed_id = checkpoint.get('last_processed_id', 0)
            print(f"Resuming ingestion. Found {len(processed_doc_ids)} documents previously processed (last highest ID: {last_processed_id}).")
        else:
            print("No valid checkpoint found. Starting ingestion from the beginning for this library.")
    else:
        print("Keep data set to False. Attempting to clear existing vectors for this library...")
        if not clear_library_vectors(pinecone_index, args.library_name, dry_run=dry_run):
            print("Exiting due to issues or user cancellation during vector deletion (or skipped in dry run).")
            sys.exit(1)
    return processed_doc_ids

def fetch_all_data(db_connection, site_config: dict, library_name: str, site: str) -> list[dict]:
    """Fetches author and main post data."""
    print("Fetching author data...")
    authors = fetch_authors(db_connection)
    print("Fetching and preparing main post data...")
    all_rows = fetch_data(db_connection, site_config, library_name, authors, site)
    if not all_rows:
        print("No data fetched from the database matching criteria.")
    return all_rows

# --- Processing Loop Function ---
def run_ingestion_loop(
    all_rows: list[dict],
    processed_doc_ids: set[int],
    args: argparse.Namespace,
    pinecone_index,
    embeddings_model,
    text_splitter,
    checkpoint_file: str,
    dry_run: bool
) -> tuple[int, int, int, int]:
    """Runs the main batch processing loop, handles checkpoints, and returns session stats."""
    print(f"Starting processing loop for {len(all_rows)} fetched documents...")
    processed_count_session = 0
    skipped_count_session = 0
    error_count_session = 0
    last_processed_id_session = max(processed_doc_ids) if processed_doc_ids else 0 # Start with highest ID from checkpoint

    num_batches = math.ceil(len(all_rows) / args.batch_size)
    print(f"Processing {len(all_rows)} documents in {num_batches} batches of size {args.batch_size}.")

    for i in tqdm(range(num_batches), desc="Overall Batch Progress"):
        if is_exiting:
            print("\nShutdown signal received, stopping batch processing loop...")
            break

        batch_start_index = i * args.batch_size
        batch_end_index = min(batch_start_index + args.batch_size, len(all_rows))
        current_batch_data_full = all_rows[batch_start_index:batch_end_index]

        current_batch_data_unprocessed = []
        batch_skipped_count = 0
        for post_data in current_batch_data_full:
            post_id = post_data.get('id')
            if post_id in processed_doc_ids:
                batch_skipped_count += 1
            else:
                current_batch_data_unprocessed.append(post_data)

        skipped_count_session += batch_skipped_count

        if not current_batch_data_unprocessed:
            continue

        batch_had_errors, processed_ids_this_batch = process_and_upsert_batch(
            current_batch_data_unprocessed,
            pinecone_index,
            embeddings_model,
            text_splitter,
            dry_run=dry_run
        )

        if not batch_had_errors:
            processed_doc_ids.update(processed_ids_this_batch)
            if processed_ids_this_batch:
                last_processed_id_session = max(last_processed_id_session, max(processed_ids_this_batch))
            processed_count_session += len(processed_ids_this_batch)
            save_checkpoint(checkpoint_file, list(processed_doc_ids), last_processed_id_session)
        else:
            print(f"Batch {i+1} encountered errors. Checkpoint not advanced for this batch's documents.")
            error_count_session += len(current_batch_data_unprocessed)

    return processed_count_session, skipped_count_session, error_count_session, last_processed_id_session

# --- Main Execution ---
def main():
    """Main function to orchestrate the data ingestion process."""
    args = parse_arguments()
    print(f"--- Starting DB Text Ingestion ---")
    print(f"Site: {args.site}")
    print(f"Database: {args.database}")
    print(f"Target Library Name: {args.library_name}")
    print(f"Keep Existing Data: {args.keep_data}")
    print(f"Batch Size: {args.batch_size}")
    dry_run = args.dry_run
    if dry_run:
        print("\n*** DRY RUN MODE ENABLED ***")
        print("No data will be sent to Pinecone (index creation, deletion, upserts skipped).")

    # Setup signal handler
    signal.signal(signal.SIGINT, signal_handler)
    global is_exiting
    is_exiting = False

    load_environment(args.site)
    site_config = get_config(args.site)

    db_connection = None
    pinecone_index = None
    processed_doc_ids = set()
    processed_count_session = 0
    last_processed_id_session = 0

    try:
        db_connection, pinecone_index = setup_connections_and_index(args, dry_run)
        checkpoint_file = get_checkpoint_file_path(args.site)
        processed_doc_ids = handle_checkpoint_or_clear_data(args, pinecone_index, checkpoint_file, dry_run)

        all_rows = fetch_all_data(db_connection, site_config, args.library_name, args.site)

        if all_rows:
            # Prepare embedding model and text splitter
            model_name = os.getenv("OPENAI_INGEST_EMBEDDINGS_MODEL")
            if not model_name:
                raise ValueError("OPENAI_INGEST_EMBEDDINGS_MODEL environment variable not set")
            embeddings_model = OpenAIEmbeddings(model=model_name, chunk_size=500)
            text_splitter = TokenTextSplitter.from_tiktoken_encoder(
                encoding_name='cl100k_base',
                chunk_size=256,
                chunk_overlap=50
            )

            processed_count_session, skipped_count_session, error_count_session, last_processed_id_session = run_ingestion_loop(
                all_rows,
                processed_doc_ids,
                args,
                pinecone_index,
                embeddings_model,
                text_splitter,
                checkpoint_file,
                dry_run
            )

            # Final summary
            print("\n--- Ingestion Session Summary ---")
            print(f"Total documents processed successfully in this session: {processed_count_session}")
            print(f"Total documents skipped (already processed in previous runs): {skipped_count_session}")
            print(f"Total documents skipped or failed due to errors in this session: {error_count_session}")
            print(f"Total unique documents processed overall (including previous runs): {len(processed_doc_ids)}")
            if last_processed_id_session > 0:
                 print(f"Highest document ID processed overall: {last_processed_id_session}") # Updated phrasing
        else:
             print("Exiting as no data was fetched.")


    except KeyboardInterrupt:
        print("\nKeyboardInterrupt received. Attempting final checkpoint save...")
        if 'checkpoint_file' in locals() and processed_doc_ids and processed_count_session > 0:
           save_checkpoint(checkpoint_file, list(processed_doc_ids), last_processed_id_session)
        print("Exiting due to KeyboardInterrupt.")
        sys.exit(1)
    except Exception as e:
        print(f"\n--- An unexpected error occurred during the main process ---")
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        if 'checkpoint_file' in locals() and 'processed_doc_ids' in locals() and 'last_processed_id_session' in locals() and processed_count_session > 0:
            try:
                print("Attempting to save checkpoint on error...")
                save_checkpoint(checkpoint_file, list(processed_doc_ids), last_processed_id_session)
            except Exception as cp_err:
                print(f"Could not save checkpoint during error handling: {cp_err}")
        sys.exit(1)
    finally:
        print("Closing database connection...")
        close_db_connection(db_connection)
        print("Ingestion process finished.")

if __name__ == "__main__":
    main() 