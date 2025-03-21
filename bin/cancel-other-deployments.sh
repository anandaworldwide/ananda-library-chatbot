#!/bin/bash

# cancel-other-deployments.sh
# 
# This script cancels the latest deployment for all Vercel projects except the one specified.
# It helps to conserve resources and ensure that only essential deployments stay active.
# 
# Requirements:
# - Vercel CLI (vercel) must be installed and logged in
# 
# Usage: ./cancel-other-deployments.sh project-to-skip
#
# Example: ./cancel-other-deployments.sh my-production-app

if [ -z "$1" ]; then
  echo "Error: You must provide a project name to skip."
  echo "Usage: $0 project-to-skip"
  exit 1
fi

SKIP_PROJECT="$1"
echo "Will skip cancellation for project: $SKIP_PROJECT"

# Get all projects using the Vercel CLI
PROJECTS=$(vercel ls 2>&1 | grep -E '^\s+[a-zA-Z0-9-]+\s+' | awk '{print $1}')

# Count projects
PROJECT_COUNT=$(echo "$PROJECTS" | wc -l | xargs)
echo "Found $PROJECT_COUNT projects"
echo "-------------------------------------"

for PROJECT in $PROJECTS; do
  if [ "$PROJECT" = "$SKIP_PROJECT" ]; then
    echo "🟢 Skipping project: $PROJECT (protected)"
    continue
  fi
  
  echo "🔍 Checking project: $PROJECT"
  
  # Get deployments for this project
  DEPLOYMENTS_OUTPUT=$(vercel ls $PROJECT 2>&1)
  
  # Extract the deployment ID (usually in the format dpl_xxxxxxxxxxxx)
  DEPLOYMENT_ID=$(echo "$DEPLOYMENTS_OUTPUT" | grep -E "dpl_[a-zA-Z0-9]+" | head -1 | grep -oE "dpl_[a-zA-Z0-9]+")
  
  if [ ! -z "$DEPLOYMENT_ID" ]; then
    echo "🗑️  Canceling deployment $DEPLOYMENT_ID for $PROJECT"
    vercel remove --yes $DEPLOYMENT_ID
    echo "✅ Cancellation complete"
  else
    echo "⚠️  No deployment IDs found for $PROJECT"
    # Fall back to using the URL if we can't find the ID
    DEPLOYMENT_URL=$(echo "$DEPLOYMENTS_OUTPUT" | grep -E "https://" | head -1 | awk '{print $2}')
    if [ ! -z "$DEPLOYMENT_URL" ]; then
      echo "🗑️  Trying to cancel by URL: $DEPLOYMENT_URL"
      vercel remove --yes $DEPLOYMENT_URL
      echo "✅ Cancellation attempt complete"
    else
      echo "❌ Could not find any deployments to cancel"
    fi
  fi
  echo "-------------------------------------"
done

echo "Operation complete. All deployments canceled except for $SKIP_PROJECT."
