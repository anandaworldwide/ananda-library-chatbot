#!/usr/bin/env python3

import sys
import os
from datetime import datetime
import subprocess
import tempfile
import re
import argparse

def print_usage():
    print("Usage: process_anandalib_dump.py [-u username] <sql_dump_file>")
    sys.exit(1)

def get_new_db_name():
    # Generate database name with format anandalib-YYYY-DD-MM
    today = datetime.now()
    return f"anandalib_{today.year}_{today.month:02d}_{today.day:02d}"

def process_sql_file(input_file, new_db_name):
    # Create temp file for processed SQL
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.sql') as temp_file:
        temp_filename = temp_file.name
        
        # Add header configurations
        header = """-- turn off strict dates and switch to UTF8
SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
ALTER DATABASE {} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

use {};

""".format(new_db_name, new_db_name)
        temp_file.write(header)
        
        # Process the input file
        with open(input_file, 'r', encoding='utf-8') as infile:
            for line in infile:
                # Replace old database name with new one
                line = re.sub(r'USE `anandalib[^`]*`', f'USE `{new_db_name}`', line)
                line = re.sub(r'CREATE DATABASE .*anandalib[^`]*`', f'CREATE DATABASE `{new_db_name}`', line)
                temp_file.write(line)
        
        # Add footer modifications
        footer = """
ALTER TABLE wp_posts 
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  
ALTER TABLE wp_posts 
  MODIFY post_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Get rid of columns we don't need that have problematic data
ALTER TABLE wp_posts 
DROP COLUMN post_date_gmt,
DROP COLUMN post_modified,
DROP COLUMN post_modified_gmt;

-- Add the new columns
ALTER TABLE wp_posts 
  ADD COLUMN permalink VARCHAR(400),
  ADD COLUMN author_name VARCHAR(255);
"""
        temp_file.write(footer)
    
    return temp_filename

def import_database(sql_file, db_name, username):
    # Create database
    create_db_cmd = f"mysql -u {username} -p -e 'CREATE DATABASE IF NOT EXISTS `{db_name}`'"
    try:
        subprocess.run(create_db_cmd, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error creating database: {e}")
        sys.exit(1)

    # Import processed SQL file
    import_cmd = f"mysql -u {username} -p {db_name} < {sql_file}"
    try:
        subprocess.run(import_cmd, shell=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error importing database: {e}")
        sys.exit(1)

def main():
    # Set up argument parser
    parser = argparse.ArgumentParser(description='Process and import Ananda library SQL dump')
    parser.add_argument('-u', '--user', default='root', help='MySQL username (default: root)')
    parser.add_argument('sql_file', help='SQL dump file to process')
    
    # Parse arguments
    args = parser.parse_args()
    
    input_file = args.sql_file
    username = args.user
    
    # Verify input file exists
    if not os.path.exists(input_file):
        print(f"Error: File '{input_file}' not found")
        sys.exit(1)
    
    # Generate new database name
    new_db_name = get_new_db_name()
    
    print(f"Processing SQL dump file: {input_file}")
    print(f"Creating new database: {new_db_name}")
    print(f"Using MySQL username: {username}")
    
    try:
        # Process the SQL file
        processed_file = process_sql_file(input_file, new_db_name)
        
        # Import the processed file
        print("Importing processed SQL file...")
        import_database(processed_file, new_db_name, username)
        
        # Clean up temporary file
        os.unlink(processed_file)
        
        print(f"Successfully imported database as: {new_db_name}")
        
    except Exception as e:
        print(f"Error processing database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()