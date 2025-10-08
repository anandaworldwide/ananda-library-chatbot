// API: Check if user has password set (for login UI flow)
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet } from "@/utils/server/firestoreRetryUtils";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Check if password feature is enabled (only for sites with requireLogin)
  const siteConfig = loadSiteConfigSync();
  if (!siteConfig?.requireLogin) {
    return res.status(200).json({ hasPassword: false });
  }

  // Rate limit: 30 requests per minute per IP
  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 1000, max: 30, name: "check-auth-method" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());

  try {
    const doc = await firestoreGet(userDocRef, "check auth method", email);

    if (!doc.exists) {
      // User not found - return false
      return res.status(200).json({ hasPassword: false });
    }

    const data = doc.data() as any;

    // Only return true if user is activated and has password
    const hasPassword = !!(data?.inviteStatus === "accepted" && data?.passwordHash);

    return res.status(200).json({ hasPassword });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
