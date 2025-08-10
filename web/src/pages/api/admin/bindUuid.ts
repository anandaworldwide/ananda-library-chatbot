// API: Sudo-gated endpoint to bind the current browser UUID cookie to a user account
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { getSudoCookie } from "@/utils/server/sudoCookieUtils";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";
import Cookies from "cookies";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Sudo gate
  const sudo = getSudoCookie(req, res);
  if (!sudo.sudoCookieValue) return res.status(403).json({ error: "Forbidden" });

  if (!db) return res.status(503).json({ error: "Database not available" });

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Invalid email" });
  }

  const cookies = new Cookies(req, res);
  const uuid = cookies.get("uuid");
  if (!uuid || typeof uuid !== "string" || uuid.length !== 36) {
    return res.status(400).json({ error: "Missing or invalid uuid cookie" });
  }

  try {
    const usersCol = getUsersCollectionName();
    const ref = db.collection(usersCol).doc(email.toLowerCase());
    const existing = await firestoreGet(ref, "get user for bind uuid", email);
    if (!existing.exists) return res.status(404).json({ error: "User not found" });

    const now = firebase.firestore.Timestamp.now();
    await firestoreSet(ref, { uuid, updatedAt: now }, { merge: true }, "bind uuid");

    return res.status(200).json({ message: "ok", uuid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
