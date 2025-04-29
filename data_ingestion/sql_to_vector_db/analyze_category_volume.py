#!/usr/bin/env python
"""
Analyzes the volume of text content per category from a WordPress MySQL database.

Connects to the database, fetches published content based on site config,
cleans HTML, calculates character counts for cleaned content, aggregates counts
by category, and prints a report showing total characters and percentage per category.
"""

import os
import sys
import argparse
import pymysql
import re
from collections import defaultdict
from tqdm import tqdm
from bs4 import BeautifulSoup

# Add the python directory to the path so we can import util
# Assumes running from workspace root or data_ingestion/sql_to_vector_db
try:
    # Running from workspace root
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
    from pyutil.env_utils import load_env
except ImportError:
    # Running from data_ingestion/sql_to_vector_db
    try:
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))) # Go up three levels
        from pyutil.env_utils import load_env
    except ImportError:
        print("Error: Could not find the 'pyutil' module. Make sure the script is run from the workspace root or the 'data_ingestion/sql_to_vector_db' directory.")
        sys.exit(1)


# --- Argument Parsing ---
def parse_arguments():
    """Parses command-line arguments."""
    parser = argparse.ArgumentParser(description="Analyze content volume per category from MySQL DB.")
    parser.add_argument("--site", required=True, help="Site name (e.g., ananda) for config and env loading.")
    # Database name is now required
    parser.add_argument("--database", required=True, help="Name of the MySQL database to connect to.")
    return parser.parse_args()

# --- Environment Loading ---
def load_environment(site: str):
    """Loads environment variables from the site-specific .env file using the load_env utility."""
    try:
        load_env(site)
        print(f"Loaded environment for site: {site} using load_env utility.")
    except Exception as e:
        print(f"Error loading environment using load_env for site '{site}': {e}")
        sys.exit(1)

    # Only check for DB connection vars, not DB_NAME
    required_vars = ["DB_USER", "DB_PASSWORD", "DB_HOST"]

    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)

# --- Database Utilities (Simplified from ingest-db-text.py) ---
def get_db_config(args):
    """Constructs the database connection configuration dictionary."""
    # Directly use the required database argument
    db_name = args.database

    return {
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
        "host": os.getenv("DB_HOST"),
        "database": db_name,
        "charset": os.getenv("DB_CHARSET", "utf8mb4"),
        "collation": os.getenv("DB_COLLATION", "utf8mb4_unicode_ci"),
        "cursorclass": pymysql.cursors.DictCursor
    }

def get_db_connection(db_config):
    """Establishes and returns a database connection."""
    try:
        connection = pymysql.connect(**db_config)
        print("Successfully connected to the database.")
        return connection
    except pymysql.MySQLError as err:
        print(f"Error connecting to MySQL: {err}")
        sys.exit(1)

def close_db_connection(connection):
    """Closes the database connection if it's open."""
    if connection and connection.open:
        connection.close()
        print("Database connection closed.")

# --- Text Cleaning Utilities (Copied from ingest-db-text.py) ---
def remove_html_tags(text):
    """Removes HTML tags, script, style elements, and excessive whitespace from text."""
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    for script_or_style in soup(["script", "style"]):
        script_or_style.decompose()
    text = soup.get_text()
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def replace_smart_quotes(text):
    """Replaces common 'smart' quotes and other special characters with standard ASCII equivalents."""
    if not text:
        return ""
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
    # Keep basic ASCII and common whitespace
    text = ''.join(c for c in text if ord(c) < 128 or c in [' ', '\n', '\t'])
    return text

# --- Site Configuration (Simplified from ingest-db-text.py) ---
def get_config(site):
    """Loads site-specific configuration details."""
    # Add other site configs as needed
    config = {
        "ananda": {
            "post_types": ["content"], # WordPress post types to analyze
            "category_taxonomy": "library-category" # WP taxonomy for categories
        },
        # Example for another site:
        # "jairam": {
        #     "post_types": ["post", "page"],
        #     "category_taxonomy": "category"
        # }
    }
    if site not in config:
        print(f"Error: Site configuration for '{site}' not found.")
        sys.exit(1)
    print(f"Using configuration for site: {site}")
    return config[site]

