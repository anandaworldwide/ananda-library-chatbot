# Audit Log TTL Configuration

## Quick Setup

Setting up automatic deletion of audit logs after 365 days is straightforward. The system automatically sets an
`expireAt` field on each audit entry, and you just need to configure Google Cloud to honor these TTL timestamps.

## Collections to Configure

The audit system uses two collections that need TTL configuration:

- **Development**: `dev_admin_audit`
- **Production**: `prod_admin_audit`

Each audit entry includes an `expireAt` field set to exactly 365 days from creation.

## Configuration Steps

### Step 1: Navigate to Google Cloud Console

1. Go to your [Firebase Console](https://console.firebase.google.com/)
2. Select your project and click **Firestore Database**
3. Look for the **"Manage in Google Cloud Console"** link and click it
4. This will take you directly to the Google Cloud Firestore page

### Step 2: Configure TTL Policy

1. In Google Cloud Console, go to **Firestore** → **Database**
2. Click on **TTL Policies** in the left sidebar
3. Click **Create TTL Policy**

For each collection (`dev_admin_audit` and `prod_admin_audit`):

- **Collection**: Enter the collection name (e.g., `dev_admin_audit`)
- **Field**: Enter `expireAt`
- Click **Create**

### Step 3: Verify Configuration

Once created, the TTL policies will automatically delete documents when their `expireAt` timestamp is reached. You can
verify the policies are active by checking the **TTL Policies** page in Google Cloud Console.

That's it! The system will now automatically clean up audit logs after 365 days. Documents are typically deleted within
24-72 hours of their expiration time.

## Notes

- TTL deletion is a background process and may take up to 72 hours after expiration
- No additional costs - TTL operations don't count against Firestore quotas
- Deletion is permanent - ensure you have backups if needed for compliance
