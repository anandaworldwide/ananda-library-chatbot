/**
 * User type definitions for the Ananda Library Chatbot
 */

export interface User {
  // Note: email is now stored as the document ID, not as a field
  uuid?: string | null;
  role?: string;
  firstName?: string | null;
  lastName?: string | null;
  verifiedAt?: string | null;
  lastLoginAt?: string | null;
  entitlements?: Record<string, any>;
  pendingEmail?: string | null;
  emailChangeExpiresAt?: any;
  inviteStatus?: string | null;
  newsletterSubscribed?: boolean;
  // Admin-specific fields (when needed)
  id?: string; // For admin user detail pages (this will be the email/doc ID)
  conversationCount?: number; // For admin user detail pages
}
