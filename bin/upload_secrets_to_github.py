#!/usr/bin/env python3
"""
GitHub Environment Secrets Uploader

This script uploads environment variables from site-specific .env files to GitHub environments.
It automatically creates secrets in both Preview and Production environments for a specified site.

Usage:
    ./upload_secrets_to_github.py --site SHORTNAME [--repo-level] [--dry-run]

Example:
    ./upload_secrets_to_github.py --site ananda
    ./upload_secrets_to_github.py --site ananda --repo-level
    ./upload_secrets_to_github.py --site ananda --dry-run

Parameters:
    --site: Short name used for finding the environment file (.env.SHORTNAME)
    --repo-level: Optional flag to use repository-level secrets instead of environment secrets
    --dry-run: Show what would be done without actually uploading secrets

Requirements:
    - GitHub CLI (gh) installed and authenticated
    - Python 3.6+
    - .env.SHORTNAME file in the current directory

Notes:
    - The script will upload all variables from .env.SHORTNAME to both:
      * Preview-[site-name]-chatbot
      * Production-[site-name]-chatbot
    - Environments will be created if they don't exist
    - Multiline values (like JSON) are properly handled
    - Comments and empty lines are ignored

Author: Michael Olivier
"""

import argparse
import json
import os
import re
import subprocess
import sys


