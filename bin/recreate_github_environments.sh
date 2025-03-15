#!/bin/bash
# =============================================================================
# GitHub Environment Recreation Script
# =============================================================================
#
# This script recreates all GitHub environments for the specified repository.
# It's useful when you need to reset environment settings or create multiple
# environments in bulk.
#
# Usage:
#   ./recreate_github_environments.sh
#
# Requirements:
#   - GitHub CLI (gh) installed and authenticated with admin permissions
#   - Proper access rights to the repository
#
# What it does:
#   - For each environment in the list, it:
#     1. Sends a PUT request to the GitHub API
#     2. Creates the environment if it doesn't exist
#     3. Updates the environment if it already exists
#     4. Sets a wait timer of 0 (no deployment wait time)
#
# Note: This script requires admin access to the repository.
#       If you encounter permission errors, ensure your GitHub CLI
#       is authenticated with sufficient permissions.
#
# =============================================================================

REPO="anandaworldwide/ananda-library-chatbot"
ENVIRONMENTS=(
  "Preview-ananda-public-chatbot"
  "Production-ananda-public-chatbot"
  "Production-ananda-chatbot"
  "Preview-ananda-chatbot"
  "Preview-crystal-chatbot"
  "Production-crystal-chatbot"
  "Preview-jairam-chatbot"
  "Production-ananda-library-chatbot"
  "Production-jairam-chatbot"
  "Production-ananda-library-chatbot-jairam"
  "Preview"
  "Production"
)

for env in "${ENVIRONMENTS[@]}"; do
  echo "Recreating environment: $env"
  gh api -X PUT /repos/"$REPO"/environments/"$env" --input - <<< '{"wait_timer": 0}'
  if [ $? -eq 0 ]; then
    echo "✅ Successfully recreated $env"
  else
    echo "❌ Failed to recreate $env"
  fi
done