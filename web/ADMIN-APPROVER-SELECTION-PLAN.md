# Admin Approver Selection System - Implementation Plan

## Overview

When a new user attempts to self-provision an account with an unrecognized email address, they will be presented with a
regional list of admin approvers to choose from. The selected admin will receive an approval request email and can then
approve the new user.

---

## Data Structure

### S3 Storage

**Bucket:** `ananda-chatbot`

**Path:** `site-config/admin-approvers/`

**File naming:** `{site}-admin-approvers.json`

**Production:**

- `site-config/admin-approvers/ananda-admin-approvers.json`
- `site-config/admin-approvers/crystal-admin-approvers.json`
- `site-config/admin-approvers/jairam-admin-approvers.json`

**Development:**

- `site-config/admin-approvers/dev-ananda-admin-approvers.json`
- `site-config/admin-approvers/dev-crystal-admin-approvers.json`
- `site-config/admin-approvers/dev-jairam-admin-approvers.json`

**Environment Detection:** Automatically uses `dev-` prefix when `NODE_ENV !== "production"`

**Access:** Public read (contains only names, emails, and locations)

### JSON Schema

```json
{
  "lastUpdated": "2025-10-03",
  "regions": [
    {
      "name": "Americas",
      "admins": [
        {
          "name": "Admin User One",
          "email": "admin1@example.com",
          "location": "City Name, CA"
        },
        {
          "name": "Admin User Two",
          "email": "admin2@example.com",
          "location": "City Name, CA"
        }
      ]
    },
    {
      "name": "Europe",
      "admins": []
    },
    {
      "name": "Asia-Pacific",
      "admins": [
        {
          "name": "Admin User Three",
          "email": "admin3@example.com",
          "location": "City Name, New Zealand"
        }
      ]
    }
  ]
}
```

**Regional Groups:**

- **Americas** - North, Central, and South America
- **Europe** - All European countries
- **Asia-Pacific** - Asia, Australia, New Zealand, Pacific Islands
- **Africa** - (Future, if needed)
- **Middle East** - (Future, if needed)

---

## Implementation Tasks

### 1. Data Preparation ✅

- [x] Create initial `admin-approvers-ananda.json` with current admin list
- [x] Organize admins by continental regions
- [x] Validate JSON structure
- [x] Upload to S3 bucket
- [x] Implement environment-based file selection (dev- prefix for development)
- [ ] Create and upload dev-specific JSON files for testing

### 2. Backend API

**New endpoint:** `/api/admin/approvers` ✅

- [x] Fetches admin approver list from S3
- [x] Caches response (5-minute TTL) to reduce S3 calls
- [x] Returns JSON structure to frontend
- [x] Complete test suite with 9 passing tests

**New endpoint:** `/api/admin/requestApproval` ✅

- [x] Stores pending request in Firestore collection
- [x] Sends approval request email to selected admin
- [x] Includes requester's email and name
- [x] Logs request in audit trail
- [x] Sends confirmation email to requester
- [x] Complete test suite with 8 passing tests

**New endpoint:** `/api/admin/pendingRequests` ✅

- [x] Returns list of pending approval requests for authenticated admin
- [x] Supports approve/deny actions
- [x] Updates request status in Firestore
- [x] Sends approval/denial emails to requester
- [x] Complete test suite with 12 passing tests

### 3. Frontend UI ✅

**Location:** Self-provisioning flow when email not recognized

**Component:** `AdminApproverSelector.tsx` ✅

- [x] Fetches admin list from `/api/admin/approvers`
- [x] Displays grouped dropdown using `<optgroup>` tags
- [x] Format: `{name} ({location})`
- [x] On selection, sends approval request
- [x] Complete test suite with 11 passing tests

**Example UI:**

```text
Your email address is not recognized. Please select an admin
to request access:

┌─────────────────────────────────────┐
│ Select an admin to contact         ▼│
├─────────────────────────────────────┤
│ Americas                            │
│   Admin User One (City Name, CA)    │
│   Admin User Two (City Name, CA)    │
│   Admin User Four (City Name, OR)   │
│ Europe                              │
│   [European admins]                 │
│ Asia-Pacific                        │
│   Admin User Three (City Name, NZ)  │
└─────────────────────────────────────┘

[Request Access]
```

