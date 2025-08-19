# USER-LOGIN-TODO: Implementing Magic Link Authentication with UUID Persistence

## Overview

Implement passwordless authentication using magic links, built on the existing Firestore UUID system for continuity of
user data (favorites, chat history). We will ship in two phases:

- Phase I (no Salesforce) - COMPLETE: Admin-only onboarding via “Add User”. No public signup. Users receive an
  activation magic link (single-use, expires in 14 days). On activation, they get a long-lived JWT session and basic
  site-scoped entitlements. Audit all admin actions.
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

### 3. Hybrid Option (Optional Password Flow)

- [ ] Optional and deferred. Not required for Phase I/II. If implemented later, add only after magic-link flow is
      stable.

### 4. Deployment and Monitoring

- [ ] Document Phase I and II in `docs/user-auth-TODO.md` and `docs/backend-structure.md`.
- [ ] Vercel Cron at midnight PT for Phase II sync; add dashboards for success/failure counts.
- [ ] Monitor: login success, email delivery failures, sync outcomes, downgrade events; support ticket deltas.

## Risks and Mitigations

- Risk: Email deliverability/latency → Mitigation: Warm-up SES domain, consider SendGrid templates.
- Risk: Sync misses/downgrades surprise users → Mitigation: Clear user notifications; Ops alerts on repeated failures.
