// API: Request password reset link via email (no user enumeration)
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import {
  generateResetToken,
  hashResetToken,
  getResetExpiryDate,
  sendPasswordResetEmail,
} from "@/utils/server/passwordResetUtils";
import { writeAuditLog } from "@/utils/server/auditLog";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Check if password feature is enabled (only for sites with requireLogin)
  const siteConfig = loadSiteConfigSync();
  if (!siteConfig?.requireLogin) {
    return res.status(403).json({ error: "Password authentication not available for this site" });
  }

  // Rate limit: 3 attempts per hour per IP
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 60 * 1000,
    max: 3,
    name: "password-reset-request",
  });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());
  const emailLower = email.toLowerCase();

  try {
    const doc = await firestoreGet(userDocRef, "request password reset", email);

    // Always return success to prevent user enumeration
    // Only send email if user exists, is activated, and has password
    if (doc.exists) {
      const data = doc.data() as any;
      if (data?.inviteStatus === "accepted" && data?.passwordHash) {
        // Generate and store reset token
        const token = generateResetToken();
        const tokenHash = await hashResetToken(token);
        const expiresAt = firebase.firestore.Timestamp.fromDate(getResetExpiryDate(1));
        const now = firebase.firestore.Timestamp.now();

        await firestoreSet(
          userDocRef,
          {
            passwordResetTokenHash: tokenHash,
            passwordResetExpiresAt: expiresAt,
            updatedAt: now,
          },
          { merge: true },
          "store reset token"
        );

        // Send reset email
        await sendPasswordResetEmail(emailLower, token, req);

        // Audit log password reset request
        await writeAuditLog(req, "user_password_reset_requested", emailLower, {
          outcome: "success",
        });
      } else {
        // User exists but no password or not activated - log but don't reveal
        await writeAuditLog(req, "user_password_reset_requested", emailLower, {
          outcome: "skipped",
          reason: data?.inviteStatus !== "accepted" ? "not_activated" : "no_password",
        });
      }
    } else {
      // User doesn't exist - log but don't reveal
      await writeAuditLog(req, "user_password_reset_requested", emailLower, {
        outcome: "skipped",
        reason: "user_not_found",
      });
    }

    // Always return success response to prevent user enumeration
    return res
      .status(200)
      .json({ message: "If an account exists with that email, a password reset link has been sent" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