# --- Data Fetching & Analysis ---
def analyze_category_content(db_connection, site_config: dict):
    """Fetches posts, cleans content, calculates volume per category."""
    post_types = site_config['post_types']
    category_taxonomy = site_config['category_taxonomy']
    placeholders = ', '.join(['%s'] * len(post_types))

    # Query to get post ID, content, and associated categories
    query = f"""
        SELECT
            p.ID,
            p.post_content,
            p.post_title, -- Include title for context if needed
            GROUP_CONCAT(DISTINCT terms.name SEPARATOR '|||') AS categories
        FROM
            wp_posts AS p
            LEFT JOIN wp_term_relationships AS tr ON p.ID = tr.object_id
            LEFT JOIN wp_term_taxonomy AS tt ON tr.term_taxonomy_id = tt.term_taxonomy_id AND tt.taxonomy = %s
            LEFT JOIN wp_terms AS terms ON tt.term_id = terms.term_id
        WHERE
            p.post_status = 'publish'
            AND p.post_type IN ({placeholders})
        GROUP BY
            p.ID, p.post_content, p.post_title -- Group by post to get one row per post
        ORDER BY
            p.ID;
    """

    # Use tuples of sorted category names as keys for combinations
    category_combination_counts = defaultdict(int)
    total_char_count = 0
    processed_posts = 0
    posts_with_no_category = 0
    posts_with_empty_content = 0

    try:
        with db_connection.cursor() as cursor:
            params = [category_taxonomy] + post_types
            print("Executing query to fetch posts and categories...")
            cursor.execute(query, params)
            results = cursor.fetchall()
            print(f"Fetched {len(results)} posts matching criteria.")

            print("Analyzing content volume per category...")
            for row in tqdm(results, desc="Analyzing Posts"):
                post_id = row['ID']

                # 1. Clean content
                cleaned_content = remove_html_tags(row['post_content'])
                cleaned_content = replace_smart_quotes(cleaned_content)
                char_count = len(cleaned_content)

                if char_count == 0:
                    posts_with_empty_content += 1
                    continue # Skip posts with no text content after cleaning

                # 2. Add to total count
                total_char_count += char_count
                processed_posts += 1 # Count posts with actual content

                # 3. Assign count to categories
                category_list = []
                if row.get('categories'):
                    category_list = [cat.strip() for cat in row['categories'].split('|||') if cat.strip()]

                if not category_list:
                    posts_with_no_category += 1
                    # Use a specific key for uncategorized items
                    category_combination_counts[("[Uncategorized]",)] += char_count
                    continue

                # Create a sorted tuple of category names to use as the key
                # This ensures ('A', 'B') and ('B', 'A') are treated as the same combination
                category_key = tuple(sorted(category_list))

                # Add the character count to the specific category combination
                category_combination_counts[category_key] += char_count

        print("Analysis complete.")
        print(f"Processed {processed_posts} posts with content.")
        print(f"Skipped {posts_with_empty_content} posts due to empty content after cleaning.")
        print(f"Found {posts_with_no_category} posts with content but no assigned category.")

        return category_combination_counts, total_char_count

    except pymysql.MySQLError as e:
        print(f"Database error during analysis: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error during analysis: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

# --- Reporting ---
def print_report(category_counts: dict, total_count: int):
    """Formats and prints the category content volume report."""
    if total_count == 0:
        print("\nNo content found to report on.")
        return

    # Adjust column widths for potentially longer combined category names
    category_col_width = 45
    count_col_width = 20
    percent_col_width = 20
    total_width = category_col_width + count_col_width + percent_col_width + 2 # Account for spaces

    print("\n--- Category Content Volume Report ---")
    print(f"{'Category Combination':<{category_col_width}} {'Character Count':>{count_col_width}} {'Percent of Total':>{percent_col_width}}")
    print("-" * total_width)

    # Sort categories by character count descending
    sorted_categories = sorted(category_counts.items(), key=lambda item: item[1], reverse=True)

    for category_key, count in sorted_categories:
        # Format the category key for display
        if isinstance(category_key, tuple):
            # Join tuple elements with ' & ' for display
            display_name = ' & '.join(category_key)
        else:
            # Should not happen with the new logic, but handle just in case
            display_name = str(category_key)

        percentage = (count / total_count) * 100 if total_count > 0 else 0
        # Format count with commas for readability
        formatted_count = f"{count:,}"
        print(f"{display_name:<{category_col_width}} {formatted_count:>{count_col_width}} {f'{percentage:.2f}%':>{percent_col_width}}")

    print("-" * total_width)
    formatted_total = f"{total_count:,}"
    print(f"{'TOTAL':<{category_col_width}} {formatted_total:>{count_col_width}} {'100.00%':>{percent_col_width}}")
    print("-" * total_width)

# --- Main Execution ---
def main():
    """Main function to orchestrate the analysis process."""
    args = parse_arguments()
    print(f"--- Starting Category Content Volume Analysis ---")
    print(f"Site: {args.site}")
    # No longer optional, always print the required database name
    # if args.database:
    #     print(f"Using Database: {args.database}")
    print(f"Using Database: {args.database}")

    load_environment(args.site)
    site_config = get_config(args.site)
    db_config = get_db_config(args)

    db_connection = None
    try:
        db_connection = get_db_connection(db_config)
        category_counts, total_count = analyze_category_content(db_connection, site_config)
        print_report(category_counts, total_count)

    except Exception as e:
        # Catch any unexpected errors during the main flow
        print(f"--- An unexpected error occurred ---")
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        print("Closing database connection...")
        close_db_connection(db_connection)
        print("Analysis process finished.")

if __name__ == "__main__":
    main() 