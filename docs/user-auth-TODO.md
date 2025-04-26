# Ananda Library Authentication Implementation Plan

## Overview: Site-Specific User Authentication

**Goal**: Get basic email/password authentication working for the Ananda site while maintaining existing password system
for other sites.

## Phase 0: Preparation

- [ ] Discuss with leadership opening up the site
- [ ] Investigate Ananda.org WordPress as OAuth Identity Provider
- [ ] Investigate PassKey login

## Phase 1: Basic Authentication Setup

### Configuration

- [ ] Add `enableUserAuth` flag to site configuration schema
- [ ] Update `config.json` to include `enableUserAuth: true` for Ananda site
- [ ] Update `config.json` to include `enableUserAuth: false` for other sites
- [ ] Add basic user group configuration for Ananda site:

  ```json
  "userGroups": {
    "users": { "level": 1, "description": "Basic authenticated users" }
  }
  ```

### Development Environment

- [ ] Set up local Supabase project
- [ ] Configure development environment variables

  ```env
  NEXT_PUBLIC_SUPABASE_URL=your-dev-project-url
  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-dev-anon-key
  SUPABASE_SERVICE_ROLE_KEY=your-dev-service-key
  ```

### Basic Implementation

- [ ] Create basic user profiles table in Supabase
- [ ] Implement basic auth components (login/signup)
- [ ] Create `useAuth` hook
- [ ] Add auth middleware for Ananda site only
- [ ] Update existing password system to work alongside new auth

### Phase 1 Testing

#### Phase 1 Unit Tests

- [ ] Test auth utility functions
  - [ ] Test email validation
  - [ ] Test password validation
  - [ ] Test token management
- [ ] Test auth hooks
  - [ ] Test `useAuth` hook states
  - [ ] Test auth context provider
- [ ] Test site configuration handling
  - [ ] Test enableUserAuth flag behavior
  - [ ] Test site-specific settings
  - [ ] Test configuration isolation between sites
  - [ ] Test default behavior when enableUserAuth is undefined
  - [ ] Test configuration validation for non-Ananda sites

#### Phase 1 Integration Tests

- [ ] Test authentication flow
  - [ ] Test signup process
  - [ ] Test login process
  - [ ] Test logout process
- [ ] Test session management
  - [ ] Test session persistence
  - [ ] Test session expiry
- [ ] Test existing password system compatibility
  - [ ] Test non-Ananda sites auth
  - [ ] Test system switching based on site
  - [ ] Test password system remains unchanged for non-Ananda sites
  - [ ] Test no auth UI elements appear on non-Ananda sites
  - [ ] Test existing session handling on non-Ananda sites
  - [ ] Test password protection still works on non-Ananda sites
  - [ ] Test URL-based access still works on non-Ananda sites
  - [ ] Test existing error handling on non-Ananda sites

#### Phase 1 E2E Tests (Cypress)

- [ ] Test complete signup flow
  - [ ] Valid email/password
  - [ ] Invalid inputs
  - [ ] Error messages
- [ ] Test complete login flow
  - [ ] Successful login
  - [ ] Failed login
  - [ ] Password reset
- [ ] Test site-specific behavior
  - [ ] Ananda site auth
  - [ ] Other sites password system
  - [ ] Verify no auth UI elements on non-Ananda sites
  - [ ] Test existing password flows on non-Ananda sites
    - [ ] Password protected pages
    - [ ] URL-based access
    - [ ] Session persistence
    - [ ] Error scenarios
  - [ ] Test switching between Ananda and non-Ananda sites
    - [ ] Auth state isolation
    - [ ] Session handling
    - [ ] UI consistency

#### Phase 1 Documentation

- [ ] Document basic auth setup
- [ ] Create user guide for email/password auth
- [ ] Document site-specific configuration
- [ ] Add API documentation for auth endpoints

#### Phase 1 Monitoring

- [ ] Set up basic auth metrics
  - [ ] Login success/failure rates
  - [ ] Signup completion rates
  - [ ] Auth errors tracking
- [ ] Configure basic alerts for auth issues

**Phase 1 Completion Criteria**:

- Users can sign up and log in with email/password on Ananda site
- Other sites continue to use existing password system
- Basic user session management works
- All unit tests pass with >90% coverage
- All integration tests pass
- All E2E tests pass
- Documentation is complete and reviewed
- Basic monitoring is in place

## Phase 2: User Groups and Permissions

**Goal**: Implement full user group system and role-based access control.

### User Groups Setup

- [ ] Extend user groups configuration for Ananda site:

  ```json
  "userGroups": {
    "users": { "level": 1, "description": "Basic authenticated users" },
    "sevakas": { "level": 2, "description": "Elevated access users" },
    "admins": { "level": 3, "description": "Administrative users" },
    "super_users": { "level": 4, "description": "Full system access" }
  }
  ```

- [ ] Add group-specific permissions configuration
- [ ] Create role management API endpoints

### Implementation

- [ ] Update user profiles table with role support
- [ ] Create `useRole` hook
- [ ] Implement role-based access control (RBAC) component
- [ ] Add role-based route protection
- [ ] Create role assignment interface for admins

