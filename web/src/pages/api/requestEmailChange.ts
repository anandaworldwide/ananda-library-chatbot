import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth, getTokenFromRequest } from "@/utils/server/jwtUtils";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { writeAuditLog } from "@/utils/server/auditLog";
import {
  generateEmailChangeToken,
  hashEmailChangeToken,
  getEmailChangeExpiryDate,
  sendEmailChangeVerificationEmail,
} from "@/utils/server/userEmailChangeUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  // Authentication is handled by withJwtAuth middleware
  // Extract user info from the validated JWT token
  const payload = getTokenFromRequest(req) as any;
  const userEmail = typeof payload?.email === "string" ? payload.email.toLowerCase() : "";
  if (!userEmail) return res.status(400).json({ error: "User email not found in token" });

  // Rate limiting: 5 requests per day per user

  const rateLimitKey = `email-change-${userEmail}`;
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5, // requests per day
    name: rateLimitKey,
  });
  if (!allowed) return;

  const { newEmail } = req.body as { newEmail?: string };
  if (!newEmail || typeof newEmail !== "string") {
    return res.status(400).json({ error: "New email is required" });
  }

  const newEmailLower = newEmail.toLowerCase().trim();
  const currentEmailLower = userEmail.toLowerCase();

  // Validate email format
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!emailRegex.test(newEmailLower)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  // Check if new email is same as current
  if (newEmailLower === currentEmailLower) {
    return res.status(400).json({ error: "New email must be different from current email" });
  }

  const usersCol = getUsersCollectionName();

  try {
    // Check if new email is already in use by another user
    const existingUserQuery = await db.collection(usersCol).where("email", "==", newEmailLower).limit(1).get();
    if (!existingUserQuery.empty) {
      await writeAuditLog(req, "email_change_requested", userEmail, {
        newEmail: newEmailLower,
        outcome: "failed_email_in_use",
      });
      return res.status(400).json({ error: "Email address is already in use" });
    }

    // Get current user document (email is stored as document ID)
    const userDocRef = db.collection(usersCol).doc(currentEmailLower);
    const userDoc = await firestoreGet(userDocRef, "get user for email change", currentEmailLower);
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Generate verification token
    const token = generateEmailChangeToken();
    const tokenHash = await hashEmailChangeToken(token);
    const expiresAt = firebase.firestore.Timestamp.fromDate(getEmailChangeExpiryDate(24));

    // Update user document with pending email change
    await firestoreSet(
      userDocRef,
      {
        pendingEmail: newEmailLower,
        emailChangeTokenHash: tokenHash,
        emailChangeExpiresAt: expiresAt,
        updatedAt: firebase.firestore.Timestamp.now(),
      },
      { merge: true },
      "set pending email change"
    );

    // Send verification email to new address
    await sendEmailChangeVerificationEmail(newEmailLower, token, currentEmailLower);

    // Audit log
    await writeAuditLog(req, "email_change_requested", userEmail, {
      newEmail: newEmailLower,
      outcome: "success",
    });

    return res.status(200).json({
      success: true,
      message: "Verification email sent to new address",
      pendingEmail: newEmailLower,
    });
  } catch (err: any) {
    console.error("Email change request error:", err);
    await writeAuditLog(req, "email_change_requested", userEmail, {
      newEmail: newEmailLower,
      outcome: "failed_server_error",
      error: err.message,
    });
    return res.status(500).json({ error: "Failed to process email change request" });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
