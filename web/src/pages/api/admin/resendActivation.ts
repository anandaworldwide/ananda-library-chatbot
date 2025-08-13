// API: Admin resends activation for a pending user. Extends expiry and emails a fresh activation link.
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { requireAdminRole } from "@/utils/server/authz";
import {
  generateInviteToken,
  hashInviteToken,
  getInviteExpiryDate,
  sendActivationEmail,
} from "@/utils/server/userInviteUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000,
    max: 60,
    name: "admin-resend-activation",
  });
  if (!allowed) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  // Authorization: admin or superuser only
  if (!requireAdminRole(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Invalid email" });
  }

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());

  try {
    const existing = await firestoreGet(userDocRef, "get user", email);
    if (!existing.exists) return res.status(404).json({ error: "User not found" });
    const data = existing.data() as any;
    if (data?.inviteStatus !== "pending") return res.status(400).json({ error: "Not pending" });

    const token = generateInviteToken();
    const tokenHash = await hashInviteToken(token);
    const inviteExpiresAt = firebase.firestore.Timestamp.fromDate(getInviteExpiryDate(14));
    await firestoreSet(
      userDocRef,
      { inviteTokenHash: tokenHash, inviteExpiresAt, updatedAt: firebase.firestore.Timestamp.now() },
      { merge: true },
      "resend activation"
    );
    await sendActivationEmail(email, token);
    return res.status(200).json({ message: "resent" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
