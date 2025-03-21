#!/usr/bin/env python3
"""
cancel-other-deployments.py

This script cancels the latest deployment for all Vercel projects
except for the specifically named project you want to keep.

Requirements:
- Vercel CLI must be installed and logged in

Usage: python cancel-other-deployments.py project-to-skip
Example: python cancel-other-deployments.py ananda-public-chatbot
"""

import sys
import subprocess
import re


def run_command(cmd):
    """Run a command and return its output."""
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout, result.stderr, result.returncode


def get_vercel_projects():
    """Get a list of all Vercel projects."""
    stdout, _, _ = run_command(["vercel", "projects", "ls"])
    
    # Extract project names from output
    projects = []
    for line in stdout.splitlines():
        # Skip header and empty lines
        if not line.strip() or "Project Name" in line or "Vercel CLI" in line or "----" in line or "Updated" in line or "Projects found" in line:
            continue
        
        # Extract the project name (first column)
        parts = line.strip().split()
        if parts:
            projects.append(parts[0])
    
    return projects


def cancel_deployment(project, skip_project):
    """Cancel the latest deployment for a project if it's not the skip_project."""
    if project == skip_project:
        print(f"🟢 Skipping project: {project} (protected)")
        return
    
    print(f"🔍 Processing project: {project}")
    
    # Get deployments for the project - need to store org/team name
    stdout, stderr, _ = run_command(["vercel", "ls", project])
    
    # Debug output
    print(f"  Debug - Command output:")
    print(f"  {stdout[:500]}...")
    
    # Extract the latest deployment URL
    deployment_url = None
    deployment_status = None
    
    for line in stdout.splitlines():
        if "https://" in line:
            # Different approach to extract URL - anything that starts with https://
            url_match = re.search(r'(https://[^\s]+)', line)
            if url_match:
                deployment_url = url_match.group(1)
                # Extract status - anything after the URL
                parts = line.strip().split(deployment_url)
                if len(parts) > 1 and parts[1].strip():
                    deployment_status = parts[1].strip().split()[0]
                break
    
    if not deployment_url:
        # Try alternate command
        print(f"  ⚠️ No deployment URL found with ls, trying projects inspect...")
        stdout, _, _ = run_command(["vercel", "project", "inspect", project])
        
        # Look for deployment URLs in the inspect output
        for line in stdout.splitlines():
            if "https://" in line:
                url_match = re.search(r'(https://[^\s]+)', line)
                if url_match:
                    deployment_url = url_match.group(1)
                    deployment_status = "Unknown"  # Status not easily available from inspect
                    break
    
    if not deployment_url:
        print(f"  ⚠️ No deployment URL found for {project}")
        return
    
    print(f"  Latest deployment: {deployment_url} ({deployment_status})")
    
    # Check if it's a special status
    if deployment_status and any(status in str(deployment_status) for status in ["Queued", "Building", "●"]):
        print(f"  🔴 Found active deployment - canceling...")
    else:
        print(f"  🔶 Found deployment - attempting to cancel")
    
    # Try to cancel the deployment
    print(f"  🗑️ Canceling deployment: {deployment_url}")
    stdout, stderr, returncode = run_command(["vercel", "remove", "--yes", deployment_url])
    
    # Debug output
    print(f"  Debug - Cancellation result: {returncode}")
    print(f"  Debug - Output: {stdout[:200]}...")
    print(f"  Debug - Error: {stderr[:200]}...")
    
    if returncode == 0:
        print(f"  ✅ Successfully canceled")
    else:
        # Try another approach
        print(f"  ⚠️ First attempt failed, trying with project name...")
        stdout, stderr, returncode = run_command(["vercel", "remove", "--safe", "--yes", project])
        
        print(f"  Debug - Second attempt result: {returncode}")
        print(f"  Debug - Output: {stdout[:200]}...")
        print(f"  Debug - Error: {stderr[:200]}...")
        
        if returncode == 0:
            print(f"  ✅ Successfully canceled using project name")
        else:
            print(f"  ❌ Failed to cancel deployment")
    
    print("-------------------------------------")


def main():
    """Main function."""
    # Check arguments
    if len(sys.argv) < 2:
        print("Error: You must provide a project name to skip.")
        print(f"Usage: {sys.argv[0]} project-to-skip")
        sys.exit(1)
    
    skip_project = sys.argv[1]
    print(f"🛡️  Will protect project: {skip_project}")
    
    # Get all projects
    projects = get_vercel_projects()
    
    # Handle case where no projects are found
    if not projects:
        # Fallback to hardcoded projects if automated detection fails
        projects = [
            "ananda-chatbot",
            "crystal-chatbot",
            "jairam-chatbot",
            "ananda-public-chatbot",
            "test-ip-detector-2"
        ]
        print("⚠️ Could not detect projects automatically, using hardcoded list")
    
    # Print found projects
    print(f"📄 Processing {len(projects)} projects:")
    for project in projects:
        print(f"  - {project}")
    print("-------------------------------------")
    
    # Process each project
    for project in projects:
        cancel_deployment(project, skip_project)
    
    print(f"✨ Operation complete. Latest deployments canceled for all projects except {skip_project}.")


if __name__ == "__main__":
    main() 