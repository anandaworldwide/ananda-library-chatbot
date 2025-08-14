// API: Returns current user's profile info (email, uuid, role) based on auth JWT cookie
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { db } from "@/services/firebase";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet } from "@/utils/server/firestoreRetryUtils";
import { verifyToken } from "@/utils/server/jwtUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Rate limit
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000,
    max: 120,
    name: "profile",
  });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  try {
    const authCookie = req.cookies?.["auth"];
    if (!authCookie) return res.status(401).json({ error: "Not authenticated" });

    let payload: any;
    try {
      payload = verifyToken(authCookie);
    } catch {
      return res.status(401).json({ error: "Invalid session" });
    }

    const email = typeof payload?.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) return res.status(400).json({ error: "Malformed session" });

    const usersCol = getUsersCollectionName();
    const ref = db.collection(usersCol).doc(email);
    if (req.method === "GET") {
      const doc = await firestoreGet(ref, "get profile user", email);
      if (!doc.exists) return res.status(404).json({ error: "User not found" });

      const data = doc.data() as any;
      const roleFromDb = typeof data?.role === "string" ? data.role : undefined;
      const roleFromToken = typeof payload?.role === "string" ? payload.role : undefined;
      const role = roleFromDb || roleFromToken || "user";
      return res.status(200).json({
        email,
        uuid: data?.uuid || null,
        role,
        firstName: typeof data?.firstName === "string" ? data.firstName : null,
        lastName: typeof data?.lastName === "string" ? data.lastName : null,
      });
    }

    if (req.method === "PATCH") {
      const body = (req.body || {}) as { firstName?: string; lastName?: string };
      const updates: Record<string, any> = {};
      if (body.firstName !== undefined) {
        if (typeof body.firstName !== "string" || body.firstName.length > 100) {
          return res.status(400).json({ error: "Invalid first name" });
        }
        updates.firstName = body.firstName.trim();
      }
      if (body.lastName !== undefined) {
        if (typeof body.lastName !== "string" || body.lastName.length > 100) {
          return res.status(400).json({ error: "Invalid last name" });
        }
        updates.lastName = body.lastName.trim();
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updates provided" });

      // Check if this is the first profile completion after activation
      const userDoc = await firestoreGet(ref, "get user for profile update", email);
      if (userDoc.exists) {
        const userData = userDoc.data() as any;
        if (userData?.inviteStatus === "activated_pending_profile") {
          // Mark as fully accepted when they complete their profile
          updates.inviteStatus = "accepted";
        }
      }

      updates.updatedAt = firebase.firestore.Timestamp.now();
      await db.collection(usersCol).doc(email).set(updates, { merge: true });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load profile" });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
