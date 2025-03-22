# Token Security Implementation Project Tasks

> Note: This is a living document tracking security implementation tasks. AI will check off completed items
> (using [x]) and add any missing tasks.

## 1. App Router API Endpoints

- [ ] Update /app/api/chat/v1/route.ts to implement JWT authentication
  - [ ] Integrate withJwtAuth functionality into the NextJS App Router context
  - [ ] Add security middleware that mimics the Pages Router middleware
  - [ ] Update the TODO comment on line 41
  - [ ] Handle token extraction and verification before processing requests

## 2. Pages Router API Endpoints

These endpoints need to be secured using the existing withJwtAuth middleware:

- [ ] Secure /pages/api/answers.ts with JWT authentication
- [ ] Secure /pages/api/model-comparison-vote.ts with JWT authentication
- [ ] Secure /pages/api/vote.ts with JWT authentication
- [ ] Secure /pages/api/like.ts with JWT authentication
- [ ] Secure /pages/api/model-comparison-data.ts with JWT authentication
- [ ] Secure /pages/api/model-comparison-export.ts with JWT authentication
- [ ] Secure /pages/api/downvotedAnswers.ts with JWT authentication
- [ ] Secure /pages/api/adminAction.ts with JWT authentication
- [ ] Secure /pages/api/model-comparison.ts with JWT authentication
- [ ] Secure /pages/api/relatedQuestions.ts with JWT authentication
- [ ] Secure /pages/api/submitNpsSurvey.ts with JWT authentication
- [ ] Secure /pages/api/contact.ts with JWT authentication
- [ ] Audit /pages/api/pruneRateLimits.ts and /pages/api/firestoreCron.ts to determine if they need JWT auth

## 3. Audio API Endpoints

- [ ] Review and secure audio API endpoints in /pages/api/audio/ directory
  - [ ] Audit all endpoints to determine which need authentication
  - [ ] Apply withJwtAuth middleware to relevant endpoints

## 4. Frontend Integration

- [x] Create a utility function in the frontend to get and manage tokens

  - [x] Function to call /api/web-token and retrieve a token
  - [x] Store token securely in memory (not localStorage)
  - [x] Automatically refresh tokens before expiration

- [x] Update API client functions to include JWT in requests

  - [x] Add Authorization header with Bearer token to all secured API calls
  - [x] Handle token expiration and refresh logic
  - [ ] Implement retry mechanism for failed auth attempts

- [ ] Update React Query/SWR configurations to include auth headers
  - [ ] Modify query client setup to include token in requests
  - [ ] Handle 401 responses with token refresh logic

## 5. WordPress Plugin Integration

- [x] Review WordPress plugin code for token usage

  - [x] Ensure plugin is using the token-based authentication system
  - [x] Verify plugin correctly sends token in Authorization header

- [ ] Fix WordPress plugin script loading issues

  - [x ] Resolve "window.aichatbotAuth is undefined" error
  - [x ] Ensure proper script loading order and dependencies
  - [x ] Add error handling for missing configurations

- [ ] Document WordPress plugin integration in the security documentation
  - [ ] Add detailed setup instructions
  - [ ] Include error handling guidance

## 6. Documentation & Testing

- [ ] Create comprehensive documentation about the token security system

  - [ ] Update existing security documentation
  - [ ] Add examples of securing different types of endpoints

- [ ] Develop test suite for token authentication

  - [ ] Unit tests for token verification logic
  - [ ] Integration tests for secured endpoints
  - [ ] Tests for token refresh mechanism

- [ ] Create security audit checklist
  - [ ] List of all endpoints and their security status
  - [ ] Process for reviewing new endpoints

## 7. DevOps & Environment

- [ ] Verify environment variables are properly set across all environments

  - [ ] Ensure SECURE_TOKEN and SECURE_TOKEN_HASH are available
  - [ ] Check for any hardcoded test values

- [ ] Update deployment scripts if needed
  - [ ] Include security checks in CI/CD pipeline
  - [ ] Add token validation to pre-deployment tests

## 8. Additional Tasks

- [ ] Test WordPress plugin token implementation in staging env

  - [ ] Verify that AJAX endpoint returns valid tokens
  - [ ] Test authentication flow with the Vercel backend
  - [ ] Check token refresh behavior on expiration

- [ ] Secure any missing frontend components

  - [ ] Check for any remaining direct fetch calls in components
  - [ ] Verify all form submissions use authentication

- [ ] Add backend endpoint security testing
  - [ ] Test token verification logic on protected endpoints
  - [ ] Verify proper rejection of invalid/expired tokens

## Priority Order

1. App Router Chat API (highest priority)
2. Critical Pages Router endpoints (answers.ts, like.ts)
3. Frontend integration (partially done - many components still need updating) ⚠️
4. WordPress plugin verification ✅ (implementation complete, testing needed)
5. WordPress plugin script loading issues ⚠️ (critical bug fix needed)
6. Remaining API endpoints
7. Documentation and testing

This security implementation will ensure all API endpoints are protected using the JWT-based token system,
maintaining a consistent security approach across the application.
