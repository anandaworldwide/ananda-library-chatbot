# Chat History Feature TODO

## Overview

This document outlines the plan to add chat history on the home page, including a left rail (hamburger on mobile),
AI-generated titles, conversation grouping, URL navigation, and sharing support. Key requirements:

- Left rail shows last 20 conversations (lazy-load more), using AI titles (~4 words) or truncated questions (full if <7
  words).
- Clicking loads full conversation up to that point, allowing continuation.
- URLs: Dynamically change to `/answers/[answerId]` post-answer; reload restores state.
- Schema: Group via `convId`; titles on initial docs.
- Sharing: `/answers/[answerId]` loads convo up to that Q&A (view-only for others); no URL params to prevent tampering.
- Performance: Main chat loads first; history async.
- Cross-site: Tied to UUID (synced across devices for logged-in users).
- No retitling for follow-ups; indefinite storage.

## Finalized Database Schema Changes

- Add `convId` (string, UUID v4): Groups docs in a conversation. New convos generate new ID; follow-ups reuse it.
- Add `title` (string): AI-generated (~4 words) on initial doc only; follow-ups reference it.
- Backward-compatible: Existing docs treated as single-message convos.
- Migration: Assign unique `convId` to each existing doc (no grouping).
- Title Generation: Use fast model (e.g., `gpt-3.5-turbo`) with prompt: "Generate a concise four-word title for this
  question: [question]". Fallback to truncated question.

## URL and Sharing Details

- Format: `/answers/[answerId]` (reuse existing route; `[answerId]` = specific docId).
- On Load: Server fetches all docs with same `convId` and `timestamp <=` shared doc's timestamp (enforces "up to that
  point").
- For Recipients: View-only (disable input if UUID mismatch); no later follow-ups visible.
- Security: Server-side filtering (no URL params); JWT/UUID checks prevent tampering.
- Future: "Duplicate" button to fork new convId with copied history.

## Phased Implementation

Full-stack phases, each delivering testable value. Run `npm run test:all` at end of each.

### Phase 1: Schema Update + Basic History Fetching

Deliver: Grouped convos in DB; API to fetch raw history; simple rail showing ungrouped legacy items.

- [x] **Backend**: Update `saveOrUpdateDocument` (/api/chat/v1/route.ts) for `convId` logic (new UUID if
      `history.length === 0`; else reuse from last history item's doc).
- [x] **Backend**: Enhance `/api/chats.ts` to include `convId` in responses; add optional `convId` param for fetching a
      group.
- [x] **Backend**: Create migration script (e.g., `/migrations/migrate-conv-ids.ts`): Assign unique convId to each
      existing doc.
- [x] **Database Indexes**: Create `firestore.indexes.dev.json` file with composite indexes for new queries (uuid +
      convId, uuid + timestamp + convId, convId + uuid + timestamp + **name**).
- [x] **Index Deployment**: Run `firebase deploy --only firestore:indexes --config firebase.dev.json` to create indexes
      in development.
- [x] **Frontend**: Create `ChatHistoryFetcher` hook (async fetch via `/api/chats.ts` after main content loads).
- [x] **Frontend**: In `index.tsx`, add basic left rail (list raw questions, grouped by convId). Mobile: Hamburger menu
      (Tailwind responsive).
- [x] **Testing**: Backend tests for convId logic; frontend tests for fetcher/rail. Run `npm run test:all`.

### Phase 2: Title Generation + Enhanced Rail UI

Deliver: Clickable rail with titles; mobile menu; view full grouped convos on click.

- [x] **Backend**: Add async title generation in API route (post-answer, fire-and-forget); store in `title` field for
      new convos only. Fallback to truncated question (~4 words or full if <7). Include Google Analytics events for
      sidebar usage.
- [x] **Backend**: Update `/api/chats.ts` and new `/api/conversation/[convId]` to include titles.
- [x] **Frontend**: Enhance rail: Display titles (fallback per above), last 20 items (lazy-load more). Auto-update after
      new questions (no retitling for follow-ups). Styling: Gray bg (Tailwind `bg-gray-100`).
- [x] **Frontend**: On rail click, load full grouped convo into main area (fetch via API; render in chat UI). Support
      viewing up to clicked point (filter by timestamp).
- [x] **Testing**: Tests for title generation (mock AI); UI tests for rail clicks/titles/mobile. Run `npm run test:all`.

### Phase 3: URL Navigation + Sharing/Continuation

Deliver: Persistent URLs; share loads convo up to point; view-only for others.

- [ ] **Backend**: Enhance APIs: Respect UUID (prevent cross-user access). Add read-only mode if viewer UUID != doc
      UUID.
- [ ] **Frontend**: After answer streams (in `handleStreamingResponse`), push `/answers/[lastDocId]` (enhance
      `/answers/[answerId].tsx` to fetch/render full convo up to that doc).
- [ ] **Frontend**: On share load, check viewer UUID—if mismatch, disable input ("View Only"). Stub "Duplicate
      Conversation" button (copies history to new convId).
- [ ] **Frontend**: Reload handling: Hydrate from URL (fetch convo, populate `useChat` for continuation if owner).
- [ ] **Testing**: End-to-end tests for navigation/sharing/view-only/continuation. Run `npm run test:all`; manual QA on
      sites/devices.

### Phase 4: Production Rollout

Deliver: Feature deployed to production across all sites with proper migration and monitoring.

- [ ] **Migration**: Run `migrate-conv-ids.ts` script on production Firestore (all sites: ananda, ananda-public,
      crystal, jairam) to backfill `convId` for existing documents.
- [x] **Database Indexes**: Create `firestore.indexes.dev.json` and `firestore.indexes.prod.json` files with composite
      indexes for new queries (uuid + convId, uuid + timestamp + convId, convId + uuid + timestamp + **name**).
- [ ] **Index Deployment**: Deploy indexes using separate config files: - Development:
      `firebase deploy --only firestore:indexes --config firebase.dev.json` - Production:
      `firebase deploy --only firestore:indexes --config firebase.prod.json`
- [ ] **Vercel Deployment**: Deploy to production via GitHub main branch; monitor build logs and function deployments.
- [ ] **Site Testing**: Manual QA on all production sites (ananda, ananda-public, crystal, jairam) for chat history, URL
      navigation, sharing, mobile responsiveness.
- [ ] **Performance Monitoring**: Check response times for new APIs (/api/chats with convId, title generation); monitor
      Firestore read/write usage.
- [ ] **Rollback Plan**: Document rollback steps (revert deployment, disable migration script effects if needed).
- [ ] **User Communication**: Update any relevant documentation; consider announcement if significant UX change.
- [ ] **Post-Deploy Monitoring**: Monitor error logs, user feedback, and feature usage for first 48 hours; address any
      issues promptly.
