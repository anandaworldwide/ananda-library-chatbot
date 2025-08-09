# Project Memory - Essential Lessons Learned

## Critical Bug Patterns to Avoid

### HTML Processing Issues

- **Issue**: Inline tags like `<em>`, `<strong>`, `<span>` incorrectly treated as paragraph boundaries
- **Fix**: Use `soup.get_text()` without separator parameter, handle block vs inline elements separately
- **Location**: `data_ingestion/utils/text_processing.py`

### Jest Mock Setup

- **Issue**: `@patch` decorators need path updates when modules are moved
- **Fix**: Update both import statements AND @patch decorator paths
- **Pattern**: `@patch("data_ingestion.audio_video.s3_utils.*")` → `@patch("data_ingestion.utils.s3_utils.*")`

### Environment Variables Don't Persist

- **Issue**: Environment variables don't persist across terminal sessions
- **Fix**: Always source `.env.ananda` and set variables in same shell session before running scripts
- **Critical**: Check which embedding models you're actually comparing

### Package-lock.json Changes

- **Issue**: Root `npm install` adds unnecessary platform-specific packages
- **Fix**: Always discard with `git checkout package-lock.json` - they're optional dependencies

## Performance and Architecture Decisions

### Chunking Strategy - PROVEN OPTIMAL

- **Current**: 600 tokens, 20% overlap with spaCy sentence-boundary chunking
- **Result**: 70%+ target range compliance (225-450 words)
- **Don't change**: All evaluations show current system is optimal

### Embedding Models

- **Production**: text-embedding-ada-002 (1536D) - proven performance
- **Avoid**: text-embedding-3-large (3072D) - 84-90% performance degradation
- **Lesson**: Higher dimensions != better performance for this domain

### Rate Limiting Implementation

- **Tool**: Redis-based with exponential backoff
- **Location**: `web/src/utils/server/genericRateLimiter.ts`
- **Cleanup**: Use cron job to prune old entries

## Development Workflow

### Memory Management (Critical)

- **Always read** `@self.md` and `@project.md` first
- **Always update** memory after fixing mistakes
- **Only store** general, reusable lessons (not request-specific details)

### Testing Requirements

- **Frontend**: `cd web && npm run test:all`
- **Python**: `cd data_ingestion && python -m pytest`
- **Pattern**: Write tests first, add to existing test files when logical

### CLI Argument Patterns

- **Preference**: Long-form arguments first in argparse
- **Environment**: Use `--site` argument with `pyutil.env_utils.load_env(site_name)`
- **Example**: `parser.add_argument("--video", "-v", ...)` not `("-v", "--video", ...)`

## Security and Deployment

### JWT Authentication

- **Implementation**: HttpOnly cookies with proper sameSite/secure flags
- **Location**: `web/src/utils/server/jwtUtils.ts`
- **Critical**: Always hash passwords with bcrypt

### CORS and Headers

- **Security headers**: CSP, HSTS, X-Frame-Options required
- **WordPress integration**: Use signed tokens for cross-site communication

## User Preferences

### Code Style

- **TypeScript over JavaScript** - always
- **OOP over functional** - user preference
- **Testing approach**: TDD with failing → passing pattern
- **Documentation**: Update relevant docs with changes

### Dependencies

- **Web versions take priority** - align all shared dependencies to `web/package.json`
- **Monorepo**: No local packages, duplicate utilities if needed
- **Version constraints**: `numpy<2.0` important for Python tests

## Site Configuration

- **Multi-site support**: ananda, crystal, jairam, ananda-public
- **Environment files**: `.env.[site]` pattern
- **Pinecone namespaces**: One per site
- **Config location**: `site-config/config.json`

## Authentication and Onboarding (Decisions)

- Admin-only onboarding via Add User; no public signup for Ananda and Jairam sites
- Roles: `user`, `admin`, `superuser` (only superuser can grant/revoke admin)
- Bootstrap first admins via environment-gated route/script
- Activation links: magic link, single-use, 14-day expiry; resend allowed; no per-admin daily cap
- Basic entitlements: access to completely unrestricted Pinecone content; site-scoped entitlements and logins
- Phase I: Implement auth, add/resend, activation, audit logging; no Salesforce dependency
- Phase II: Salesforce enrichment on activation + nightly (midnight PT) cron; Salesforce is source of truth;
  auto-up/downgrade; user notified on changes; Ops alerted on repeated sync failures; no local entitlement overrides
- Duplicate handling: per (email, site) — create if none; resend if pending; no-op if already active
- Bootstrap vetted list: env var `ADMIN_BOOTSTRAP_SUPERUSERS` with comma-separated emails (typically 1–2 superusers)

## UI and Templates

- Use shadcn/ui for admin UI (forms, lists, buttons)
- Start with SES email templates; consider SendGrid later for richer templates/analytics

## Entitlements (Interim)

- Extended entitlements initial set: `kriyaban`, `minister` (final list TBD by user)

## Never Do Again

1. Cross-evaluate between different embedding model generations
2. Use textual similarity for RAG evaluation (use embedding-based)
3. Add platform-specific packages to root package-lock.json
4. Hardcode model names in evaluation scripts (use parameters)
5. Move modules without updating ALL @patch decorator paths
