// API: Returns current user's profile info (email, uuid, role) based on auth JWT cookie
import type { NextApiRequest, NextApiResponse } from "next";
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

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
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
    const doc = await firestoreGet(ref, "get profile user", email);
    if (!doc.exists) return res.status(404).json({ error: "User not found" });

    const data = doc.data() as any;
    const roleFromDb = typeof data?.role === "string" ? data.role : undefined;
    const roleFromToken = typeof payload?.role === "string" ? payload.role : undefined;
    const role = roleFromDb || roleFromToken || "user";
    return res.status(200).json({ email, uuid: data?.uuid || null, role });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to load profile" });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
