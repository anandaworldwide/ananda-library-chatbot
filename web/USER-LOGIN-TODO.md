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

1. Missing UUID on answers/question-answer pairs from database

- Goal: Ensure every answer and question-answer record has an associated `uuid` for proper attribution and session
  binding.
- To do:
  - Add validation on read/write paths to require `uuid`.
  - Create a backfill/migration script to populate missing `uuid` values (deterministic mapping when possible).
  - Add monitoring to detect and alert on any future inserts without `uuid`.

## Prerequisites

- [x] Review existing auth code: `passwordUtils.ts`, `jwtUtils.ts`, `appRouterJwtUtils.ts`, `authMiddleware.ts`,
      `login.ts`, `logout.ts`.
- [x] Email service: Configure AWS SES for magic/activation emails; evaluate SendGrid for templates/analytics if needed.
- [ ] Phase II only: Define Salesforce API/webhook for entitlement fetching; confirm field mapping and auth.

## Implementation Steps

### Phase I — Backend (no Salesforce gating)

- [x] Update Firestore user schema (site-scoped):

  - `email` (unique per site), `uuid` (persistent ID), `siteId`, `role` (single string: `user` | `admin` | `superuser`),
    `entitlements` (basic only), `invitedBy`, `inviteStatus` (`pending` | `accepted` | `expired`), `inviteTokenHash`,
    `inviteExpiresAt`, `verifiedAt`, `lastLoginAt`, `audit` entries (append-only).

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

  - Use JWT for long sessions. Keep JWT claims minimal (userId/uuid, role, site). Resolve entitlements server-side per
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

- [x] Admin bootstrap via CLI only (initial superusers/admins)

  - Use CLI script: `npx tsx scripts/bootstrap-superuser.ts` (supports `--env`, `--email`, optional `--site`)
  - Removed API route and all env flags (ENABLE_ADMIN_BOOTSTRAP, ADMIN_BOOTSTRAP_SUPERUSERS)

- [ ] Admin edit user endpoints

  - Auth: `superuser` can modify role and email; `admin` can modify email only
  - Endpoints: `GET /api/admin/users/[userId]` (fetch), `PATCH /api/admin/users/[userId]` (update)
  - Validation: email format, per-site uniqueness, immutable `uuid`; single `role` field (`user` | `admin` |
    `superuser`) with only `superuser` allowed to change it; comprehensive audit entries for every change

- [ ] Email change behavior

  - Normalize email to lowercase; on change, transactional doc move + notification email to old and new addresses; keep
    `uuid` stable and sessions valid; log audit entry

### Phase I — Frontend

- [x] Admin UI: “Add User” form and Pending list with Resend (basic UI in place; shadcn polish pending).
- [x] Activation page: Handles token POST to `/api/verifyMagicLink`, shows success/error.
- [x] User data features: Continue keying to account `uuid`; clear legacy UUID cookie after activation.
- [x] Header auth label: Uses token manager init + cookie fallback; recognizes both `auth` (JWT) and `siteAuth`.

## Login Transition UX (Grace Period)

Purpose: Smooth transition to magic-link auth without spiking support. During the transition, existing users can
identify via email. If the email is unknown, they can self-provision using the existing shared password to receive an
activation email with basic entitlements.

Important constraints:

- Do NOT implement any time-based cutoff logic now. The "one-month grace" is a plan only. There should be no code that
  auto-disables anything by date. Future cutoff will be implemented via a separate change.
- Continue using the existing shared password for self-provision during this transition.
- Activation magic links remain valid for 14 days. Login magic links expire after 1 hour.

### UX Flow

- Default screen (Email-first):

  - User enters email.
  - If email exists and is active: send magic link → show confirmation message.
  - If email exists and is pending: resend activation link (refresh 14-day window) → show confirmation message.
  - If email is unknown: transition to "Verify access" screen.

- Verify access screen (Shared password):
  - Prompt for the shared password and email (email prefilled from prior step).
  - Include hint link: "Those with access to the Ananda library can get the password here." (same content/link as now).
  - If password is correct: create user with basic entitlements for the site, set status `pending`, generate 14-day
    activation token, send activation email, and show confirmation.
  - If password is incorrect: show error and apply rate limiting (see Security & Abuse).

