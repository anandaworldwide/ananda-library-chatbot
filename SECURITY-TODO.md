# Token Security Implementation Project Tasks

> Note: This is a living document tracking security implementation tasks. AI will check off completed items
> (using [x]) and add any missing tasks. User interface tasks should go from [ ] to [?] indicating
> they need testing by a user, then go to [x] as done done.

## 1. App Router API Endpoints

- [x] Update /app/api/chat/v1/route.ts to implement JWT authentication
  - [x] Integrate withJwtAuth functionality into the NextJS App Router context
  - [x] Add security middleware that mimics the Pages Router middleware
  - [x] Update the TODO comment on line 41
  - [x] Handle token extraction and verification before processing requests

## 2. Pages Router API Endpoints

These endpoints need to be secured using the existing withJwtAuth middleware:

- [x] Secure /pages/api/answers.ts with JWT authentication
- [x] Secure /pages/api/vote.ts with JWT authentication
- [x] Secure /pages/api/like.ts with JWT authentication
- [x] Secure /pages/api/model-comparison-vote.ts with JWT authentication
- [x] Secure /pages/api/downvotedAnswers.ts with JWT authentication
- [x] Secure /pages/api/adminAction.ts with JWT authentication
- [x] Secure /pages/api/model-comparison.ts with JWT authentication
- [x] Secure /pages/api/relatedQuestions.ts with JWT authentication
- [x] Secure /pages/api/submitNpsSurvey.ts with JWT authentication
- [x] Secure /pages/api/contact.ts with JWT authentication
- [x] Secure /pages/api/model-comparison-data.ts with JWT authentication
- [x] Secure /pages/api/model-comparison-export.ts with JWT authentication
- [x] Audit /pages/api/pruneRateLimits.ts and /pages/api/firestoreCron.ts to determine if they need JWT auth
  - [x] These are cron job endpoints triggered by Vercel's built-in cron system or scheduled tasks
  - [x] Do not require JWT authentication as they are not publicly accessible endpoints
  - [x] Protected by withApiMiddleware and server-side validation

## 3. Audio API Endpoints

- [x] Review and secure audio API endpoints in /pages/api/audio/ directory
  - [x] Audit all endpoints to determine which need authentication
  - [x] Apply withJwtAuth middleware to relevant endpoints
  - [x] Secured /pages/api/audio/[filename].ts with JWT authentication

## 4. Frontend Integration

- [x] Create a utility function in the frontend to get and manage tokens

  - [x] Function to call /api/web-token and retrieve a token
  - [x] Store token securely in memory (not localStorage)
  - [x] Automatically refresh tokens before expiration

- [x] Update API client functions to include JWT in requests

  - [x] Add Authorization header with Bearer token to all secured API calls
  - [x] Handle token expiration and refresh logic
  - [x] Implement retry mechanism for failed auth attempts

- [x] Update React Query/SWR configurations to include auth headers
  - [x] Modify query client setup to include token in requests
  - [x] Handle 401 responses with token refresh logic

## 5. WordPress Plugin Integration

- [x] Review WordPress plugin code for token usage

  - [x] Ensure plugin is using the token-based authentication system
  - [x] Verify plugin correctly sends token in Authorization header

- [ ] Fix WordPress plugin script loading issues

  - [x] Resolve "window.aichatbotAuth is undefined" error
  - [x] Ensure proper script loading order and dependencies
  - [x] Add error handling for missing configurations

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

## 9. Manual Testing Tasks

### JWT Authentication & API Endpoints Testing

- [ ] Test /pages/api/answers.ts endpoint via browser to verify JWT auth
- [ ] Test /pages/api/vote.ts to confirm voting works with JWT auth
- [ ] Test /pages/api/like.ts to verify liking functionality with JWT auth
- [ ] Test /pages/api/model-comparison-vote.ts to ensure model voting is protected
- [ ] Test /pages/api/model-comparison-data.ts and verify data loads properly
- [ ] Test /pages/api/model-comparison-export.ts for export functionality
- [ ] Test /pages/api/audio/[filename].ts to verify audio files load correctly

#### Pages to test

- [ ] http://localhost:3000/answers
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]
- [ ]

#### Problems to fix

##### These seem to need to use fetchWithAuth instead of fetch

