// API: Verifies activation token, marks user accepted, and issues JWT session cookie.
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import Cookies from "cookies";
import bcrypt from "bcryptjs";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import jwt from "jsonwebtoken";

async function compareToken(token: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(token, hash);
  } catch {
    return false;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { token, email } = req.body as { token?: string; email?: string };
  if (!token || !email) return res.status(400).json({ error: "Missing token or email" });

  const usersCol = getUsersCollectionName();
  const userDocRef = db.collection(usersCol).doc(email.toLowerCase());

  try {
    const doc = await firestoreGet(userDocRef, "get user for verify", email);
    if (!doc.exists) return res.status(404).json({ error: "User not found" });
    const data = doc.data() as any;
    if (data?.inviteStatus !== "pending") return res.status(400).json({ error: "Invalid status" });
    const now = Date.now();
    const exp = (data?.inviteExpiresAt?.toMillis?.() ?? 0) as number;
    if (!exp || now > exp) return res.status(400).json({ error: "Link expired" });

    const valid = await compareToken(token, data?.inviteTokenHash || "");
    if (!data?.inviteTokenHash || !valid) {
      return res.status(400).json({ error: "Invalid token" });
    }

    // Mark accepted and set verifiedAt
    await firestoreSet(
      userDocRef,
      {
        inviteStatus: "accepted",
        verifiedAt: firebase.firestore.Timestamp.now(),
        updatedAt: firebase.firestore.Timestamp.now(),
      },
      "merge",
      "verify user"
    );

    // Issue JWT for authenticated sessions using SECURE_TOKEN
    const jwtSecret = process.env.SECURE_TOKEN;
    if (!jwtSecret) return res.status(500).json({ error: "JWT secret missing" });

    const authToken = jwt.sign(
      {
        client: "web",
        email: email.toLowerCase(),
        roles: Array.isArray(data?.roles) ? data.roles : ["user"],
        site: process.env.SITE_ID || "default",
      },
      jwtSecret,
      { expiresIn: "180d" }
    );

    const cookies = new Cookies(req, res);
    cookies.set("auth", authToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      maxAge: 180 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    return res.status(200).json({ message: "ok" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export default withApiMiddleware(handler);
