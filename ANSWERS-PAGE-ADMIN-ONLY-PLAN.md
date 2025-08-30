# Answers Page Admin-Only Access & Like Removal Plan

## Overview

This document outlines the comprehensive plan to convert the public answers page to admin-only access and remove the
like functionality from the Ananda Library Chatbot system.

## Current State Analysis

### Current Answers Page Implementation

- **Location**: `web/src/pages/answers.tsx`
- **Current Access Control**: Uses `siteConfig.allowAllAnswersPage` flag and sudo cookie fallback
- **Features**: Pagination, sorting (recent/popular), like functionality, copy links, delete (sudo only)
- **API Endpoint**: `web/src/pages/api/answers.ts`
- **Components**: `AnswerItem.tsx`, `LikeButton.tsx`

### Current Like System

- **API Endpoint**: `web/src/pages/api/like.ts`
- **Database**: Firestore collections `{env}_likes` and like counts in chat logs
- **Components**: `LikeButton.tsx`, like functionality in `AnswerItem.tsx`
- **Services**: `web/src/services/likeService.ts`, `web/src/hooks/useVote.ts`

### Current Authentication System

- **Roles**: `user`, `admin`, `superuser`
- **Login-Required Sites**: Use JWT role-based authentication
- **No-Login Sites**: Use sudo cookie system
- **Utilities**: `authz.ts`, `adminPageGate.ts`, `jwtUtils.ts`

## Requirements Analysis

### Access Control Requirements

1. **Login-Required Sites** (`requireLogin: true`):

   - Only users with `superuser` role can access answers page
   - Regular `admin` and `user` roles get 403 error

2. **No-Login Sites** (`requireLogin: false`):

   - Anyone can access answers page (not advertised, but accessible)

3. **Navigation Changes**:

   - Remove "All Answers" from top navigation completely
   - Add discrete link at bottom of pages for highest privilege users only:
     - Superusers on login-required sites
     - Sudo users on no-login sites
   - Link only shown to privileged users (obfuscation by design)

4. **No Backward Compatibility**: Implement all changes at once without transition period

## Implementation Plan

### Step 1: Update Site Configuration Schema

#### 1.1 Add New Configuration Flag

- **File**: `web/src/types/siteConfig.ts`
- **Change**: Add `allowPublicAnswersPage?: boolean` field
- **Default**: `false` (admin-only by default)

#### 1.2 Update Site Configuration Files

- **File**: `site-config/config.json`
- **Changes**:
  - Add `allowPublicAnswersPage: false` to all sites initially
  - Remove "All Answers" navigation items from all site configurations

### Step 2: Update Access Control Logic

#### 2.1 Create New Authorization Function

- **File**: `web/src/utils/server/answersPageAuth.ts` (new file)
- **Function**: `isAnswersPageAllowed(req, res, siteConfig): Promise<boolean>`
- **Logic**:

  ```typescript
  if (siteConfig.requireLogin) {
    // Login-required sites: only superusers
    const role = getRequesterRole(req);
    return role === "superuser";
  } else {
    // No-login sites: check allowPublicAnswersPage flag
    if (siteConfig.allowPublicAnswersPage) {
      return true; // Anyone can access
    } else {
      // Only sudo users can access
      const sudo = getSudoCookie(req, res);
      return !!sudo.sudoCookieValue;
    }
  }
  ```

#### 2.2 Update Answers Page Server-Side Props

- **File**: `web/src/pages/answers.tsx`
- **Change**: Replace current logic in `getServerSideProps` with new authorization function
- **Error Handling**: Return proper 403 error page instead of 404

#### 2.3 Update API Endpoint Authorization

- **File**: `web/src/pages/api/answers.ts`
- **Change**: Add same authorization logic to API endpoint
- **Response**: Return 403 for unauthorized access

### Step 3: Remove Navigation Items

#### 3.1 Update Site Configuration Navigation

- **File**: `site-config/config.json`
- **Change**: Remove "All Answers" navigation items from header.navItems in all site configurations

### Step 4: Remove Like Functionality

#### 4.1 Remove Like API Endpoint

- **File**: `web/src/pages/api/like.ts`
- **Action**: Delete entire file
- **Impact**: All like operations will return 404

#### 4.2 Remove Like Service and Hooks

- **Files to Remove**:
  - `web/src/services/likeService.ts`
  - `web/src/components/LikeButton.tsx`
- **Files to Update**:
  - `web/src/hooks/useVote.ts` - Remove `useLike()` function

#### 4.3 Update AnswerItem Component

- **File**: `web/src/components/AnswerItem.tsx`
- **Changes**:
  - Remove `LikeButton` import and usage
  - Remove `handleLikeCountChange` prop and related logic
  - Remove like-related state and error handling
  - Remove like count display
  - Update component interface to remove like-related props

#### 4.4 Update Answers Page Component

- **File**: `web/src/pages/answers.tsx`
- **Changes**:
  - Remove like status checking logic
  - Remove like-related state management
  - Remove like count change handlers
  - Update `AnswerItem` usage to remove like props