### 4. Email Notifications ✅

#### To Selected Admin ✅

- [x] Subject: "New Access Request - Ananda Library Chatbot"
- [x] Body includes:
  - [x] Requester's name
  - [x] Requester's email
  - [x] Link to review page where admin can approve or deny the request

#### To Requester (Confirmation) ✅

- [x] Subject: "Access Request Submitted"
- [x] Body:
  - [x] Confirms request sent to [Admin Name]
  - [x] Sets expectation for response time
  - [x] Provides support contact if needed

#### Approval Email ✅

- [x] Sends activation email when admin approves request

#### Denial Email ✅

- [x] Notifies requester of denial
- [x] Includes admin's optional message
- [x] Provides admin's email for follow-up questions

### 5. Admin Approval Flow ✅

- [x] Admin receives email notification with link to review page
- [x] Admin clicks link → authenticates if needed → directed to pending requests review page
- [x] Review page shows all pending requests assigned to this admin
- [x] Admin can approve or deny each request with optional message
- [x] Approved users receive activation email
- [x] Denied users receive notification with admin's message (if provided)
- [x] Pending requests visible in admin users page for review at any time

### 6. Testing ✅

- [x] Test S3 fetch and caching for admin approver lists (9 tests)
- [x] Test dropdown rendering with grouped regions (Americas, Europe, Asia-Pacific)
- [x] Test form submission with email and name fields
- [x] Test pending request creation in Firestore (8 tests)
- [x] Test approval request email delivery to selected admin
- [x] Test admin review page (list, approve, deny actions) (12 tests)
- [x] Test approval email delivery to requester
- [x] Test denial email delivery to requester
- [x] Test pending requests visibility in admin users page
- [ ] Verify site-specific approver lists (ananda, jairam) in production

### 7. Documentation Updates

- [x] Update `docs/backend-structure.md` with new API endpoints
- [x] Update `docs/PRD.md` with self-provisioning flow changes
- [x] Add admin maintenance guide for updating approver list

---

## Maintenance Workflow

### Setting Up Development Files

**Initial Setup:**

1. Create dev-specific JSON files with test/dummy admin data
2. Use generic names and emails (e.g., "Admin User One", "<admin1@example.com>")
3. Upload to S3 with `dev-` prefix:
   - `dev-ananda-admin-approvers.json`
   - `dev-crystal-admin-approvers.json`
   - `dev-jairam-admin-approvers.json`
4. Development environment will automatically use these files

**Benefits:**

- Safe testing without affecting production admin contacts
- Can include test admins for automated testing
- Independent updates for dev and production

### Updating Admin List (Quarterly or As Needed)

**For Production:**

1. Download current JSON from S3 or edit local copy
2. Add/remove/update admin entries
3. Validate JSON structure (use online JSON validator)
4. Update `lastUpdated` timestamp
5. Upload to S3, overwriting previous version
6. Test in production to verify changes

**For Development:**

1. Follow same steps but upload with `dev-` prefix
2. Test changes in development environment first
3. Once verified, apply same changes to production files

**No deployment needed** - changes take effect immediately (respecting cache TTL)

---

## Future Enhancements (Optional)

- Admin UI for managing approver list (avoid manual S3 editing)
- Auto-suggest nearest admin based on requester's location input
- Admin capacity indicators ("Currently accepting requests" badge)
- Multi-language support for international admins
- Analytics: Track which admins get most requests, approval rates

---

## Implementation Decisions

### Approval Workflow

**Mechanism:** Admin receives email notification with link that takes them to a dedicated review page where they can
approve or deny pending requests.

**Storage:** Pending requests stored in Firestore collection so they appear in admin dashboard even if admin misses the
email notification.

**Request Form Fields:**

- Email address (required)
- Name (required)

**Site-Specific Lists:** Each site (ananda, crystal, jairam) will have its own admin approver list.

**No Fallback:** If an admin does not respond to a request, there is no automatic fallback or reassignment. Requester
would need to submit a new request to a different admin if needed.
