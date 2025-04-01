# Token Security Implementation Project Tasks

> Note: This is a living document tracking security implementation tasks. AI will check off completed items
> (using [x]) and add any missing tasks. User interface tasks should go from [ ] to [?] indicating
> they need testing by a user, then go to [x] as done done.

## Remaining Tasks

### Security Improvements

- [ ] Fix bug where route does not fail when siteAuth cookie is missing
- [ ] Strip out /api/audio from file names and confirm with the user that things are still working
- [ ] Audit all other API endpoints for similar URL formatting vulnerabilities
- [ ] Consider implementing content-type checking for audio files to prevent serving non-audio content

### Testing

- [ ] Develop test suite for token authentication

  - [ ] Unit tests for token verification logic
  - [ ] Integration tests for secured endpoints
  - [ ] Tests for token refresh mechanism

- [ ] Test WordPress plugin token implementation in staging env

  - [ ] Verify that AJAX endpoint returns valid tokens
  - [ ] Test authentication flow with the Vercel backend
  - [ ] Check token refresh behavior on expiration
  - [x] Test site ID validation by connecting to different environments

- [ ] Add backend endpoint security testing
  - [ ] Test token verification logic on protected endpoints
  - [ ] Verify proper rejection of invalid/expired tokens

### React Query Integration Testing

- [ ] Test the Answers page to verify React Query fetching with pagination
- [ ] Verify like/unlike functionality with optimistic updates
- [ ] Test downvoting and verify vote state is maintained properly
- [ ] Test that data fetching works after JWT expiration (token refresh)

### Component Interaction Testing

- [ ] Test MessageItem components with vote functionality
- [ ] Test AnswerItem components with like functionality
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

### Documentation

- [ ] Create comprehensive documentation about the token security system

  - [ ] Update existing security documentation
  - [ ] Add examples of securing different types of endpoints

- [ ] Create security audit checklist
  - [ ] List of all endpoints and their security status
  - [ ] Process for reviewing new endpoints

### DevOps & Environment

- [ ] Verify environment variables are properly set across all environments

  - [ ] Ensure SECURE_TOKEN and SECURE_TOKEN_HASH are available
  - [ ] Check for any hardcoded test values

- [ ] Update deployment scripts if needed
  - [ ] Include security checks in CI/CD pipeline
  - [ ] Add token validation to pre-deployment tests

---

## Done

### App Router API Endpoints

- [x] Update /app/api/chat/v1/route.ts to implement JWT authentication
  - [x] Integrate withJwtAuth functionality into the NextJS App Router context
  - [x] Add security middleware that mimics the Pages Router middleware
  - [x] Update the TODO comment on line 41
  - [x] Handle token extraction and verification before processing requests

### Pages Router API Endpoints

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

### Audio API Endpoints

- [x] Review and secure audio API endpoints in /pages/api/audio/ directory
  - [x] Audit all endpoints to determine which need authentication
  - [x] Apply withJwtAuth middleware to relevant endpoints
  - [x] Secured /pages/api/audio/[filename].ts with JWT authentication
  - [x] Implemented conditional authentication based on site configuration
  - [x] Audio API now only requires authentication when site config has requireLogin set to true

### Frontend Integration

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

- [x] Answer item page is requiring authentication, but it should not.
  - [x] Fixed by updating SingleAnswer component to use regular fetch instead of queryFetch
- [x] Contact page is requiring authentication, but it should not.
  - [x] Fixed by updating Contact component to use regular fetch instead of queryFetch
- [x] Error checking sudo status message on incognito view of answer ID page
  - [x] Fixed by updating SudoContext to properly handle 401 responses for unauthenticated users
- [x] Verify that SUDO status security is secure by looking at how we do the BLESS process.

### WordPress Plugin Integration

- [x] Review WordPress plugin code for token usage

  - [x] Ensure plugin is using the token-based authentication system
  - [x] Verify plugin correctly sends token in Authorization header

- [x] Fix WordPress plugin script loading issues

  - [x] Resolve "window.aichatbotAuth is undefined" error
  - [x] Ensure proper script loading order and dependencies
  - [x] Add error handling for missing configurations

- [x] Document WordPress plugin integration in the security documentation

  - [x] Add detailed setup instructions
  - [x] Include error handling guidance

- [x] Add Site ID validation to prevent connecting to wrong backend
  - [x] WordPress plugin sends expected site ID with token requests
  - [x] Backend verifies site ID matches before issuing tokens
  - [x] User-friendly error messages for site mismatches
  - [x] Admin settings page for configuring expected site ID

### Manual Testing Tasks

- [x] Test /pages/api/answers.ts endpoint via browser to verify JWT auth
- [x] Test /pages/api/vote.ts to confirm voting works with JWT auth
- [x] Test /pages/api/like.ts to verify liking functionality with JWT auth
- [x] Test /pages/api/model-comparison-vote.ts to ensure model voting is protected
- [x] Test /pages/api/model-comparison-data.ts and verify data loads properly
- [x] Test /pages/api/model-comparison-export.ts for export functionality
- [x] Test /pages/api/audio/[filename].ts to verify audio files load correctly
- [x] Verify copy link functionality in both components

### Components Fixed to Use fetchWithAuth

- [x] ./contexts/SudoContext.tsx
- [x] ./components/Navbar.tsx
- [x] ./components/AudioPlayer.tsx
- [x] ./components/SecureDataFetcher.tsx
- [x] ./components/ModelComparisonChat.tsx
- [x] ./components/DownvotedAnswerReview.tsx
- [x] ./components/NPSSurvey.tsx
- [x] ./components/Header/BaseHeader.tsx
- [x] ./pages/index.tsx
- [x] ./pages/login.tsx
- [x] ./pages/bless.tsx
- [x] ./pages/admin/model-stats.tsx
- [x] ./pages/stats.tsx

### Audio API Security Improvements

- [x] Fixed CORS issues by using proper CORS middleware with appropriate headers
- [x] Implemented better URL sanitization to handle malformed paths (/api/audio//api/audio/filename)
- [x] Added comprehensive error handling and logging for debugging
- [x] Increased URL expiration time from 3600 to 21600 seconds (matches original code)
- [x] Remove audio hacks of hard-coding Treasures and Bakhtan
- [x] Added conditional authentication based on site configuration for audio endpoints
- [x] Only require authentication for audio files when the site has requireLogin set to true

### Authentication Improvements

- [x] Add friendly user-facing error messages for auth failures (instead of just console errors)
- [x] Modify token manager to automatically attempt token refresh on 401 responses
- [x] Implement a global error boundary to handle authentication failures consistently
- [x] Add client-side logging for auth failures to help with debugging
- [x] Create a "session expired" modal that appears when authentication cannot be restored
- [x] Make sure all API requests properly await token initialization before sending
- [x] Add retry mechanism with exponential backoff for authentication failures
