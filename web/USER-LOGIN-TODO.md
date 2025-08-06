# USER-LOGIN-TODO: Implementing Magic Link Authentication with UUID Persistence

## Overview

This TODO outlines the implementation of a passwordless magic link authentication system, integrated with Salesforce for
email validation and entitlements. It builds on the existing UUID system in Firestore, ensuring continuity for user data
(e.g., favorites, chat history). Key goals: Maximize ease of use, minimize support tickets, support long sessions (up to
6 months), and handle three access levels. We'll use AWS SES for email delivery, with optional SendGrid integration for
low-volume use.

The system will:

- Use magic links as the primary login flow.
- On first magic link click: Validate email via Salesforce, check for existing UUID/cookie/local storage, associate or
  generate a new UUID, fetch entitlements, and set a long-lived JWT session.
- Tie all user data to the UUID/email for persistence.
- Include a daily cron for entitlement syncing.
- Consider a hybrid option (optional password creation) for future flexibility.

## Prerequisites

- [ ] Review existing auth code: passwordUtils.ts, jwtUtils.ts, appRouterJwtUtils.ts, authMiddleware.ts, login.ts,
      logout.ts.
- [ ] Confirm Salesforce API integration: Define endpoint for email validation and entitlement fetching (e.g., access
      levels: public, kriyaban, premium).
- [ ] Set up email service: Configure AWS SES for magic link sending; evaluate SendGrid free tier for
      templates/analytics if needed.

## Implementation Steps

### 1. Backend Setup

- [ ] Update Firestore user schema: Ensure `users` collection includes fields like `email` (unique), `uuid` (persistent
      ID), `entitlements` (array/object from Salesforce), `lastSync` (timestamp for cron).

- [ ] Create magic link generation endpoint (e.g., /api/requestMagicLink.ts):

  - Accept email via POST.
  - Validate email format.
  - Query Salesforce for authorization and entitlements.
  - If valid, generate a one-time token (e.g., signed JWT with 15-min expiration).
  - Send email with link (e.g., <https://yourdomain.com/verify?token=xxx>) using emailOps.ts.
  - Handle errors (e.g., invalid email, Salesforce failure) with user-friendly messages.

- [ ] Create verification endpoint (e.g., /api/verifyMagicLink.ts):

  - GET/POST with token.
  - Validate token (not expired, unused).
  - Fetch/check for existing UUID from cookie/local storage (if present).
  - If existing UUID found and matches email, associate and refresh entitlements from Salesforce.
  - If no UUID or mismatch, generate new UUID and store in Firestore with email/entitlements.
  - Set long-lived JWT cookie (maxAge: 6 months, HttpOnly, secure) via jwtUtils.ts.
  - Redirect to dashboard or home.

- [ ] Implement UUID association logic:

  - In verification: Check request cookies/local storage for existing UUID.
  - Query Firestore: If UUID exists but linked to different email, handle conflict (e.g., generate new or prompt user).
  - Update user doc to link email and entitlements.

- [ ] Add session persistence:

  - Use JWT with refresh token mechanism for safe long sessions.
  - On each request, validate JWT and check entitlements via middleware (extend authMiddleware.ts).

- [ ] Daily cron job for entitlement sync (e.g., extend pruneRateLimits.ts):

  - Query active users (e.g., last login > 30 days).
  - Re-fetch entitlements from Salesforce.
  - Update Firestore; if revoked, flag for session invalidation (e.g., add `revoked: true` checked in middleware).

- [ ] Security enhancements:
  - Rate limit magic link requests (using genericRateLimiter.ts, e.g., 5 per IP/hour).
  - Add device/IP checks on verification to flag suspicious logins.
  - Implement "log out from all devices" endpoint.

### 2. Frontend Integration

- [ ] Update login page/component:
  - Simple form: Email input + "Send Magic Link" button.
  - Handle submission: POST to /api/requestMagicLink.
  - Display messages (e.g., "Check your email!").
- [ ] Verification page (e.g., /verify):

  - Handle token from URL, POST to /api/verifyMagicLink.
  - Show loading/success/error states.
  - Redirect based on entitlements (e.g., to restricted content).

- [ ] User data features (favorites, chat history):
  - In relevant components (e.g., ChatInterface.tsx), key data to user's UUID (fetched from JWT/cookie).
  - Use Firestore queries filtered by UUID.

### 3. Hybrid Option (Optional Password Flow)

- [ ] Add during first verification: Prompt "Want faster logins? Set a password now."
- [ ] If chosen: Collect password, hash with bcrypt (passwordUtils.ts), store in user doc.
- [ ] Update login page: Offer "Login with Password" alongside magic link.
- [ ] In /api/login.ts: Validate password against hash, set JWT if match.

### 4. Testing

- [ ] Unit tests: Cover UUID generation/association, token validation, entitlement fetching (in
      **tests**/utils/server/).
- [ ] Integration tests: End-to-end flows (request link → verify → session persistence) in **tests**/api/.
- [ ] Edge cases: Existing UUID mismatch, expired links, Salesforce failures, multi-device sync.
- [ ] Run full suite: `npm run test:all`.

### 5. Deployment and Monitoring

- [ ] Update docs/user-auth-TODO.md with this implementation.
- [ ] Monitor: Track login success rates, email delivery failures, support tickets pre/post-launch.
- [ ] Rollout: Start with beta users to test varied tech levels.

## Risks and Mitigations

- Risk: High email volume → Mitigation: Confirm low volume; use SendGrid if needed.
- Risk: Entitlement sync misses → Mitigation: Add alerts if cron fails.
