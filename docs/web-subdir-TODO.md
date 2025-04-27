# Web Subdirectory Migration Plan

## Overview

This document outlines the step-by-step process for migrating the Next.js web application into a `/web`
subdirectory while maintaining functionality.

## Current Architecture Dependencies

- Next.js 14.2.24
- Firebase integration
- Vercel deployment
- GitHub Actions CI/CD
- Multiple environment configurations
- Shared utilities between web and other services

## Build & Deployment Constraints

### Vercel Configuration

- Custom build command in vercel.json: `npm run build-with-api-tests`
- Cron job configuration for `/api/relatedQuestions`
- Environment-specific builds using different .env files

### Firebase Integration Items

- Firebase emulator support for local development
- Build-time optimization for Firebase initialization
- Environment-specific Firebase configurations

### Testing Infrastructure

- Jest configuration spanning multiple projects
- Component, API, and utility tests
- GitHub Actions workflow for comprehensive testing
- Coverage reporting requirements

## Testing Strategy

### Local Development Testing

1. Initial Setup:

   - 🐥 Create a new git branch: `web-migration`
   - 🐥 Create initial `/web` directory structure
   - 🐥 Configure environment loading from parent directory
   - 🐥 Move files to `/web/src` directory
   - 🐥 Update import paths in moved files
   - 🐥 Configure new Next.js app

1. Testing Process:
   - 🐥 Run test suite after each major change
   - 🐥 Verify functionality in development environment
   - 🐥 Create comprehensive test coverage for new structure

### Vercel Preview Testing

1. Setup:

   - 🐥 Configure project in Vercel dashboard for new structure
   - 🐥 Add new deployment pipeline for `/web` directory
   - 🐥 Set up preview environments

1. Deployment Process:
   - 🐥 Push changes to `web-migration` branch
   - 🐥 Verify Vercel preview deployment
   - 🐥 Run full test suite in CI environment

### Testing Checkpoints

After each checkpoint:

1. Run test suite: `npm run test`
1. Create Vercel preview deployment
1. Verify all features in preview

## Migration Phases

### Phase 1: Preparation

1. Create initial `/web` directory structure:

```plaintext
/web
├── package.json
├── tsconfig.json
├── next.config.js
└── src/
    ├── components/
    ├── pages/
    ├── utils/
    ├── types/
    ├── services/
    └── styles/
```

1. Setup package.json:

   - 🐥 Copy Next.js related dependencies
   - 🐥 Update scripts for new path structure
   - 🐥 Maintain test configurations

1. Create new tsconfig.json with updated paths:

   - 🐥 Update path aliases for new structure
   - 🐥 Configure for src directory
   - 🐥 Maintain existing compiler options

1. Configure environment and shared utilities:

   - 🐥 Set up environment loading from parent directory
   - 🥚 Identify shared utilities between web and other services
   - 🥚 Plan strategy for shared code

1. Tasks:

   - 🐥 Create directory structure
   - 🐥 Setup initial configuration files
   - 🐥 Update path aliases
   - 🐥 Create minimal home page for testing
   - 🐥 Test basic Next.js setup in new location

1. Testing Checkpoint 1:
   - 🐥 Verify Next.js boots in new location
   - 🐥 Test basic page rendering
   - 🐥 Create first Vercel preview

### Phase 2: Static Assets & Styles

1. Move static files:

```plaintext
/web
├── public/
└── styles/
```

1. Tasks:

   - 🐥 Move public directory to web/public
   - 🐥 Move data files to web/public/data
   - 🐥 Copy site-config directory to web/site-config
   - 🐥 Move style files to src/styles
   - 🐥 Update style imports
   - 🐥 Test static asset serving
   - 🥚 Update paths in components

1. Testing Checkpoint 2:
   - 🐥 Verify static assets load in new location
   - 🐥 Test styling
   - 🐥 Verify image optimization
   - 🐥 Update and test Vercel preview

### Phase 3: Components & Hooks

1. Tasks:

   - 🐥 Move component files to src/components
   - 🐥 Move hook files to src/hooks
   - 🐥 Update import paths
   - 🐣 Test component rendering
   - 🐣 Update test configurations

