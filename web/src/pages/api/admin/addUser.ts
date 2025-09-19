// API: Admin adds a user by email. Creates/updates a pending user and emails a 14-day activation link.
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
import { writeAuditLog } from "@/utils/server/auditLog";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000,
    max: 60,
    name: "admin-add-user",
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

  const { email, customMessage } = req.body as { email?: string; customMessage?: string };
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Invalid email" });
  }

  // Validate customMessage if provided
  const validCustomMessage =
    typeof customMessage === "string" && customMessage.trim() ? customMessage.trim() : undefined;

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());

  try {
    const existing = await firestoreGet(userDocRef, "get user", email);
    const now = firebase.firestore.Timestamp.now();

    if (existing.exists) {
      const data = existing.data() as any;
      if (data?.inviteStatus === "pending") {
        // Resend/extend expiry
        const token = generateInviteToken();
        const tokenHash = await hashInviteToken(token);
        const inviteExpiresAt = firebase.firestore.Timestamp.fromDate(getInviteExpiryDate(14));
        await firestoreSet(
          userDocRef,
          {
            // Note: email is stored as document ID, not as a field
            inviteStatus: "pending",
            inviteTokenHash: tokenHash,
            inviteExpiresAt,
            updatedAt: now,
          },
          { merge: true },
          "update pending user"
        );
        await sendActivationEmail(email, token, req, validCustomMessage);
        return res.status(200).json({ message: "resent" });
      }
      if (data?.inviteStatus === "accepted") {
        return res.status(200).json({ message: "already active" });
      }
    }

    const token = generateInviteToken();
    const tokenHash = await hashInviteToken(token);
    const inviteExpiresAt = firebase.firestore.Timestamp.fromDate(getInviteExpiryDate(14));

    await firestoreSet(
      userDocRef,
      {
        // Note: email is stored as document ID, not as a field
        role: "user",
        entitlements: { basic: true },
        inviteStatus: "pending",
        inviteTokenHash: tokenHash,
        inviteExpiresAt,
        newsletterSubscribed: true, // Default opt-in for newsletter
        createdAt: now,
        updatedAt: now,
      },
      undefined,
      "create user"
    );

    await sendActivationEmail(email, token, req, validCustomMessage);
    await writeAuditLog(req, "admin_add_user", email.toLowerCase(), {
      status: "created",
      outcome: "success",
    });
    return res.status(200).json({ message: "created" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
