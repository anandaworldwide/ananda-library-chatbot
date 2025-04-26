# Web Subdirectory Migration Plan

## Overview

This document outlines the step-by-step process for migrating the Next.js web application into a `/web`
subdirectory while maintaining functionality and minimizing disruption to the development workflow.

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

   - [x] Create a new git branch: `web-migration`
   - [x] Create initial `/web` directory structure
   - [x] Configure environment loading from parent directory
   - [ ] Copy files to `/web/src` directory while keeping originals
   - [ ] Update import paths in copied files
   - [x] Configure new Next.js app to run on different port (3001)

1. Dual-Running Setup:

   ```bash
   # Terminal 1 - Original app
   npm run dev  # Runs on port 3000

   # Terminal 2 - New web directory
   cd web
   npm run dev  # Runs on port 3001
   ```

1. Phase Testing Process:
   - Test new structure in parallel with original
   - Compare functionality between ports 3000 and 3001
   - Only remove original files after new structure verified
   - Keep daily backups during migration

### Vercel Preview Testing

1. Setup:

   - Configure project in Vercel dashboard for new structure
   - Add new deployment pipeline for `/web` directory
   - Set up preview environments for both old and new structures

1. Deployment Process:
   - Push changes to `web-migration` branch
   - Vercel creates preview deployment
   - Compare preview with production site
   - Document any discrepancies

### Testing Checkpoints

After each checkpoint:

1. Run both local development servers
1. Compare functionality between ports
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

   - [x] Copy Next.js related dependencies
   - [x] Update scripts for new path structure
   - [x] Maintain test configurations

1. Create new tsconfig.json with updated paths:

   - [x] Update path aliases for new structure
   - [x] Configure for src directory
   - [x] Maintain existing compiler options

1. Configure environment and shared utilities:

   - [x] Set up environment loading from parent directory
   - [ ] Identify shared utilities between web and other services
   - [ ] Plan strategy for shared code (symlinks vs copying)

1. Tasks:

   - [x] Create directory structure
   - [x] Setup initial configuration files
   - [x] Update path aliases
   - [x] Create minimal home page for testing
   - [x] Test basic Next.js setup in new location

1. Testing Checkpoint 1:
   - [x] Configure dual-port setup
   - [x] Verify Next.js boots in new location
   - [x] Test basic page rendering
   - [?] Create first Vercel preview

### Phase 2: Static Assets & Styles

1. Move static files:

```plaintext
/web
├── public/
└── styles/
```

1. Tasks:

   - [ ] Move public directory
   - [ ] Move style files
   - [ ] Update style imports
   - [ ] Test static asset serving
   - [ ] Update paths in existing components

1. Testing Checkpoint 2:
   - [ ] Verify static assets load in new location
   - [ ] Compare styling between old and new
   - [ ] Test public file access
   - [ ] Verify image optimization
   - [ ] Update and test Vercel preview

### Phase 3: Components & Hooks

1. Move React-specific code:

```plaintext
/web
├── components/
└── hooks/
```

1. Tasks:

   - [ ] Move component files
   - [ ] Move hook files
   - [ ] Update import paths
   - [ ] Test component rendering
   - [ ] Update test configurations

1. Testing Checkpoint 3:
   - [ ] Compare component rendering
   - [ ] Test component interactions
   - [ ] Verify hook functionality
   - [ ] Check component tests
   - [ ] Update and test Vercel preview

### Phase 4: Pages & App Router

1. Move routing structure:

```plaintext
/web
├── app/
└── pages/
```

1. Tasks:

   - [ ] Move app router files
   - [ ] Move pages router files
   - [ ] Update API routes
   - [ ] Test routing functionality

1. Testing Checkpoint 4:
   - [ ] Test all routes in new structure
   - [ ] Verify API endpoints
   - [ ] Check middleware functionality
   - [ ] Test authentication flows
   - [ ] Compare API responses between old/new
   - [ ] Update and test Vercel preview

### Phase 5: Shared Code

1. Create shared utilities structure:

```plaintext
/web
└── utils/
    ├── client/
    ├── server/
    └── shared/
```

1. Tasks:

   - [ ] Identify truly shared utilities
   - [ ] Create shared package structure
   - [ ] Move web-specific utilities
   - [ ] Update import paths
   - [ ] Test utility functions

1. Testing Checkpoint 5:
   - [ ] Verify utility functions
   - [ ] Test shared code imports
   - [ ] Check Firebase integration
   - [ ] Verify environment variables
   - [ ] Update and test Vercel preview

### Phase 6: Build & Deploy Configuration

1. Update build configuration:

   - [ ] Modify next.config.js for new path
   - [ ] Update Vercel configuration
   - [ ] Adjust build scripts
   - [ ] Test build process

1. Update deployment configuration:

   - [ ] Update Vercel deployment settings
   - [ ] Modify GitHub Actions workflows
   - [ ] Test deployment process
   - [ ] Update cron job configurations

1. Testing Checkpoint 6:
   - [ ] Full comparison of both versions
   - [ ] Verify build process
   - [ ] Test deployment pipeline
   - [ ] Check all environment configurations
   - [ ] Final Vercel preview test

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

### Vercel Deployment

- Update build command paths
- Maintain cron job functionality
- Handle environment-specific builds

## Rollback Plan

1. Maintain original directory structure until migration is complete
1. Keep backup of original configuration files
1. Document all changes for potential rollback
1. Test rollback procedure before final migration

## Rollback Procedures

### Local Development Rollback

1. Stop both development servers
1. Restore from backup if needed
1. Return to original directory structure
1. Restart original development server

### Vercel Deployment Rollback

1. Identify last known good deployment
1. Revert to previous configuration
1. Verify original functionality
1. Document rollback reason

## Validation Checklist

- [ ] All tests passing
- [ ] Build succeeding locally
- [ ] Vercel deployment working
- [ ] Firebase integration functional
- [ ] API routes responding correctly
- [ ] Static assets serving properly
- [ ] Environment-specific builds working
- [ ] Cron jobs operational
- [ ] Test coverage maintained
- [ ] Development workflow verified

## Next Steps

1. Begin with Phase 1 (Preparation)
1. Create new branch for migration
1. Complete each phase sequentially
1. Maintain comprehensive testing throughout
1. Document any deviations from plan
1. Update documentation as needed

## References

- Next.js documentation for monorepo support
- Vercel deployment configuration
- Firebase initialization documentation
- Jest configuration for monorepos