1. Testing Checkpoint 3:
   - 🐣 Test component rendering
   - 🐣 Test component interactions
   - 🐣 Verify hook functionality
   - 🐣 Check component tests
   - 🐣 Update and test Vercel preview

### Phase 4: Pages & App Router

1. Move routing structure:

```plaintext
/web
├── src/
    ├── app/
    └── pages/
```

1. Tasks:

   - 🐥 Move app router files to src/app
   - 🐥 Move pages router files to src/pages
   - 🐥 Update API routes
   - 🐣 Test routing functionality

1. Testing Checkpoint 4:
   - 🐣 Test all routes in new structure
   - 🐣 Verify API endpoints
   - 🐣 Check middleware functionality
   - 🐣 Test authentication flows
   - 🐣 Compare API responses
   - 🐣 Update and test Vercel preview

### Phase 5: Shared Code

1. Create shared utilities structure:

```plaintext
/web
└── src/
    └── utils/
        ├── client/
        ├── server/
        └── shared/
```

1. Tasks:

   - 🐥 Identify truly shared utilities
   - 🐥 Create shared package structure
   - 🐥 Move web-specific utilities
   - 🐣 Update import paths
   - 🐣 Test utility functions

1. Testing Checkpoint 5:
   - 🐣 Verify utility functions
   - 🐣 Test shared code imports
   - 🐣 Check Firebase integration
   - 🐣 Verify environment variables
   - 🐣 Update and test Vercel preview

### Phase 6: Build & Deploy Configuration

1. Update build configuration:

   - 🥚 Modify next.config.js for new path
   - 🥚 Update Vercel configuration
   - 🥚 Adjust build scripts
   - 🥚 Test build process

1. Update deployment configuration:

   - 🥚 Update Vercel deployment settings
   - 🥚 Modify GitHub Actions workflows
   - 🥚 Test deployment process
   - 🥚 Update cron job configurations

1. Testing Checkpoint 6:
   - 🥚 Verify build process
   - 🥚 Test deployment pipeline
   - 🥚 Check all environment configurations
   - 🥚 Final Vercel preview test

### Phase 7: Cleanup

1. Prerequisites:

   - 🥚 All items in Validation Checklist are confirmed 🐥

2. Tasks:
   - 🥚 Remove old files from root directory
   - 🥚 Update root README.md to reflect new structure
   - 🥚 Clean up root package.json
   - 🥚 Remove temporary migration scripts and configurations

## Special Considerations

### Environment Variables

- Maintain support for multiple .env files
- Update paths in build scripts
- Handle Firebase credentials appropriately

### Firebase Integration

- Update Firebase initialization for new structure
- Maintain emulator support
- Handle build-time optimizations

### Test Configuration

- Maintain separate test configurations for components, API, and utilities
- Update test paths and imports
- Preserve coverage requirements
- 🐣 Fix skipped tests in tokenManager.test.ts related to login page error handling

### Vercel Deployment

- Update build command paths
- Maintain cron job functionality
- Handle environment-specific builds

## Validation Checklist

- 🥚 All tests passing
- 🥚 Build succeeding locally
- 🥚 Vercel deployment working
- 🥚 Firebase integration functional
- 🥚 API routes responding correctly
- 🥚 Static assets serving properly
- 🥚 Environment-specific builds working
- 🥚 Cron jobs operational
- 🥚 Test coverage maintained

## Next Steps

1. Begin with Phase 1 (Preparation)
1. Create new branch for migration
1. Complete each phase sequentially
1. Maintain comprehensive testing throughout
1. Document any deviations from plan
1. Update documentation as needed

## Post-Migration Cleanup

- 🥚 Clean up old code structure
  - 🥚 Remove duplicate API endpoints from root structure
  - 🥚 Clean up unused dependencies in root package.json
  - 🥚 Update documentation to reflect new structure
  - 🥚 Consider moving remaining root utilities to web directory
  - 🥚 Remove dev:root script
  - 🥚 Update build scripts to exclusively use web directory

## Authentication Improvements

- 🥚 Ensure consistent authentication handling between environments
- 🥚 Verify cookie path handling is correct in all login/logout flows
- 🥚 Add thorough tests for authentication token flow

## References

- Next.js documentation for monorepo support
- Vercel deployment configuration
- Firebase initialization documentation
- Jest configuration for monorepos
