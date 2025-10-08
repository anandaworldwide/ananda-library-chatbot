// API: Set initial password for authenticated user (requires JWT Bearer token)
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import { validatePasswordStrength, hashPassword } from "@/utils/server/passwordUtils";
import { verifyToken } from "@/utils/server/jwtUtils";
import { writeAuditLog } from "@/utils/server/auditLog";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Check if password feature is enabled (only for sites with requireLogin)
  const siteConfig = loadSiteConfigSync();
  if (!siteConfig?.requireLogin) {
    return res.status(403).json({ error: "Password authentication not available for this site" });
  }

  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 60 * 1000, max: 10, name: "set-password" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  try {
    // Authentication - require valid JWT Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }

    const token = authHeader.substring(7);
    let payload: any;
    try {
      payload = verifyToken(token);
      if (!payload || token.includes("placeholder")) {
        throw new Error("Invalid token");
      }
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const email = typeof payload?.email === "string" ? payload.email.toLowerCase() : null;
    if (!email) return res.status(400).json({ error: "Malformed token" });

    const { password } = req.body as { password?: string };
    if (!password || typeof password !== "string") {
      return res.status(400).json({ error: "Password is required" });
    }

    // Validate password strength
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message, requirements: validation.requirements });
    }

    const usersCol = getUsersCollectionName();
    const userDocRef = db.collection(usersCol).doc(email);

    // Verify user exists
    const doc = await firestoreGet(userDocRef, "set password", email);
    if (!doc.exists) return res.status(404).json({ error: "User not found" });

    const userData = doc.data() as any;
    if (userData?.inviteStatus !== "accepted") {
      return res.status(400).json({ error: "Account not activated" });
    }

    // Hash password and store
    const passwordHash = await hashPassword(password);
    const now = firebase.firestore.Timestamp.now();

    await firestoreSet(
      userDocRef,
      {
        passwordHash,
        passwordSetAt: now,
        updatedAt: now,
      },
      { merge: true },
      "set password"
    );

    // Audit log password set action (never log the actual password)
    await writeAuditLog(req, "user_password_set", email, {
      outcome: "success",
    });

    return res.status(200).json({ message: "Password set successfully" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
