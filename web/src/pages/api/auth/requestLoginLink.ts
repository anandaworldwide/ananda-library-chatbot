// API: Email-first login request. If user exists: send login magic link. If pending: resend activation.
// If not found: return { next: "verify-access" } to trigger shared-password screen.
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import {
  sendActivationEmail,
  generateInviteToken,
  hashInviteToken,
  getInviteExpiryDate,
} from "@/utils/server/userInviteUtils";
import {
  generateLoginToken,
  hashLoginToken,
  getLoginExpiryDateHours,
  sendLoginEmail,
} from "@/utils/server/userLoginMagicUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 1000, max: 30, name: "request-login-link" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { email, redirect } = req.body as { email?: string; redirect?: string };
  if (!email || typeof email !== "string") return res.status(400).json({ error: "Invalid email" });

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());

  try {
    const doc = await firestoreGet(userDocRef, "request login link", email);
    const now = firebase.firestore.Timestamp.now();
    if (doc.exists) {
      const data = doc.data() as any;
      if (data?.inviteStatus === "accepted") {
        // Send login magic link
        const token = generateLoginToken();
        const tokenHash = await hashLoginToken(token);
        const expiresAt = firebase.firestore.Timestamp.fromDate(getLoginExpiryDateHours(1));
        await firestoreSet(
          userDocRef,
          { loginTokenHash: tokenHash, loginTokenExpiresAt: expiresAt, updatedAt: now },
          { merge: true },
          "store login token"
        );
        await sendLoginEmail(email, token, redirect, req);
        return res.status(200).json({ message: "login-link-sent" });
      }
      if (data?.inviteStatus === "pending") {
        // Resend activation link
        const token = generateInviteToken();
        const tokenHash = await hashInviteToken(token);
        const inviteExpiresAt = firebase.firestore.Timestamp.fromDate(getInviteExpiryDate(14));
        await firestoreSet(
          userDocRef,
          { inviteTokenHash: tokenHash, inviteExpiresAt, updatedAt: now },
          { merge: true },
          "update pending user for resend"
        );
        await sendActivationEmail(email, token, req);
        return res.status(200).json({ message: "activation-resent" });
      }
    }
    // Not found → ask frontend to go to verify-access (shared password)
    return res.status(200).json({ next: "verify-access" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
