# S3 Prompt Deployment Guide

## Overview

This guide covers the deployment process for S3-stored prompt templates in the Ananda Library Chatbot. S3 storage
provides environment separation and enhanced security for sensitive prompts, but you can also store prompt templates
directly in the codebase if you prefer.

## S3 Environment Architecture

### Environment Separation

S3-stored prompts use environment-specific paths:

- **Development**: `s3://bucket/site-config/dev/prompts/`
- **Production**: `s3://bucket/site-config/prod/prompts/`

### Environment Detection

The system determines the environment using this priority order:

1. **NODE_ENV** environment variable (`development`, `production`)
2. **VERCEL_ENV** for preview deployments (preview always uses prod path)
3. **Default**: Falls back to 'dev' for safety

### S3 Path Construction

For S3-stored prompts, the system constructs paths as:

```url
s3://bucket/site-config/{environment}/prompts/{template-file}
```

Where `{environment}` is determined by the environment detection logic above.

## Deployment Process

### 1. Pre-Deployment Checks

- [ ] Verify S3 bucket access and permissions
- [ ] Validate site configuration uses `s3:` prefix: `"file": "s3:template-name.txt"`
- [ ] Check AWS credentials are configured
- [ ] Ensure prompt templates exist in development S3 path

### 2. S3 Prompt Preparation

- [ ] Ensure all prompt templates exist in production S3 path
- [ ] Run migration script if upgrading from legacy system
- [ ] Test prompt loading in production environment
- [ ] Verify fallback behavior for missing templates

### 3. Application Deployment

- [ ] Deploy application code to production
- [ ] Verify environment detection is working correctly
- [ ] Test prompt loading from correct S3 environment paths
- [ ] Monitor for any S3 template loading errors

### 4. Post-Deployment Verification

- [ ] Test chat functionality with actual S3 prompts
- [ ] Verify environment-specific prompt loading
- [ ] Check error logs for any S3 template loading issues
- [ ] Validate fallback behavior if needed

## Prompt Management Workflow

### Development Workflow

1. **Pull existing prompt for editing:**

   ```bash
   npm run prompt -- [site] pull [template-name]
   ```

2. **Edit prompt directly:**

   ```bash
   npm run prompt -- [site] edit [template-name]
   ```

3. **Test changes in development environment**

4. **Push changes to development S3:**

   ```bash
   npm run prompt -- [site] push [template-name]
   ```

### Production Promotion

1. **Promote from dev to production S3:**

   ```bash
   npm run prompt -- [site] promote [template-name]
   ```

2. **Review diff preview showing dev vs prod differences**

3. **Confirm production deployment**

4. **Test production functionality**

### File Locking System

The prompt management script implements file locking to prevent concurrent edits:

- **Lock file**: `s3://bucket/site-config/dev/prompts/.lock-{template-name}`
- **Automatic cleanup**: Locks expire after 30 minutes
- **Conflict resolution**: Script detects and prevents concurrent edits

## S3 Configuration

### Required AWS Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::your-bucket/site-config/*"]
    }
  ]
}
```

### S3 Bucket Setup

- **Versioning**: Enable S3 versioning for rollback capability
- **Encryption**: Use S3 server-side encryption for sensitive prompts
- **Access Logging**: Enable access logging for audit trail
- **Lifecycle**: Configure lifecycle rules for old versions

## Security Considerations

### S3 Security

- Use IAM roles with minimal required permissions
- Enable S3 bucket versioning for rollback capability
- Monitor S3 access logs for unusual activity
- Encrypt sensitive prompt content at rest
- Use VPC endpoints for S3 access when possible

### Environment Separation (Security)

- Never edit production prompts directly
- Always use dev → prod promotion workflow
- Maintain audit trail of prompt changes
- Use file locking to prevent concurrent edits

### Access Control

- Limit S3 access to necessary personnel
- Use separate AWS accounts for dev/prod if possible
- Implement MFA for S3 console access
- Regular audit of S3 access permissions