#### 4.5 Update Answer Type Definition

- **File**: `web/src/types/answer.ts`
- **Change**: Remove `likeCount` field from `Answer` interface (mark as optional for backward compatibility)

### Step 5: Add Bottom Navigation Component

#### 5.1 Create Discrete Answers Link Component

- **File**: `web/src/components/AnswersPageLink.tsx` (new file)
- **Purpose**: Show discrete "View all answers on a public page" link at bottom of pages
- **Logic**: Only visible to users who have access to answers page
- **Styling**: Subtle, non-prominent placement

#### 5.2 Add to Main Chat Page

- **File**: `web/src/pages/index.tsx`
- **Change**: Add AnswersPageLink component at bottom of page
- **Conditional**: Only show for authorized users

#### 5.3 Add Authorization Error Page

- **File**: `web/src/pages/answers.tsx`
- **Enhancement**: Improve 403 error display with clear messaging:
  - "Access Restricted - Admin Only"
  - Different messages for login-required vs no-login sites
  - Navigation back to allowed pages

### Step 6: Database Cleanup (Optional)

#### 6.1 Clean Up Like Data

- **Script**: Create migration script to remove orphaned like data
- **Collections**: `{env}_likes` collection
- **Chat Logs**: Remove `likeCount` fields from existing documents
- **Considerations**: This is optional as the data won't be accessed anymore

### Step 7: Update Tests

#### 7.1 Update Answers Page Tests

- **Files**:
  - `web/__tests__/pages/answers.test.tsx`
  - `web/__tests__/api/answers.test.ts`
- **Changes**:
  - Test new authorization logic
  - Test 403 error responses
  - Remove like-related test cases

#### 7.2 Remove Like System Tests

- **Files to Remove**:
  - `web/__tests__/api/like.test.ts`
  - `web/__tests__/components/LikeButton.test.tsx`
  - Like-related tests in other files

#### 7.3 Update Component Tests

- **Files**:
  - `web/__tests__/components/AnswerItem.test.tsx`
- **Changes**: Remove like functionality tests

### Step 8: Update Documentation

#### 8.1 Update Backend Structure Documentation

- **File**: `docs/backend-structure.md`
- **Changes**:
  - Document new authorization logic
  - Remove like system documentation
  - Update API endpoint documentation

#### 8.2 Update Site Configuration Documentation

- **Files**: Various documentation files
- **Changes**: Document new `allowPublicAnswersPage` configuration option

### Step 9: Production Rollout

#### 9.1 Pre-Deployment Checklist

- [ ] All code changes tested and merged to main branch
- [ ] Database cleanup script tested in development environment
- [ ] Site configuration updated with new authorization settings
- [ ] Documentation updated and reviewed
- [ ] All tests passing (frontend and backend)

#### 9.2 Deployment Steps

1. **Deploy Code Changes**

   ```bash
   # Deploy to production via standard deployment process
   git push origin main
   # Verify deployment completes successfully
   ```

2. **Run Database Cleanup Script**

   ```bash
   # For each site, run cleanup script to remove like data
   # Start with dry-run to verify what will be deleted
   npx tsx scripts/cleanup-like-data.ts --site ananda --env prod --dry-run

   # If dry-run looks correct, run actual cleanup
   npx tsx scripts/cleanup-like-data.ts --site ananda --env prod --batch-size 100

   # Repeat for other sites
   npx tsx scripts/cleanup-like-data.ts --site crystal --env prod --batch-size 100
   npx tsx scripts/cleanup-like-data.ts --site jairam --env prod --batch-size 100
   npx tsx scripts/cleanup-like-data.ts --site ananda-public --env prod --batch-size 100
   ```

3. **Verify Deployment**
   - [ ] Answers page accessible only to authorized users
   - [ ] Like buttons removed from all answer displays
   - [ ] Navigation menu updated (no "All Answers" link)
   - [ ] Discrete answers page link appears only for privileged users
   - [ ] 403 errors display proper messaging for unauthorized access

#### 9.3 Post-Deployment Monitoring

**First 24 Hours:**

- Monitor error logs for 403 errors on answers page
- Check user complaints about missing functionality
- Verify cleanup script completed successfully
- Monitor database performance after cleanup

**First Week:**

- Track usage patterns of answers page (should be admin-only)
- Monitor for any like-related errors (should be eliminated)
- Verify discrete link visibility working correctly

#### 9.4 Rollback Plan (If Needed)

If issues arise, rollback can be performed by:

1. **Code Rollback:**

   ```bash
   # Revert to previous deployment
   git revert <commit-hash>
   git push origin main
   ```

2. **Configuration Rollback:**

   - Temporarily set `allowPublicAnswersPage: true` for affected sites
   - Re-enable like system if critical (requires code changes)

3. **Database Rollback:**
   - Like data cannot be restored once deleted
   - Consider this before running cleanup script

#### 9.5 Success Metrics

- [ ] Zero like-related errors in logs
- [ ] Answers page access limited to authorized users only
- [ ] No user complaints about legitimate access being blocked
- [ ] Database cleanup completed without performance issues
- [ ] All tests continue to pass post-deployment

