# USER-LOGIN-TODO: Implementing Magic Link Authentication with UUID Persistence

## Overview

Implement passwordless authentication using magic links, built on the existing Firestore UUID system for continuity of
user data (favorites, chat history). We will ship in two phases:

- Phase I (no Salesforce): Admin-only onboarding via “Add User”. No public signup. Users receive an activation magic
  link (single-use, expires in 14 days). On activation, they get a long-lived JWT session and basic site-scoped
  entitlements. Audit all admin actions.
- Phase II (Salesforce enrichment): On activation, attempt immediate Salesforce entitlement enrichment; also run a daily
  midnight PT sync. Salesforce is the source of truth. Users are notified on upgrades/downgrades. Ops alerted on sync
  failures. No local entitlement overrides.

Key goals: maximize ease of use, minimize support tickets, support long sessions (up to 6 months), and maintain clear
role governance and auditing. Use AWS SES for email (start with simple SES templates; evaluate SendGrid later for
templates/analytics). Use shadcn/ui for admin UI components.

Scope: Applies to the Ananda and Jairam sites only. Other sites do not use login.

Roles and governance:

- Roles: `user`, `admin`, `superuser`.
- Only `superuser` can assign or remove `admin` permissions.
- Bootstrap: first superusers/admins created via environment-gated bootstrap.
- Audit: record all admin actions (add user, resend activation, role changes) with who/when/context.

Entitlements:

- Basic entitlements: access to completely unrestricted content in the Pinecone database (site-scoped).
- No entitlement overrides; Salesforce wins on conflicts in Phase II.
- Extended entitlements: initial set = `kriyaban`, `minister`; final list TBD. Mapping to Salesforce fields defined in
  Phase II.

## Open Issues

1. Transition grace period using current shared password for self-provisioning

- Goal: For one month, allow users who know the existing shared password to sign in and self-provision an account with
  basic entitlements, to avoid a sudden support burden.
- To decide:
  - Exact UX flow (page/route to enter shared password + email, then send activation magic link)
  - Rate limiting and abuse prevention (IP limits, optional CAPTCHA)
  - Eligibility restrictions: open to any email
  - Sunset mechanics (automatic disable after one month, feature flag, and audit logging)

1. Administrator bootstrap (“knighting” initial admins)

- Goal: Establish the first set of `superuser`/`admin` accounts before rollout.
- To decide:
  - Mechanism: environment-gated bootstrap (decided)
  - Safety controls: single-use/limited-use, detailed audit logging, automatic disable after success
  - Scope: site-scoped creation only (per-site Firestore)
  - Logistics: process for selecting administrators (criteria, approvers, timeline)

## Prerequisites

- [ ] Review existing auth code: `passwordUtils.ts`, `jwtUtils.ts`, `appRouterJwtUtils.ts`, `authMiddleware.ts`,
      `login.ts`, `logout.ts`.
- [x] Email service: Configure AWS SES for magic/activation emails; evaluate SendGrid for templates/analytics if needed.
- [ ] Phase II only: Define Salesforce API/webhook for entitlement fetching; confirm field mapping and auth.

## Implementation Steps

### Phase I — Backend (no Salesforce gating)

- [x] Update Firestore user schema (site-scoped):

  - `email` (unique per site), `uuid` (persistent ID), `siteId`, `roles` (default `user`), `entitlements` (basic only),
    `invitedBy`, `inviteStatus` (`pending` | `accepted` | `expired`), `inviteTokenHash`, `inviteExpiresAt`,
    `verifiedAt`, `lastLoginAt`, `audit` entries (append-only).

- [x] Admin add user endpoint: `POST /api/admin/addUser`

  - Auth: `admin` or `superuser` (site-scoped).
  - Input: `{ email, siteId }`.
  - Behavior: Idempotent per (email, siteId). If no user, create with basic entitlements and `pending` status; generate
    activation token (single-use) valid for 14 days; send activation email. If user exists and is `pending`, resend and
    extend expiry. If user is already `accepted`, return 200 with no-op message.
  - Audit: Record actor, target email, result (created|resent|no-op).

- [x] Resend activation endpoint: `POST /api/admin/resendActivation`

  - Auth: `admin` or `superuser`. Idempotent. Only allowed for `pending` users. Generates a new token with a fresh
    14-day window, sends email, records audit.

- [x] Activation verification endpoint: `POST /api/verifyMagicLink`

  - Input: `{ token }` (from emailed link).
  - Validate token (unexpired, unused, matches site and email), mark `accepted`, set `verifiedAt`.
  - One-time UUID inheritance: if a legacy UUID is present (cookie or local storage) and not bound to a different
    account for this site, set the account's `uuid` to that value; otherwise generate a new UUID and store it.
  - After association, delete/expire any legacy UUID cookie and instruct the client to remove any legacy localStorage
    key so future requests use only the account UUID carried in the server-issued JWT.
  - Ignore any subsequent legacy UUID values on future requests (authoritative source is the account record/JWT).
  - Set long-lived JWT cookie (HttpOnly, secure, sameSite strict, maxAge 6 months).
  - Redirect to the appropriate page.

