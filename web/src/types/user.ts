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
  // Password authentication fields
  hasPassword?: boolean; // Computed field for client - whether user has password set
  passwordSetAt?: string | null; // When password was first set
  dismissedPasswordPromo?: boolean; // Whether user dismissed the password promotion banner
  // Admin-specific fields (when needed)
  id?: string; // For admin user detail pages (this will be the email/doc ID)
  conversationCount?: number; // For admin user detail pages
}

/**
 * Password validation response
 */
export interface PasswordValidation {
  valid: boolean;
  message?: string;
  requirements?: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
  };
}