def check_gh_cli():
    """Check if GitHub CLI is installed and authenticated."""
    try:
        # Check if gh is installed
        subprocess.run(['gh', '--version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        
        # Check if user is authenticated
        result = subprocess.run(['gh', 'auth', 'status'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode != 0:
            print("You are not authenticated with GitHub. Please run 'gh auth login' first.")
            sys.exit(1)
    except FileNotFoundError:
        print("GitHub CLI is not installed. Please install it first:")
        print("  macOS: brew install gh")
        print("  Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md")
        sys.exit(1)

def parse_env_file(file_path):
    """Parse .env file handling multiline values and comments."""
    env_vars = {}
    
    if not os.path.exists(file_path):
        print(f"Environment file {file_path} not found!")
        sys.exit(1)
    
    with open(file_path) as f:
        # Initialize variables for multiline parsing
        in_multiline = False
        current_key = ""
        current_value = ""
        
        for line in f:
            line = line.rstrip('\n')
            
            # Skip comments and empty lines
            if line.startswith('#') or not line.strip():
                continue
            
            # Check if this is a new key=value pair
            if not in_multiline and re.match(r'^[A-Za-z0-9_]+=', line):
                # Split at the first equals sign
                key_value = line.split('=', 1)
                key = key_value[0]
                value = key_value[1] if len(key_value) > 1 else ""
                
                # Check if value starts with a quote but doesn't end with one (multiline)
                if value.startswith('"') and not value.endswith('"') or \
                   value.startswith("'") and not value.endswith("'"):
                    in_multiline = True
                    current_key = key
                    current_value = value
                else:
                    # Single line value, store directly
                    # Remove quotes if present
                    if (value.startswith('"') and value.endswith('"')) or \
                       (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                    env_vars[key] = value
            
            elif in_multiline:
                # Append to multiline value
                current_value += "\n" + line
                
                # Check if multiline value is complete
                if (current_value.startswith('"') and line.endswith('"')) or \
                   (current_value.startswith("'") and line.endswith("'")):
                    in_multiline = False
                    # Remove quotes
                    value = current_value
                    if (value.startswith('"') and value.endswith('"')) or \
                       (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                    env_vars[current_key] = value
    
    return env_vars

def ensure_environment_exists(environment_name, repo, dry_run=False):
    """Check if a GitHub environment exists and create it if it doesn't."""
    print(f"Checking if environment {environment_name} exists...")
    
    if dry_run:
        print(f"[DRY RUN] Would check if environment {environment_name} exists in repo {repo}")
        return
    
    try:
        subprocess.run(
            ['gh', 'api', f'/repos/{repo}/environments/{environment_name}'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True
        )
        print(f"✅ Environment {environment_name} already exists")
    except subprocess.CalledProcessError as e:
        if e.returncode == 404:
            print(f"Environment {environment_name} doesn't exist. Creating it...")
            try:
                subprocess.run(
                    ['gh', 'api', '-X', 'PUT', f'/repos/{repo}/environments/{environment_name}',
                     '--input', '-', '-'],
                    input=json.dumps({"wait_timer": 0}).encode(),
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                print(f"✅ Created environment {environment_name}")
            except subprocess.CalledProcessError as e:
                print(f"Error creating environment: {e.stderr.decode()}")
                sys.exit(1)
        else:
            print(f"Error checking environment: {e.stderr.decode()}")
            sys.exit(1)

def upload_to_environment(env_name, site_name, env_vars, repo, dry_run=False):
    """Upload secrets to a specific GitHub environment."""
    # Use a consistent naming convention based on your setup
    environment = f"{env_name}-{site_name}-chatbot"
    print(f"📤 Uploading to {environment} environment...")
    
    ensure_environment_exists(environment, repo, dry_run)
    
    for key, value in env_vars.items():
        if key and value:
            if dry_run:
                print(f"  [DRY RUN] Would set {key} for {environment}")
            else:
                print(f"  Setting {key} for {environment}")
                try:
                    subprocess.run(
                        ['gh', 'secret', 'set', key, '--env', environment, '--body', value, '--repo', repo],
                        check=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE
                    )
                except subprocess.CalledProcessError as e:
                    print(f"Error setting {key}: {e.stderr.decode() if e.stderr else str(e)}")
    
    print(f"✅ Completed uploading secrets to {environment}")

def upload_to_repo_level(env_vars, dry_run=False):
    """Upload secrets at the repository level."""
    repo = 'anandaworldwide/ananda-library-chatbot'  # Hardcoded repository
    print("📤 Uploading to repository-level secrets...")
    
    for key, value in env_vars.items():
        if key and value:
            if dry_run:
                print(f"  [DRY RUN] Would set {key} at repository level")
            else:
                print(f"  Setting {key} at repository level")
                try:
                    # Use GitHub CLI to set the secret at repo level
                    subprocess.run(
                        ['gh', 'secret', 'set', key, '--body', value, '--repo', repo],
                        check=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE
                    )
                except subprocess.CalledProcessError as e:
                    print(f"Error setting {key}: {e.stderr.decode() if e.stderr else str(e)}")
    
    print("✅ Completed uploading repository-level secrets")

def main():
    parser = argparse.ArgumentParser(description='Upload environment variables to GitHub environments.')
    parser.add_argument('--site', required=True, help='Short site name for environment file (e.g., ananda)')
    parser.add_argument('--repo-level', action='store_true', help='Use repository-level secrets instead of environment secrets')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done without actually uploading secrets')
    
    args = parser.parse_args()
    site = args.site
    repo = 'anandaworldwide/ananda-library-chatbot'  # Always use this repository
    use_repo_level = args.repo_level
    dry_run = args.dry_run
    
    if dry_run:
        print("🔍 DRY RUN MODE - No secrets will be uploaded")
    
    # Check GitHub CLI
    check_gh_cli()
    
    # Define env file path
    env_file = f".env.{site}"
    
    print(f"🔑 Uploading secrets for {site} from {env_file} to GitHub repository {repo}")
    
    # Parse env file
    env_vars = parse_env_file(env_file)
    
    if use_repo_level:
        upload_to_repo_level(env_vars, dry_run)
    else:
        upload_to_environment("Preview", site, env_vars, repo, dry_run)
        upload_to_environment("Production", site, env_vars, repo, dry_run)
    
    if dry_run:
        print(f"🎉 [DRY RUN] All secrets would have been uploaded for {site}!")
    else:
        print(f"🎉 All secrets have been uploaded for {site}!")

if __name__ == "__main__":
    main()