## Implementation Details

### New Authorization Function

```typescript
// web/src/utils/server/answersPageAuth.ts
import { NextApiRequest, NextApiResponse } from "next";
import { SiteConfig } from "@/types/siteConfig";
import { getRequesterRole } from "@/utils/server/authz";
import { getSudoCookie } from "@/utils/server/sudoCookieUtils";

export async function isAnswersPageAllowed(
  req: NextApiRequest,
  res: NextApiResponse | undefined,
  siteConfig: SiteConfig | null
): Promise<boolean> {
  if (!siteConfig) return false;

  if (siteConfig.requireLogin) {
    // Login-required sites: only superusers can access
    const role = getRequesterRole(req);
    return role === "superuser";
  } else {
    // No-login sites: check configuration
    if (siteConfig.allowPublicAnswersPage) {
      return true; // Public access allowed
    } else {
      // Only sudo users can access
      const sudo = getSudoCookie(req, res);
      return !!sudo.sudoCookieValue;
    }
  }
}
```

### Updated Site Configuration Schema

```typescript
// Addition to web/src/types/siteConfig.ts
export interface SiteConfig {
  // ... existing fields ...
  allowAllAnswersPage: boolean; // Keep for backward compatibility
  allowPublicAnswersPage?: boolean; // New field for public access control
  // ... rest of fields ...
}
```

### Updated AnswerItem Component (Simplified)

```typescript
// Key changes to web/src/components/AnswerItem.tsx
export interface AnswerItemProps {
  answer: Answer;
  handleCopyLink: (answerId: string) => void;
  handleDelete?: (answerId: string) => void;
  linkCopied: string | null;
  isSudoUser: boolean;
  isFullPage?: boolean;
  siteConfig: SiteConfig | null;
  showRelatedQuestions?: boolean;
  // Removed: handleLikeCountChange, likeStatuses
}

// In component JSX, remove:
// - LikeButton component
// - Like-related state and handlers
// - Like count display
// - Like error handling
```

## Testing Strategy

### Authorization Testing

- Test superuser access on login-required sites
- Test admin/user denial on login-required sites
- Test sudo access on no-login sites
- Test public access when enabled
- Test 403 error pages and messaging

### Regression Testing

- Ensure existing functionality still works
- Test navigation and UI updates
- Verify no broken links or references to removed features

### Performance Testing

- Verify page load times are not affected
- Test API response times

## Rollback Plan

### If Authorization Issues Occur

1. Revert to previous `getServerSideProps` logic
2. Restore original site configuration values
3. Re-enable like system if needed

### Configuration Rollback

- Set `allowPublicAnswersPage: true` for affected sites
- Restore navigation menu items
- Revert authorization logic to original state

## Risk Assessment

### High Risk

- **Breaking existing user workflows**: Users accustomed to accessing answers page
- **Navigation confusion**: Users may not understand why they can't access the page

### Medium Risk

- **Configuration errors**: Incorrect site configuration could block legitimate access
- **Test coverage gaps**: Missing edge cases in authorization logic

### Low Risk

- **Database cleanup**: Like data removal is optional and reversible
- **Performance impact**: Changes should not affect performance significantly

## Success Criteria

### Functional Requirements

- ✅ Superusers can access answers page on login-required sites
- ✅ Regular users cannot access answers page on login-required sites
- ✅ Sudo users can access answers page on no-login sites (when public access disabled)
- ✅ Public access works when enabled on no-login sites
- ✅ Like functionality is completely removed
- ✅ Proper 403 error pages are displayed

### Technical Requirements

- ✅ All tests pass
- ✅ No broken links or references
- ✅ Clean code with no unused imports or components
- ✅ Documentation is updated
- ✅ Configuration is properly validated

### User Experience Requirements

- ✅ Clear error messages for unauthorized access
- ✅ Proper navigation for authorized users
- ✅ No confusion about missing like functionality
- ✅ Consistent behavior across different site types

## Timeline Estimate

- **Steps 1-2 (Configuration & Authorization)**: 2-3 days
- **Steps 3-4 (Navigation & Like Removal)**: 3-4 days
- **Step 5 (Bottom Navigation Component)**: 1 day
- **Steps 6-8 (Cleanup, Tests & Documentation)**: 2-3 days
- **Total**: 8-11 days (reduced due to no backward compatibility)

## Dependencies

### External Dependencies

- Site configuration access
- Database access for testing
- Google Analytics data (for impact analysis)

### Internal Dependencies

- Authentication system stability
- Site configuration management
- Test environment availability

## Post-Implementation Monitoring

### Metrics to Track

- 403 error rates on answers page
- User complaints about access issues
- Admin/superuser usage patterns
- Site performance metrics

### Monitoring Period

- First 48 hours: Intensive monitoring
- First week: Daily checks
- First month: Weekly reviews

This plan provides a comprehensive roadmap for converting the answers page to admin-only access while removing the like
functionality, ensuring a smooth transition with minimal user impact.
