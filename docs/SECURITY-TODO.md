# Token Security Implementation Project Tasks

> Note: This is a living document tracking security implementation tasks. AI will check off completed items (using [x])
> and add any missing tasks. User interface tasks should go from [ ] to [?] indicating they need testing by a user, then
> go to [x] as done done.

## Remaining Tasks

### Security Improvements

- [ ] Fix bug where route does not fail when siteAuth cookie is missing
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
