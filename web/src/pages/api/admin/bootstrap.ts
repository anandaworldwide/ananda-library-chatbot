// API: Environment-gated bootstrap to create/update initial site-scoped superusers from env list.
import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (process.env.ENABLE_ADMIN_BOOTSTRAP !== "true") {
    return res.status(403).json({ error: "Bootstrap disabled" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  const raw = process.env.ADMIN_BOOTSTRAP_SUPERUSERS || "";
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e);
  if (emails.length === 0) return res.status(400).json({ error: "No emails provided" });

  const usersCol = getUsersCollectionName();
  const now = firebase.firestore.Timestamp.now();

  const results: Record<string, string> = {};
  for (const email of emails) {
    const ref = db.collection(usersCol).doc(email);
    const existing = await firestoreGet(ref, "get bootstrap user", email);
    if (!existing.exists) {
      await firestoreSet(
        ref,
        {
          email,
          roles: ["superuser"],
          entitlements: { basic: true },
          inviteStatus: "accepted",
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        "set",
        "bootstrap create"
      );
      results[email] = "created";
    } else {
      const data = existing.data() as any;
      const roles: string[] = Array.isArray(data?.roles) ? data.roles : [];
      if (!roles.includes("superuser")) roles.push("superuser");
      await firestoreSet(
        ref,
        { roles, inviteStatus: "accepted", verifiedAt: now, updatedAt: now },
        "merge",
        "bootstrap update"
      );
      results[email] = "updated";
    }
  }

  // Auto-disable after success to reduce risk
  process.env.ENABLE_ADMIN_BOOTSTRAP = "false";
  return res.status(200).json({ message: "ok", results });
}