### Security & Abuse

- Rate limiting for shared-password attempts: 5 attempts per hour per IP.
- Soft lock definition: when an IP exceeds the allowed attempts in the time window, further attempts are temporarily
  blocked until the window resets (no permanent ban). Audit the lock event.
- Continue existing rate limits on other auth endpoints.
- Audit logging: Record self-provision attempts and outcomes with IP, user agent, and siteId.

### Entitlements

- Self-provision assigns only basic entitlements. No domain restrictions at this stage. Extended entitlements (e.g.,
  `kriyaban`, `minister`) are not granted by self-provision.

### Admin Notifications

- Send a daily digest summarizing self-provision events (success/failure counts by site) to the operational email
  configured in `OPS_ALERT_EMAIL`. No per-event email to avoid noise.

### Tasks

- [x] Backend: Add rate limiting for the shared-password endpoint at 5 attempts/hour/IP.
- [x] Backend: Add audit entries for self-provision attempts (success/failure) with context.
- [x] Backend: Implement daily digest job that aggregates self-provision events and emails `OPS_ALERT_EMAIL`.
- [ ] Allow user to change their email address
- [ ] Monitoring: Add metrics for known-email matches, unknown-email branches, shared-password success/failure.

### Deferred (not in this change)

- [ ] Cutoff mechanism for ending grace period (date-based or flag). Not implemented now by design; will be added later.

### Phase I — Testing

- [x] addUser API endpoint tests (idempotent create/resent/active cases)
- [x] resendActivation API endpoint tests (pending and non-pending cases)
- [x] verifyMagicLink API endpoint tests (valid, expired, invalid token; JWT issuance)
- [x] bootstrap API endpoint tests (env-gated creation/update flows)
- [x] logout API tests updated to clear `auth` as well as legacy cookies
- [x] web-token API tests updated to accept `auth` JWT cookie when `requireLogin=true`

- [x] updateUser API tests
  - Role permissions (admin vs superuser), email validation, per-site uniqueness, restricted role transitions, audit log
    creation
- [x] Admin UI edit user tests
  - Visibility of role selector by role, form submission success/failure paths, error rendering, navigation from users
    list

#### New tests added (this branch)

- 🐣 SudoContext tests
  - Skips sudo checks on `/login` and does not call network
  - Sets `isSudoUser` from successful response and shows IP mismatch message
- 🐣 TokenManager tests
  - Placeholder token behavior on `/login` when fetch returns 401 or network error
  - Redirect logic on protected pages when 401 occurs (includes path + search)

#### Security: Admin/Superuser authorization tests to add

- 🐣 Admin-only API endpoints reject non-admins/non-superusers with 403 (and 401 unauth) — tests added for addUser,
  resendActivation, listPendingUsers; listActiveUsers: 401 OK, 403 pending
  - Endpoints: `/api/admin/addUser`, `/api/admin/resendActivation`, `/api/admin/listPendingUsers`,
    `/api/admin/listActiveUsers`
- 🐥 Superuser-only actions are restricted to superusers (admins/users receive 403)
  - Role changes enforced in `/api/admin/users/[userId]` with tests; grant/revoke admin will be enforced when endpoint
    exists
- 🐣 Admin page gating rules by site type:
  - No-login sites: require `sudoCookie` (401/redirect when missing/invalid; success when present)
  - Login sites: require JWT role `admin` or `superuser`; do not require `sudoCookie`
- 🐥 Role claim enforcement: attempts to set `role` or `entitlements` via request body are validated and audited //
  Admin bootstrap is CLI-only now; API and related env flags removed.
- 🐣 Rate limiting present on admin endpoints (validate 429 after threshold using `genericRateLimiter` mocks)
- 🐣 Profile endpoint exposes correct role and denies access without valid JWT
- 🐣 Audit logging stub: verify audit write calls occur for admin actions (shape only; content verified later)
- 🐥 Header/cookie security: admin APIs require JWT `auth` cookie; no reliance on client-readable values