### Phase 2 Testing

#### Phase 2 Unit Tests

- [ ] Test role management functions
  - [ ] Test role assignment
  - [ ] Test role validation
  - [ ] Test permission checks
- [ ] Test `useRole` hook
  - [ ] Test role states
  - [ ] Test role updates
- [ ] Test RBAC component
  - [ ] Test permission evaluation
  - [ ] Test role hierarchy

#### Phase 2 Integration Tests

- [ ] Test role system integration
  - [ ] Test role assignment flow
  - [ ] Test permission inheritance
  - [ ] Test role updates
- [ ] Test route protection
  - [ ] Test protected routes
  - [ ] Test public routes
  - [ ] Test role-based access
- [ ] Test API endpoints with roles
  - [ ] Test authorized access
  - [ ] Test unauthorized access
  - [ ] Test role elevation

#### Phase 2 E2E Tests (Cypress)

- [ ] Test role management interface
  - [ ] Assign roles
  - [ ] Remove roles
  - [ ] Update permissions
- [ ] Test role-based access
  - [ ] Test different user levels
  - [ ] Test permission boundaries
  - [ ] Test role switching
- [ ] Test error handling
  - [ ] Invalid role assignments
  - [ ] Permission conflicts
  - [ ] Edge cases

#### Phase 2 Documentation

- [ ] Document role system architecture
- [ ] Create admin guide for role management
- [ ] Document permission configuration
- [ ] Update API documentation with role endpoints

#### Phase 2 Monitoring

- [ ] Add role-based metrics
  - [ ] Role assignment tracking
  - [ ] Permission check metrics
  - [ ] Role usage statistics
- [ ] Set up alerts for role-based issues

**Phase 2 Completion Criteria**:

- Full role system implemented
- Admins can assign roles
- Role-based access control works
- All unit tests pass with >90% coverage
- All integration tests pass
- All E2E tests pass
- Role system documentation complete
- Role monitoring in place

## Phase 3: Admin Interface and Management

**Goal**: Implement comprehensive admin interface for user management.

### Admin Interface

- [ ] Create admin dashboard
- [ ] Implement user management interface
- [ ] Add user activity logs
- [ ] Create role management interface

### Footer Integration

- [ ] Update Footer component with role-based admin section
- [ ] Add user management section
- [ ] Implement role-specific admin functions
- [ ] Add role-based feature flags

### Phase 3 Testing

#### Phase 3 Unit Tests

- [ ] Test admin components
  - [ ] Test dashboard components
  - [ ] Test user management components
  - [ ] Test role management components
- [ ] Test admin utilities
  - [ ] Test user operations
  - [ ] Test role operations
  - [ ] Test activity logging
- [ ] Test footer admin section
  - [ ] Test visibility logic
  - [ ] Test role-based rendering
  - [ ] Test feature flags

#### Phase 3 Integration Tests

- [ ] Test admin dashboard functionality
  - [ ] Test user management flows
  - [ ] Test role management flows
  - [ ] Test activity logging
- [ ] Test admin API integration
  - [ ] Test user operations
  - [ ] Test role operations
  - [ ] Test data persistence
- [ ] Test footer integration
  - [ ] Test admin section behavior
  - [ ] Test role-based visibility
  - [ ] Test feature toggles

#### Phase 3 E2E Tests (Cypress)

- [ ] Test admin dashboard
  - [ ] Full user management flow
  - [ ] Full role management flow
  - [ ] Activity log review
- [ ] Test admin operations
  - [ ] Bulk user operations
  - [ ] Role assignments
  - [ ] Permission updates
- [ ] Test admin UI
  - [ ] Responsive design
  - [ ] Accessibility
  - [ ] Error handling

#### Phase 3 Documentation

- [ ] Document admin interface features
- [ ] Create admin user guide
- [ ] Document user management procedures
- [ ] Add troubleshooting guide

#### Phase 3 Monitoring

- [ ] Set up admin action tracking
- [ ] Monitor user management operations
- [ ] Track admin interface usage
- [ ] Configure admin-specific alerts

**Phase 3 Completion Criteria**:

- Complete admin interface working
- User management fully functional
- Role-based admin section in footer works
- All unit tests pass with >90% coverage
- All integration tests pass
- All E2E tests pass
- Admin documentation complete
- Admin monitoring operational

## Phase 4: Security and Production Readiness

**Goal**: Ensure system is secure and ready for production deployment.

### Security Implementation

- [ ] Set up Row Level Security (RLS) policies
- [ ] Implement rate limiting
- [ ] Add API security measures
- [ ] Configure CORS policies

### Production Setup

- [ ] Create production Supabase project
- [ ] Configure production environment variables
- [ ] Set up database backups
- [ ] Configure monitoring and alerts

### Phase 4 Testing

#### Phase 4 Unit Tests

- [ ] Test security utilities
  - [ ] Test RLS policies
  - [ ] Test rate limiting
  - [ ] Test API security
