# Newsletter Implementation Plan

## Overview

Implement a newsletter subscription system for the Ananda Library Chatbot with visual components (screenshots, bold
text), user preferences, and one-click unsubscribe functionality.

## Architecture Decisions

- **Package**: `email-templates` (Node.js/TypeScript) for HTML email composition
- **Sending**: Existing AWS SES via `emailOps.ts`
- **Storage**: Firestore for user preferences and newsletter history
- **Authentication**: JWT tokens for secure unsubscribe links
- **Default**: Opt-in by default, opt-out checkbox during profile completion
- **Frequency**: Manual trigger initially (monthly), expandable to cron later

## Phase 5: Production Rollout

- [ ] **Run email field cleanup migration script**

  - Script: `web/scripts/remove-duplicate-email-field.ts`
  - Purpose: Remove duplicate email fields where email field matches document ID
  - Command: `npx tsx web/scripts/remove-duplicate-email-field.ts --site ananda --env prod --dry-run`
  - Verify: Review dry-run output for mismatched emails before proceeding
  - Execute: `npx tsx web/scripts/remove-duplicate-email-field.ts --site ananda --env prod`
  - Note: Use `--force-mismatched` flag if needed to override mismatched email fields

- [ ] **Run newsletter opt-in migration script**

  - Script: `web/scripts/newsletter-opt-in-migration.ts`
  - Purpose: Opt all existing users into newsletter subscriptions by default
  - Command: `npx tsx web/scripts/newsletter-opt-in-migration.ts --site ananda --env prod --dry-run`
  - Verify: Review dry-run output to confirm user counts and opt-in strategy
  - Execute: `npx tsx web/scripts/newsletter-opt-in-migration.ts --site ananda --env prod --batch-size 100`
  - Result: Sets `newsletterSubscribed: true` for all existing users without this field

- [ ] **Validate production deployment**

  - [ ] Admin can access newsletter composition page
  - [ ] Newsletter preview renders correctly with site branding
  - [ ] Test unsubscribe flow with production JWT tokens
  - [ ] Verify email template rendering with production data
  - [ ] Check Firestore collections are created with proper permissions

- [ ] **Send test newsletter to admin team**
  - Compose test newsletter with sample content and images
  - Send to small group of admin users for validation
  - Verify email delivery, formatting, and unsubscribe functionality
  - Confirm newsletter history tracking works correctly