- [x] UUID association logic

  - During activation, perform one-time inheritance as above. From then on, the authoritative UUID is the account's
    stored value resolved from a validated JWT; never overwrite `uuid` from any legacy cookie/localStorage after
    activation. Handle edge conflicts by preferring the existing account UUID and auditing the decision.

- [x] Session persistence

  - Use JWT for long sessions. Keep JWT claims minimal (userId/uuid, roles, site). Resolve entitlements server-side per
    request to avoid stale claims.

- [x] Security enhancements

  - No per-admin daily limit for add/resend per requirement, but keep generic API abuse protection (reasonable IP-based
    limits) using `genericRateLimiter.ts`. Add device/IP checks on verification to flag suspicious logins. Add "log out
    from all devices" endpoint.
  - Server must ignore any client-supplied legacy UUID after activation; only accept UUID from a validated JWT.
    Proactively delete/expire legacy UUID cookies and instruct clients to clear localStorage to prevent re-binding
    attempts.

- [ ] Audit log

  - Append-only audit entries: action, actor, target, siteId, timestamp, context (requestId, IP), outcome.

- [x] Environment-gated admin bootstrap (initial superusers/admins)

  - Implement env-gated route `POST /api/admin/bootstrap` (enabled only when `ENABLE_ADMIN_BOOTSTRAP=true`)
  - Create site-scoped `superuser` (and optional `admin`) accounts from a vetted list (env or secure config)
  - Vetted list source: read comma-separated emails from env var `ADMIN_BOOTSTRAP_SUPERUSERS` (typically 1–2 superusers)
  - Single-use/limited-use; automatically disables itself after success; comprehensive audit logging

### Phase I — Frontend

- [x] Admin UI: “Add User” form and Pending list with Resend (basic UI in place; shadcn polish pending).
- [x] Activation page: Handles token POST to `/api/verifyMagicLink`, shows success/error.
- [x] User data features: Continue keying to account `uuid`; clear legacy UUID cookie after activation.
- [x] Header auth label: Uses token manager init + cookie fallback; recognizes both `auth` (JWT) and `siteAuth`.

### Phase I — Testing

- [x] addUser API endpoint tests (idempotent create/resent/active cases)
- [x] resendActivation API endpoint tests (pending and non-pending cases)
- [x] verifyMagicLink API endpoint tests (valid, expired, invalid token; JWT issuance)
- [x] bootstrap API endpoint tests (env-gated creation/update flows)
- [x] logout API tests updated to clear `auth` as well as legacy cookies
- [x] web-token API tests updated to accept `auth` JWT cookie when `requireLogin=true`

### Phase II — Salesforce Entitlement Enrichment

- [ ] Immediate check on activation

  - After successful activation, call Salesforce webhook/API to enrich entitlements. On failure/timeouts, proceed
    silently and try during the nightly sync.

- [ ] Daily sync (Vercel Cron)

  - Schedule: 00:00 America/Los_Angeles. Backoff/retry on failures; alert Ops on repeated failures (use existing
    ops-email utility). Sync rules: Salesforce is the source of truth. Apply upgrades/downgrades. Notify users via email
    when entitlements change.

- [ ] Data model additions

  - `entitlementsSource` (`local` | `salesforce`), `lastSalesforceSync`, `salesforceContactId?` (if available), and
    minimal additional fields needed for mapping. No site-specific mappings; mappings are global.

### Duplicate Handling (definition and defaults)

- Duplicate means an admin attempts to add the same email for the same `siteId` more than once.
- Behavior:

  - If no user exists: create `pending` user, send activation (14-day).
  - If user exists and is `pending`: resend activation and extend expiry (idempotent resend).
  - If user exists and is `accepted`: no-op (return 200 with “already active”); do not send a new activation.
  - Uniqueness is enforced per site. The same email may exist on another site with an independent account.

### 2. Frontend Integration

- [x] Admin pages only (no public signup): Add User and Pending list with Resend.
- [x] Activation page (`/verify`): token handling, states.
- [x] Continue keying favorites/chat history to UUID from a validated JWT; do not read UUID from legacy client storage.

### 3. Hybrid Option (Optional Password Flow)

- [ ] Optional and deferred. Not required for Phase I/II. If implemented later, add only after magic-link flow is
      stable.

### 4. Testing

- [x] Unit tests: token, UUID association, admin endpoints, JWT/session.
- [x] Integration tests: add → activation → session; pending → resend; accepted → no-op.
- [x] Run: `npm run test:all` (incremental additions verified one-by-one).

### 5. Deployment and Monitoring

- [ ] Document Phase I and II in `docs/user-auth-TODO.md` and `docs/backend-structure.md`.
- [ ] Vercel Cron at midnight PT for Phase II sync; add dashboards for success/failure counts.
- [ ] Monitor: login success, email delivery failures, sync outcomes, downgrade events; support ticket deltas.

## Risks and Mitigations

- Risk: Email deliverability/latency → Mitigation: Warm-up SES domain, consider SendGrid templates.
- Risk: Sync misses/downgrades surprise users → Mitigation: Clear user notifications; Ops alerts on repeated failures.
