#!/bin/bash

# cancel-other-deployments.sh
# 
# This script cancels the latest deployment for all Vercel projects
# except for the specifically named project you want to keep.
# 
# Requirements:
# - Vercel CLI (vercel) must be installed and logged in
# 
# Usage: ./cancel-other-deployments.sh project-to-skip
#
# Example: ./cancel-other-deployments.sh ananda-public-chatbot

if [ -z "$1" ]; then
  echo "Error: You must provide a project name to skip."
  echo "Usage: $0 project-to-skip"
  exit 1
fi

SKIP_PROJECT="$1"
echo "🛡️  Will protect project: $SKIP_PROJECT"

# Get list of actual project names using vercel projects ls
echo "📋 Fetching all projects..."
vercel projects ls > /tmp/vercel_projects_list.txt

# Extract just the project names from the output
PROJECTS=$(cat /tmp/vercel_projects_list.txt | grep -v "Vercel CLI" | grep -v "Latest Production URL" | grep -v "Updated" | grep -v "^$" | grep -v "Projects found" | grep -v "\-\-\-" | awk '{print $1}' | grep -v "^$" | sort | uniq)

# Count the projects
PROJECT_COUNT=$(echo "$PROJECTS" | wc -l | xargs)
echo "🔍 Found $PROJECT_COUNT projects:"
echo "$PROJECTS"
echo "-------------------------------------"

# Process each project
for PROJECT in $PROJECTS; do
  # Skip empty lines
  if [ -z "$PROJECT" ]; then
    continue
  fi
  
  # Skip the protected project
  if [ "$PROJECT" = "$SKIP_PROJECT" ]; then
    echo "🟢 Skipping project: $PROJECT (protected)"
    continue
  fi
  
  echo "🔍 Processing project: $PROJECT"
  
  # Get latest deployment for this project
  echo "  Getting latest deployment..."
  LATEST_DEPLOY=$(vercel ls -c "$PROJECT" | grep -v "Vercel CLI" | grep -E "https://" | head -1)
  
  if [ -z "$LATEST_DEPLOY" ]; then
    echo "  ⚠️ No deployments found for $PROJECT"
    continue
  fi
  
  # Extract URL and status from deployment info
  DEPLOY_URL=$(echo "$LATEST_DEPLOY" | awk '{print $2}')
  DEPLOY_STATUS=$(echo "$LATEST_DEPLOY" | awk '{print $3}')
  
  echo "  Latest deployment: $DEPLOY_URL ($DEPLOY_STATUS)"
  
  # Only cancel if it's in a cancelable state
  if [ -z "$DEPLOY_URL" ]; then
    echo "  ⚠️ Could not extract deployment URL"
    continue
  fi
  
  if [ "$DEPLOY_STATUS" = "CANCELED" ] || [ "$DEPLOY_STATUS" = "ERROR" ]; then
    echo "  ⏭️ Skipping already $DEPLOY_STATUS deployment"
    continue
  fi
  
  # Cancel the deployment
  echo "  🗑️ Canceling deployment: $DEPLOY_URL"
  CANCEL_RESULT=$(vercel remove --yes "$DEPLOY_URL" 2>&1)
  
  # Check if cancellation was successful
  if echo "$CANCEL_RESULT" | grep -q "Deployment cancelled"; then
    echo "  ✅ Successfully canceled"
  else
    echo "  ❌ Failed to cancel: $CANCEL_RESULT"
  fi
  
  echo "-------------------------------------"
done

# Clean up
rm -f /tmp/vercel_projects_list.txt
echo "✨ Operation complete. Latest deployments canceled for all projects except $SKIP_PROJECT."