- [ ] Test CORS implementation
  - [ ] Test allowed origins
  - [ ] Test blocked origins
  - [ ] Test methods
- [ ] Test environment switching
  - [ ] Test config loading
  - [ ] Test env variables
  - [ ] Test fallbacks

#### Phase 4 Integration Tests

- [ ] Test security measures
  - [ ] Test RLS effectiveness
  - [ ] Test rate limiting behavior
  - [ ] Test API security
- [ ] Test production config
  - [ ] Test environment detection
  - [ ] Test production settings
  - [ ] Test backup systems
- [ ] Test migration procedures
  - [ ] Test data migration
  - [ ] Test rollback procedures
  - [ ] Test data integrity

#### Phase 4 E2E Tests (Cypress)

- [ ] Test security features
  - [ ] Penetration testing
  - [ ] Security headers
  - [ ] XSS protection
- [ ] Test production readiness
  - [ ] Load testing
  - [ ] Performance testing
  - [ ] Error handling
- [ ] Test migration
  - [ ] Full migration flow
  - [ ] Rollback procedures
  - [ ] Data verification

#### Phase 4 Documentation

- [ ] Document security measures
- [ ] Create security incident response plan
- [ ] Document backup procedures
- [ ] Create production deployment guide

#### Phase 4 Monitoring

- [ ] Set up security monitoring
- [ ] Configure backup monitoring
- [ ] Add performance metrics
- [ ] Set up comprehensive alerting

**Phase 4 Completion Criteria**:

- All security measures implemented and tested
- Production environment ready
- Migration plan tested
- All unit tests pass with >90% coverage
- All integration tests pass
- All E2E tests pass
- Security documentation complete
- Production monitoring ready

## Phase 5: Production Deployment

**Goal**: Successfully deploy to production and verify operations.

### Deployment

- [ ] Execute staged rollout
- [ ] Verify all systems
- [ ] Monitor initial usage
- [ ] Address any issues

### Final Verification

- [ ] Complete system testing
- [ ] Verify all documentation
- [ ] Confirm monitoring systems
- [ ] Test incident response

### User Communication

- [ ] Announce new features
- [ ] Provide user training
- [ ] Collect initial feedback
- [ ] Address user questions

**Phase 5 Completion Criteria**:

- System successfully deployed
- All features verified in production
- Users successfully onboarded
- Support system in place

## Pre-Phase Setup: Testing Pipeline Extension

**Goal**: Extend existing test infrastructure to support auth testing.

### Existing Test Infrastructure

✓ Jest setup with TypeScript support
✓ Test coverage reporting
✓ CI pipeline configuration
✓ Multiple test environments (server, client)
✓ Watch mode and CI mode
✓ Pre-commit hooks with Husky
✓ Testing library setup (@testing-library/react)

### Auth-Specific Test Extensions

- [ ] Add Supabase testing utilities

  ```typescript
  // test/utils/supabase.ts
  export const createTestClient = () => {
    // Supabase test client setup
  };
  ```

- [ ] Configure test environment variables

  ```env
  NEXT_PUBLIC_SUPABASE_URL=mock
  NEXT_PUBLIC_SUPABASE_ANON_KEY=mock
  SUPABASE_SERVICE_ROLE_KEY=mock
  ```

- [ ] Add auth-specific test helpers
  - [ ] Mock auth providers
  - [ ] Test user factories
  - [ ] Role simulation helpers

### Integration Test Setup for Auth

- [ ] Set up test database for auth
  - [ ] Local Supabase instance for testing
  - [ ] Test data seeding
  - [ ] Database cleanup hooks
- [ ] Add auth-specific test commands to package.json

  ```json
  {
    "test:auth": "jest --selectProjects=auth",
    "test:auth:coverage": "jest --selectProjects=auth --coverage",
    "test:auth:watch": "jest --selectProjects=auth --watch"
  }
  ```

### E2E Test Extensions

- [ ] Add Cypress auth commands

  ```typescript
  // cypress/support/commands.ts
  Cypress.Commands.add('login', (email, password) => {
    // Login command implementation
  });
  ```

- [ ] Add auth E2E test specs
  - [ ] Authentication flows
  - [ ] Role-based access
  - [ ] Site-specific auth behavior

### Quality Gates Update

- [ ] Update coverage thresholds for auth

  ```js
  // jest.config.js
  coverageThreshold: {
    './src/features/auth/**/*': {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90
    }
  }
  ```

- [ ] Add auth-specific test matchers
- [ ] Update CI workflow for auth tests

**Pipeline Extension Completion Criteria**:

- Auth-specific test utilities are in place
- Integration tests can run against test database
- E2E tests cover all auth flows
- Coverage thresholds are met for auth code
- CI pipeline includes auth-specific tests

## Implementation Notes

- Leverage existing test infrastructure for auth features
- Maintain current test coverage while adding auth
- Use existing CI pipeline with auth extensions
- Follow established testing patterns
- Documentation and monitoring are developed alongside features
- Each phase includes its own documentation and monitoring setup
- Final phase focuses on deployment and user transition
- Regular feedback collection throughout all phases
