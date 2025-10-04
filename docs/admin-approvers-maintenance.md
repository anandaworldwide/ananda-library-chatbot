# Admin Approvers Maintenance Guide

## Overview

This guide provides instructions for maintaining the admin approver lists used in the self-provisioning user
registration flow. Admin approvers are organized by continental regions and stored as JSON files in AWS S3.

## Data Structure

### S3 Storage Location

- **Bucket:** `ananda-chatbot`
- **Path:** `site-config/admin-approvers/`
- **File Naming:** `{site}-admin-approvers.json`

### Production Files

- `site-config/admin-approvers/ananda-admin-approvers.json`
- `site-config/admin-approvers/crystal-admin-approvers.json`
- `site-config/admin-approvers/jairam-admin-approvers.json`

### Development Files

- `site-config/admin-approvers/dev-ananda-admin-approvers.json`
- `site-config/admin-approvers/dev-crystal-admin-approvers.json`
- `site-config/admin-approvers/dev-jairam-admin-approvers.json`

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
        }
      ]
    }
  ]
}
```

## Regional Organization

- **Americas:** North, Central, and South America
- **Europe:** All European countries
- **Asia-Pacific:** Asia, Australia, New Zealand, Pacific Islands
- **Africa:** (Future expansion)
- **Middle East:** (Future expansion)

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

### Updating Admin Lists (Quarterly or As Needed)

#### For Production

1. **Download Current Data:**

   ```bash
   aws s3 cp s3://ananda-chatbot/site-config/admin-approvers/{site}-admin-approvers.json .
   ```

2. **Edit the JSON File:**

   - Add/remove/update admin entries
   - Update `lastUpdated` timestamp to current date
   - Validate JSON structure (use online JSON validator)

3. **Upload Updated File:**

   ```bash
   aws s3 cp {site}-admin-approvers.json s3://ananda-chatbot/site-config/admin-approvers/
   ```

4. **Test in Production:**
   - Verify changes appear in self-provisioning flow
   - Confirm email addresses are correct

#### For Development

1. **Follow same steps as production** but upload with `dev-` prefix
2. **Test changes in development environment first**
3. **Apply same changes to production files once verified**

**No deployment needed** - changes take effect immediately (respecting 5-minute cache TTL)

## Admin Entry Format

Each admin entry must include:

- `name`: Full display name (e.g., "John Smith")
- `email`: Contact email address (must be valid and monitored)
- `location`: City and state/country (e.g., "Palo Alto, CA" or "Melbourne, Australia")

## Best Practices

### Data Validation

- Always validate JSON syntax before uploading
- Test email addresses for deliverability
- Ensure region names match exactly

## Security Considerations

- Admin approver lists are stored securely on S3 with restricted access
- Email addresses are used only for backend approval email notifications
- Only admin names and locations are exposed to users in the interface
- No sensitive information should be included beyond contact details
- Access to S3 bucket should be restricted to authorized administrators
- Changes should be logged and auditable
