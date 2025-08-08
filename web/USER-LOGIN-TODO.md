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

## Prerequisites

- [ ] Review existing auth code: `passwordUtils.ts`, `jwtUtils.ts`, `appRouterJwtUtils.ts`, `authMiddleware.ts`,
      `login.ts`, `logout.ts`.
- [ ] Email service: Configure AWS SES for magic/activation emails; evaluate SendGrid for templates/analytics if needed.
- [ ] Phase II only: Define Salesforce API/webhook for entitlement fetching; confirm field mapping and auth.

## Implementation Steps

### Phase I — Backend (no Salesforce gating)

- [ ] Update Firestore user schema (site-scoped):

  - `email` (unique per site), `uuid` (persistent ID), `siteId`, `roles` (default `user`), `entitlements` (basic only),
    `invitedBy`, `inviteStatus` (`pending` | `accepted` | `expired`), `inviteTokenHash`, `inviteExpiresAt`,
    `verifiedAt`, `lastLoginAt`, `audit` entries (append-only).

- [ ] Admin add user endpoint: `POST /api/admin/addUser`

  - Auth: `admin` or `superuser` (site-scoped).
  - Input: `{ email, siteId }`.
  - Behavior: Idempotent per (email, siteId). If no user, create with basic entitlements and `pending` status; generate
    activation token (single-use) valid for 14 days; send activation email. If user exists and is `pending`, resend and
    extend expiry. If user is already `accepted`, return 200 with no-op message.
  - Audit: Record actor, target email, result (created|resent|no-op).

- [ ] Resend activation endpoint: `POST /api/admin/resendActivation`

  - Auth: `admin` or `superuser`. Idempotent. Only allowed for `pending` users. Generates a new token with a fresh
    14-day window, sends email, records audit.

- [ ] Activation verification endpoint: `POST /api/verifyMagicLink`

  - Input: `{ token }` (from emailed link).
  - Validate token (unexpired, unused, matches site and email), mark `accepted`, set `verifiedAt`, associate existing
    UUID from cookies/local storage when present, else generate a new UUID and store.
  - Set long-lived JWT cookie (HttpOnly, secure, sameSite strict, maxAge 6 months).
  - Redirect to the appropriate page.

- [ ] UUID association logic

  - During activation, if an existing UUID is present and linked to the same email/site, keep it; otherwise, store a new
    UUID. Handle edge conflicts by preferring the email/site-linked UUID and auditing the change.

- [ ] Session persistence

  - Use JWT for long sessions. Keep JWT claims minimal (userId/uuid, roles, site). Resolve entitlements server-side per
    request to avoid stale claims.

- [ ] Security enhancements

  - No per-admin daily limit for add/resend per requirement, but keep generic API abuse protection (reasonable IP-based
    limits) using `genericRateLimiter.ts`. Add device/IP checks on verification to flag suspicious logins. Add "log out
    from all devices" endpoint.

- [ ] Audit log

  - Append-only audit entries: action, actor, target, siteId, timestamp, context (requestId, IP), outcome.

### Phase I — Frontend

- [ ] Admin UI: Simple “Add User” form (email only) built with shadcn/ui components. Site scoping is automatic (each
      site has its own Firestore DB); admins/superusers can only add users within their current site. List pending users
      with “Resend activation”.
- [ ] Activation page: Handles token POST to `/api/verifyMagicLink`, shows success/error, redirects.
- [ ] User data features: Continue keying to user UUID; fetch from JWT/cookies.

### Phase I — Testing

- [ ] Unit tests: token generation/validation, idempotent add/resend, JWT creation, UUID association.
- [ ] Integration tests: add → email send (mock) → activation → session persistence; pending → resend; accepted → no-op.
- [ ] Edge cases: expired tokens (14 days), cross-site attempts, duplicate emails per site, cookie UUID mismatch.

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

- [ ] Admin pages only (no public signup): Add User and Pending list with Resend.
- [ ] Activation page (`/verify`): token handling, states, redirect logic.
- [ ] Continue keying favorites/chat history to UUID from JWT/cookies.

### 3. Hybrid Option (Optional Password Flow)

- [ ] Optional and deferred. Not required for Phase I/II. If implemented later, add only after magic-link flow is
      stable.

### 4. Testing

- [ ] Unit tests: token, UUID association, admin endpoints, audit logging, JWT/session, SF sync utilities (Phase II).
- [ ] Integration tests: add → activation → session; pending → resend; accepted → no-op; Phase II nightly sync with
      upgrade/downgrade.
- [ ] Run full suite: `npm run test:all`.

### 5. Deployment and Monitoring

- [ ] Document Phase I and II in `docs/user-auth-TODO.md` and `docs/backend-structure.md`.
- [ ] Vercel Cron at midnight PT for Phase II sync; add dashboards for success/failure counts.
- [ ] Monitor: login success, email delivery failures, sync outcomes, downgrade events; support ticket deltas.

## Risks and Mitigations

- Risk: Email deliverability/latency → Mitigation: Warm-up SES domain, consider SendGrid templates.
- Risk: Sync misses/downgrades surprise users → Mitigation: Clear user notifications; Ops alerts on repeated failures.
