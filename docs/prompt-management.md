# Prompt Management and Environment Separation

## Overview

The Ananda Library Chatbot supports flexible prompt template storage with two options:

1. **Source Tree Storage**: Templates stored directly in the codebase at `web/site-config/prompts/`
2. **S3 Storage**: Templates stored in AWS S3 with environment separation for enhanced privacy and security

**Storage Method Selection**: The storage method is specified in each site's configuration file
(`web/site-config/prompts/[site].json`):

- **Source Tree**: `"file": "template-name.txt"` (loads from local filesystem)
- **S3 Storage**: `"file": "s3:template-name.txt"` (loads from S3 with environment separation)

**Why Choose S3?** S3 storage is primarily used for privacy reasons, allowing sensitive prompt templates to be stored
outside the source code repository while maintaining environment separation for safe development and deployment.

## Environment Architecture

### S3 Storage Path Structure

For sites using S3 storage (specified with `s3:` prefix in site config):

- **Development**: `s3://bucket/site-config/dev/prompts/template.txt`
- **Production**: `s3://bucket/site-config/prod/prompts/template.txt`
- **Legacy**: `s3://bucket/site-config/prompts/template.txt` (deprecated, maintained for backward compatibility)

### Source Tree Storage Path Structure

For sites using source tree storage (no `s3:` prefix in site config):

- **All Environments**: `web/site-config/prompts/template.txt` (loaded directly from filesystem)

### Environment Detection

The system determines the environment using the following priority:

1. **NODE_ENV** environment variable (`development`, `production`)
2. **VERCEL_ENV** for preview deployments (preview always uses prod path)
3. **Default**: Falls back to 'dev' for safety

## Prompt Management Script

The `npm run prompt` script provides a complete workflow for managing prompts safely. **Note**: This script is designed
for S3-stored prompts only. For source tree prompts, edit the files directly in `web/site-config/prompts/`.

### Basic Commands

```bash
# Pull a prompt from dev environment to local staging
npm run prompt -- [site] pull [filename]

# Edit a prompt (pulls if needed, opens in editor)
npm run prompt -- [site] edit [filename]

# Compare local staging with dev environment
npm run prompt -- [site] diff [filename]

# Push local changes to dev environment
npm run prompt -- [site] push [filename]

# Promote dev version to production
npm run prompt -- [site] promote [filename]
```

### Examples

```bash
# Work with ananda-public site base template (S3-stored)
npm run prompt -- ananda-public pull base.txt
npm run prompt -- ananda-public edit base.txt
npm run prompt -- ananda-public push base.txt
npm run prompt -- ananda-public promote base.txt

# Skip tests during promotion (not recommended)
npm run prompt -- ananda-public promote base.txt --skip-tests
```

## Promotion Workflow

### Step 1: Development and Testing

1. **Pull**: Download current dev version to local staging
2. **Edit**: Make changes using your preferred editor
3. **Test Locally**: Verify changes work as expected
4. **Push**: Upload to dev environment with automatic testing

### Step 2: Production Promotion

1. **Review Changes**: Use `diff` to compare dev vs prod
2. **Confirm Promotion**: Interactive confirmation required
3. **Backup**: Automatic backup of current prod version
4. **Deploy**: Copy dev version to production
5. **Validate**: Run production tests (unless skipped)
6. **Rollback**: Automatic rollback if tests fail

### Safety Features

- **Locking Mechanism**: Prevents concurrent edits by different users
- **Automatic Backups**: Creates backups before any destructive operations
- **Test Integration**: Runs validation tests after push/promote
- **Rollback Support**: Automatic rollback on test failures
- **Interactive Confirmation**: Requires explicit confirmation for production changes

## File Locking

The system uses S3-based file locking to prevent conflicts:

- **Lock Duration**: 5 minutes (configurable)
- **User-Based**: Different users can't edit the same file simultaneously
- **Lock Refresh**: Same user can refresh existing locks
- **Stale Lock Cleanup**: Automatically handles expired locks

## Testing Integration

### Automatic Testing

The script automatically runs validation tests after:

- Pushing to dev environment
- Promoting to production

### Test Commands

```bash
# Tests are run automatically, but can be triggered manually
npm run test:queries:[site]
```

### Test Failure Handling

- **Push Failure**: Restores previous dev version from backup
- **Promote Failure**: Restores previous prod version from backup
- **No Backup**: Deletes newly pushed/promoted file

## Editor Integration

The script automatically detects and uses your preferred editor:

1. **VS Code**: Uses `code -w` (waits for file closure)
2. **Environment Variable**: Respects `EDITOR` environment variable
3. **Fallback**: Uses `vim` as default

### Editor Configuration

```bash
# Set your preferred editor
export EDITOR=nano
npm run prompt -- ananda-public edit base.txt

# Or use VS Code explicitly
code web/scripts/.prompts-staging/base.txt
```

## Troubleshooting

### Common Issues

#### 1. Environment Variables Not Loaded

**Problem**: Script can't find S3 credentials or configuration

**Solution**: Ensure site-specific environment file exists:

```bash
# Check if environment file exists
ls -la .env.ananda-public

# Verify S3 configuration
grep S3_BUCKET_NAME .env.ananda-public
```

#### 2. File Locked by Another User

**Problem**: Cannot edit file due to active lock

**Solution**: Wait for lock to expire (5 minutes) or contact the other user

#### 3. Tests Failing After Push/Promote

**Problem**: Validation tests fail, causing automatic rollback

**Solution**:

- Check test output for specific failures
- Fix prompt issues locally
- Test with a smaller change first
- Use `--skip-tests` only if absolutely necessary

#### 4. Editor Not Opening

**Problem**: Script fails to open editor

**Solution**:

```bash
# Set editor explicitly
EDITOR=nano npm run prompt -- ananda-public edit base.txt

# Or edit file directly
code web/scripts/.prompts-staging/base.txt
```

#### 5. S3 Connection Issues

**Problem**: Cannot connect to S3 or access files

**Solution**:

- Verify AWS credentials and permissions
- Check S3 bucket name and region
- Ensure network connectivity

### Debug Mode

For additional debugging information:

```bash
# Enable debug logging
DEBUG=* npm run prompt -- ananda-public pull base.txt

# Check staging directory
ls -la web/scripts/.prompts-staging/
```

## Best Practices

### Development Workflow

1. **Always test locally** before pushing to dev
2. **Use descriptive commit messages** when possible
3. **Review diffs** before promoting to production
4. **Coordinate with team** to avoid conflicts
5. **Test thoroughly** in development environment

### Production Deployment

1. **Never skip tests** unless in emergency
2. **Always review diff** before promotion
3. **Have rollback plan** ready
4. **Monitor system** after promotion
5. **Document changes** for team awareness

### Security Considerations

1. **Protect environment files** - never commit credentials
2. **Use least privilege** for S3 access
3. **Monitor access logs** for unusual activity
4. **Rotate credentials** regularly
5. **Review permissions** periodically

## Migration from Legacy System

### Backward Compatibility

The system maintains backward compatibility with the legacy path structure:

- New deployments use environment-specific paths
- Legacy paths are checked as fallback
- Gradual migration is supported

### Migration Steps

1. **Deploy new code** with environment-aware loading
2. **Populate new paths** using migration script
3. **Test thoroughly** in both environments
4. **Remove legacy fallback** after verification
5. **Archive old templates** for history

For detailed migration instructions, see the migration section in the main TODO file.