#### Deprecate sudoCookie checks on login-required sites (comprehensive)

Goal: When `siteConfig.requireLogin === true`, never gate with `sudoCookie` or `SudoContext`. Always gate by JWT `role`
(`admin` or `superuser`). Keep `sudoCookie` only for no-login sites.

- [ ] Central rules doc block (this file + `docs/backend-structure.md`): state "no sudo on login sites; roles only"
- [ ] SSR page gating: ensure role-based gating when `requireLogin=true`
  - Files to verify/update to use `isAdminPageAllowed()` and ignore `sudoCookie` when login is required:
    - `src/pages/admin/index.tsx` (done)
    - `src/pages/admin/users.tsx` (done)
    - `src/pages/admin/users/[userId].tsx` (done)
    - `src/pages/admin/model-stats.tsx`
    - `src/pages/admin/relatedQuestionsUpdater.tsx` (done)
- [ ] API endpoints: replace sudo checks with role checks when `requireLogin=true`
  - `src/pages/api/admin/bindUuid.ts`
  - `src/pages/api/adminAction.ts`
  - `src/pages/api/answers.ts` (admin-only paths)
  - [x] `src/pages/api/downvotedAnswers.ts`
  - `src/pages/api/model-comparison-data.ts`
  - `src/pages/api/model-comparison-export.ts`
  - Keep `src/pages/api/sudoCookie.ts` (used by no-login sites only)
- [ ] Client components: avoid `SudoContext` for admin UI on login sites
  - `src/components/Footer.tsx` (done: role for login sites; sudo only for no-login)
  - `src/components/ModelComparisonChat.tsx` (derive admin capability from role; do not call `/api/sudoCookie` on login
    sites)
  - `src/components/SourcesList.tsx`, `src/components/AnswerItem.tsx`, `src/components/DownvotedAnswerReview.tsx`
    (ensure `isSudoAdmin` is driven by role when login required)
  - `src/pages/_app.tsx`: keep `SudoProvider` mounted, but ensure it short-circuits/no-ops on login-required sites
- [ ] Compare Models pages: role gate when login-required
  - `src/pages/compare-models.tsx` (currently uses sudo OR feature flag) → use role for login sites
- [ ] Tests (login sites): assert sudoCookie has no effect; role is authoritative
  - Add tests per endpoint/page above that:
    - (a) admin role → allowed
    - (b) user role → 403/notFound
    - (c) sudoCookie present but no JWT → 401/denied
- [ ] Telemetry: add log when a sudo-gated path is hit on a login site (to catch stragglers during rollout)

Role-specific gating details (login-required sites):

- [x] Add `requireSuperuser` support to `isAdminPageAllowed` (or companion helper) and wire it for superuser-only pages
- [x] Pages (superuser-only):
  - `src/pages/admin/downvotes.tsx`
  - `src/pages/admin/relatedQuestionsUpdater.tsx`
- [x] APIs (superuser-only on login sites):
  - [x] `src/pages/api/downvotedAnswers.ts`
  - Any related-questions admin mutation endpoint (when present)
- [x] Pages (admin permitted):
  - `src/pages/compare-models.tsx`
  - `src/pages/admin/model-stats.tsx`
- [x] APIs (admin permitted):
  - `src/pages/api/model-comparison-data.ts`
  - `src/pages/api/model-comparison-export.ts`

Settings page behavior:

- [x] `src/pages/settings.tsx`: return 404 (`notFound: true`) when `requireLogin=false` (no user settings on no-login
      sites)
- [ ] Add tests for settings SSR gating for both site types

Action mapping (final):

- Admin: add user, resend activation, list users (active/pending), export/report operations, model stats, model
  comparison tools (pages + exports)
- Superuser: change roles, bootstrap, grant/revoke admin, downvoted answers review tools, related questions updater

Follow-ups:

- [x] Profile endpoint uses shared JWT helpers and returns role (with token fallback)
- [ ] Migrate any remaining UI conditionals that look at `isSudoAdmin` to role-aware props

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
