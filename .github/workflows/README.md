# GitHub Actions Workflows

This directory contains GitHub Actions workflows for automated testing and CI/CD.

## Available Workflows

### 1. Basic Test Suite (`tests.yml`)

This workflow runs all tests in the project when code is pushed to `main` or `develop` branches,
or when a pull request is created targeting these branches.

- **Trigger**: Push to `main` or `develop`, PR to `main` or `develop`
- **Actions**:
  - Runs all tests with `npm test`
  - Uploads test coverage as an artifact

### 2. Comprehensive Test Suite (`comprehensive-tests.yml`)

This workflow runs component tests and API tests separately, and then runs all tests together.

- **Trigger**: Push to `main` or `develop`, PR to `main` or `develop`
- **Jobs**:
  - **Component Tests**: Runs only component tests
  - **API Tests**: Runs only API tests (excluding utility files)
  - **All Tests**: Runs all tests (depends on the previous two jobs)

## Setting Up Required Secrets

For these workflows to run correctly, you need to set up the following secrets in your GitHub repository:

1. Go to your repository on GitHub
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Add the following secrets:
   - `GOOGLE_APPLICATION_CREDENTIALS`: Firebase service account credentials (JSON)
   - Any other environment variables needed for tests

## Customizing the Workflows

You can customize these workflows by:

1. Changing the trigger branches in the `on` section
2. Adding more environment variables in the `env` section
3. Adding more jobs or steps as needed

## Viewing Test Results

After a workflow runs:

1. Go to the "Actions" tab in your GitHub repository
2. Click on the workflow run
3. Download the coverage artifacts to view detailed test coverage reports
