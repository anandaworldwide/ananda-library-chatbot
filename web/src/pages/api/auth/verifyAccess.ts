// API: Shared-password verification for self-provisioning unknown emails (grace transition).
// Creates a pending user with basic entitlements and sends activation email (14 days) on success.
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import bcrypt from "bcryptjs";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import {
  generateInviteToken,
  hashInviteToken,
  getInviteExpiryDate,
  sendActivationEmail,
} from "@/utils/server/userInviteUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 5 attempts/hour/IP soft lock
  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 60 * 1000, max: 5, name: "verify-access" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { email, sharedPassword } = req.body as { email?: string; sharedPassword?: string };
  if (!email || typeof email !== "string") return res.status(400).json({ error: "Invalid email" });
  if (!sharedPassword || typeof sharedPassword !== "string") return res.status(400).json({ error: "Invalid password" });

  const sharedHash = process.env.SITE_PASSWORD;
  if (!sharedHash) return res.status(500).json({ error: "Server misconfiguration" });

  const ok = await bcrypt.compare(sharedPassword, sharedHash);
  if (!ok) return res.status(403).json({ error: "Incorrect password" });

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());

  try {
    const existing = await firestoreGet(userDocRef, "verify access", email);
    const now = firebase.firestore.Timestamp.now();

    if (existing.exists) {
      const data = existing.data() as any;
      if (data?.inviteStatus === "accepted") return res.status(200).json({ message: "already active" });
      // pending → resend activation
      const token = generateInviteToken();
      const tokenHash = await hashInviteToken(token);
      const inviteExpiresAt = firebase.firestore.Timestamp.fromDate(getInviteExpiryDate(14));
      await firestoreSet(
        userDocRef,
        { inviteTokenHash: tokenHash, inviteExpiresAt, updatedAt: now },
        { merge: true },
        "resend activation on verify access"
      );
      await sendActivationEmail(email, token);
      return res.status(200).json({ message: "activation-resent" });
    }

    // Create pending user with basic entitlements
    const token = generateInviteToken();
    const tokenHash = await hashInviteToken(token);
    const inviteExpiresAt = firebase.firestore.Timestamp.fromDate(getInviteExpiryDate(14));
    await firestoreSet(
      userDocRef,
      {
        email: email.toLowerCase(),
        role: "user",
        entitlements: { basic: true },
        inviteStatus: "pending",
        inviteTokenHash: tokenHash,
        inviteExpiresAt,
        createdAt: now,
        updatedAt: now,
      },
      undefined,
      "create user via verify access"
    );
    await sendActivationEmail(email, token);
    return res.status(200).json({ message: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
