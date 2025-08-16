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

- [x] Review existing auth code: `passwordUtils.ts`, `jwtUtils.ts`, `appRouterJwtUtils.ts`, `authMiddleware.ts`,
      `login.ts`, `logout.ts`.
- [x] Email service: Configure AWS SES for magic/activation emails; evaluate SendGrid for templates/analytics if needed.
- [ ] Phase II only: Define Salesforce API/webhook for entitlement fetching; confirm field mapping and auth.

## Remaining Implementation Steps

### Phase I — Backend (no Salesforce gating)

- [x] Audit log

  - ✅ Append-only audit entries: action, actor, target, timestamp, context (requestId, IP), outcome.
  - ✅ Firestore security rules: server-only writes, admin/superuser reads, 365-day TTL retention.
  - ✅ TTL implementation: expireAt field automatically set to current date + 1 year for Google Cloud TTL.

- [ ] Email change behavior

  - Normalize email to lowercase; on change, transactional doc move + notification email to old and new addresses; keep
    `uuid` stable and sessions valid; log audit entry

### Tasks

- [x] Backend: Add rate limiting for the shared-password endpoint at 5 attempts/hour/IP.
- [x] Backend: Add audit entries for self-provision attempts (success/failure) with context.
- [x] Backend: Implement daily digest job that aggregates self-provision events and emails `OPS_ALERT_EMAIL`.
- [x] Add daily digest cron job to Vercel configuration (runs at 6:00 AM Pacific Time daily).
- [ ] Allow user to change their email address
- [ ] Monitoring: Add metrics for known-email matches, unknown-email branches, shared-password success/failure.

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
