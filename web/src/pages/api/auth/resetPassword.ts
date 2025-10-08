// API: Reset password using token from email
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import bcrypt from "bcryptjs";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { validatePasswordStrength, hashPassword } from "@/utils/server/passwordUtils";
import { writeAuditLog } from "@/utils/server/auditLog";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";

async function compareToken(token: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(token, hash);
  } catch {
    return false;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Check if password feature is enabled (only for sites with requireLogin)
  const siteConfig = loadSiteConfigSync();
  if (!siteConfig?.requireLogin) {
    return res.status(403).json({ error: "Password authentication not available for this site" });
  }

  // Rate limit: 10 attempts per hour per IP
  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 60 * 1000, max: 10, name: "password-reset" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { token, email, password } = req.body as { token?: string; email?: string; password?: string };
  if (!token || typeof token !== "string") return res.status(400).json({ error: "Reset token is required" });
  if (!email || typeof email !== "string") return res.status(400).json({ error: "Email is required" });
  if (!password || typeof password !== "string") return res.status(400).json({ error: "Password is required" });

  // Validate new password strength
  const validation = validatePasswordStrength(password);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message, requirements: validation.requirements });
  }

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());
  const emailLower = email.toLowerCase();

  try {
    const doc = await firestoreGet(userDocRef, "reset password", email);
    if (!doc.exists) {
      await writeAuditLog(req, "user_password_reset_failed", emailLower, {
        outcome: "failure",
        reason: "user_not_found",
      });
      return res.status(400).json({ error: "Invalid reset token" });
    }

    const data = doc.data() as any;
    if (data?.inviteStatus !== "accepted") {
      await writeAuditLog(req, "user_password_reset_failed", emailLower, {
        outcome: "failure",
        reason: "account_not_activated",
      });
      return res.status(400).json({ error: "Account not activated" });
    }

    // Check if reset token exists and is not expired
    const exp = (data?.passwordResetExpiresAt?.toMillis?.() ?? 0) as number;
    if (!exp || Date.now() > exp) {
      await writeAuditLog(req, "user_password_reset_failed", emailLower, {
        outcome: "failure",
        reason: "token_expired",
      });
      return res.status(400).json({ error: "Reset link expired" });
    }

    if (!data?.passwordResetTokenHash) {
      await writeAuditLog(req, "user_password_reset_failed", emailLower, {
        outcome: "failure",
        reason: "no_reset_token",
      });
      return res.status(400).json({ error: "Invalid reset token" });
    }

    // Verify token
    const valid = await compareToken(token, data.passwordResetTokenHash);
    if (!valid) {
      await writeAuditLog(req, "user_password_reset_failed", emailLower, {
        outcome: "failure",
        reason: "invalid_token",
      });
      return res.status(400).json({ error: "Invalid reset token" });
    }

    // Hash new password and store, clear reset token
    const newPasswordHash = await hashPassword(password);
    const now = firebase.firestore.Timestamp.now();

    await firestoreSet(
      userDocRef,
      {
        passwordHash: newPasswordHash,
        passwordSetAt: now,
        passwordResetTokenHash: firebase.firestore.FieldValue.delete(),
        passwordResetExpiresAt: firebase.firestore.FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
      "reset password"
    );

    // Audit log successful password reset
    await writeAuditLog(req, "user_password_reset_success", emailLower, {
      outcome: "success",
    });

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
