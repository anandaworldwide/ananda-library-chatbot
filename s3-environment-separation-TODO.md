# S3 Environment Separation Implementation TODO

## Overview

Implement environment-specific S3 paths for prompt templates to separate development and production environments.

**Path Structure Change:**

- Current: `s3://bucket/site-config/prompts/some-template.txt`
- New: `s3://bucket/site-config/dev/prompts/some-template.txt` (dev)
- New: `s3://bucket/site-config/prod/prompts/some-template.txt` (prod)
- Preview environment will use prod path for now

## Implementation Tasks

### [x] 1. Update makechain.ts S3 Loading Logic 🐥

- [x] 🐥 Modify `loadTextFileFromS3` function to accept environment parameter
- [x] 🐥 Update `processTemplate` function to determine environment and construct path
- [x] 🐥 Add environment detection logic using NODE_ENV only
- [x] 🐥 Ensure preview environment uses prod path
- [x] 🐥 Keep changes minimal - only modify path construction

### [x] 2. Extend NPM Prompt Management Script 🐥

- [x] 🐥 Analyze existing `npm run prompt` script functionality
- [x] 🐥 Add environment-aware operations (dev vs prod)
- [x] 🐥 Implement promotion functionality (`npm run prompt promote`)
- [x] 🐥 Add confirmation prompts for production operations
- [x] 🐥 Include diff preview before promotion
- [x] 🐥 **SIMPLIFIED**: Removed unnecessary NODE_ENV detection - all editing is dev-only, promote copies dev→prod

### [x] 3. Environment Configuration 🐥

- [x] 🐥 Simplified to use NODE_ENV only (no custom PROMPT_ENV needed)
- [x] 🐥 Update environment detection logic
- [x] 🐥 Ensure fallback behavior for missing env vars

### [ ] 4. Migration Strategy

- [ ] **CRITICAL**: Leave existing templates in current location during rollout
- [x] 🐥 Create migration script to copy current templates to new env-specific paths
- [x] 🐥 Seed both dev and prod paths with current template content
- [ ] Plan removal of old templates after new code is deployed and verified
- [ ] Consider moving old templates to archive path to preserve version history

### [ ] 5. Documentation Updates

- [ ] Update README with new environment separation
- [ ] Document promotion workflow
- [ ] Update deployment guide
- [ ] Add troubleshooting section for template loading issues

## Migration Steps (Post-Implementation)

### [ ] Phase 1: Deploy New Code

- [ ] Deploy code with new environment-aware loading
- [ ] Verify existing templates still load from current location
- [ ] Monitor for any template loading issues

### [ ] Phase 2: Populate New Paths

- [ ] Run migration script to copy templates to dev and prod paths
- [ ] Verify templates load correctly from new paths
- [ ] Test promotion workflow

### [ ] Phase 3: Clean Up Old Templates

- [ ] Move existing templates to archive path (preserve history)
- [ ] Remove old template loading fallback code
- [ ] Update documentation to reflect final state

## Technical Notes

### Environment Detection Priority

1. `NODE_ENV` environment variable
2. `VERCEL_ENV` for preview detection
3. Default to 'dev' for safety

### Path Construction Logic

```typescript
// Current: site-config/prompts/template.txt
// New: site-config/{env}/prompts/template.txt
const envPath = getPromptEnvironment(); // 'dev' or 'prod'
const s3Key = `site-config/${envPath}/prompts/${templateFile}`;
```

### Special Cases

- Preview deployments: Always use 'prod' path
- Missing templates: Log warning and optionally fallback
- S3 errors: Graceful degradation with clear error messages

## Risk Mitigation

### [ ] Backward Compatibility

- [ ] Maintain fallback to current template location during transition
- [ ] Gradual rollout with monitoring
- [ ] Quick rollback plan if issues arise

### [ ] Data Safety

- [ ] No destructive operations on existing templates
- [ ] Copy operations only during migration
- [ ] Preserve version history in S3

### [ ] Testing Coverage

- [ ] Unit tests for environment detection
- [ ] Integration tests for template loading
- [ ] End-to-end tests for promotion workflow