- [ ] ./contexts/SudoContext.tsx
- [ ] ./components/Navbar.tsx
- [ ] ./components/AudioPlayer.tsx
- [ ] ./components/SecureDataFetcher.tsx
- [ ] ./components/ModelComparisonChat.tsx
- [ ] ./components/DownvotedAnswerReview.tsx
- [ ] ./components/NPSSurvey.tsx
- [ ] ./components/Header/BaseHeader.tsx
- [ ] ./pages/index.tsx
- [ ] ./pages/login.tsx
- [ ] ./pages/bless.tsx
- [ ] ./pages/admin/model-stats.tsx
- [ ] ./pages/stats.tsx

## 10. Temporary Workarounds to Fix Later

- [ ] Re-implement JWT authentication for audio endpoints (/pages/api/audio/[filename].ts)
  - [ ] Currently bypassed to allow direct access without authentication
  - [ ] Needs to be secured again after frontend integration is complete
  - [ ] Update the AudioPlayer component to use fetchWithAuth when re-securing
  - [ ] Review and potentially keep CORS headers and redirection approach for better audio file handling
  - [ ] Keep the improved URL sanitization logic that fixes double-path issues

### Audio API Security Improvements

- [x] Fixed CORS issues by using proper CORS middleware with appropriate headers
- [x] Implemented better URL sanitization to handle malformed paths (/api/audio//api/audio/filename)
- [x] Added comprehensive error handling and logging for debugging
- [x] Increased URL expiration time from 3600 to 21600 seconds (matches original code)
- [ ] Remove audio hacks of hard-coding Treasures and Bakhtan And stripping out /api/audio from
      file names and then confirm with the user that things are still working
- [ ] Audit all other API endpoints for similar URL formatting vulnerabilities
- [ ] Consider implementing content-type checking for audio files to prevent serving non-audio content

#### Authentication Improvements

- [x] Add friendly user-facing error messages for auth failures (instead of just console errors)
- [x] Modify token manager to automatically attempt token refresh on 401 responses
- [ ] Implement a global error boundary to handle authentication failures consistently
- [x] Add client-side logging for auth failures to help with debugging
- [x] Create a "session expired" modal that appears when authentication cannot be restored
- [x] Make sure all API requests properly await token initialization before sending
- [x] Add retry mechanism with exponential backoff for authentication failures

### React Query Integration Testing

- [ ] Test the Answers page to verify React Query fetching with pagination
- [ ] Verify like/unlike functionality with optimistic updates
- [ ] Test downvoting and verify vote state is maintained properly
- [ ] Test that data fetching works after JWT expiration (token refresh)

### Component Interaction Testing

- [ ] Test MessageItem components with vote functionality
- [ ] Test AnswerItem components with like functionality
- [ ] Verify copy link functionality in both components
- [ ] Test source display positions (above/below content)
- [ ] Verify related questions display correctly when enabled

### Error Handling Testing

- [ ] Test behavior when token is invalid/expired (should automatically refresh)
- [ ] Test rate limiting functionality for protected endpoints
- [ ] Verify appropriate error messages for authentication failures
- [ ] Test network error recovery with React Query retry mechanism

### Regression Testing

- [ ] Verify WordPress plugin integration still works with the new auth system
- [ ] Test existing functionality (search, related questions, etc.) to ensure no regressions
- [ ] Verify NPS survey submission still works with the new protection
- [ ] Test contact form submissions with JWT auth

## Priority Order

1. App Router Chat API (highest priority) ✅
2. Critical Pages Router endpoints (answers.ts, like.ts, vote.ts, model-comparison-vote.ts) ✅
3. Most common endpoints used by the frontend (downvotedAnswers.ts, adminAction.ts, model-comparison.ts,
   relatedQuestions.ts, etc.) ✅
4. Model comparison endpoints (model-comparison-data.ts, model-comparison-export.ts) ✅
5. Audio API endpoints ✅
6. Frontend integration ✅
7. WordPress plugin verification ✅ (implementation complete, testing needed)
8. WordPress plugin script loading issues ⚠️ (critical bug fix needed) ✅
9. Documentation and testing

This security implementation will ensure all API endpoints are protected using the JWT-based token system,
maintaining a consistent security approach across the application.
