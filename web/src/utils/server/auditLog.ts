import type { NextApiRequest } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { isDevelopment } from "@/utils/env";

export interface AuditEntry {
  action: string;
  target?: string;
  requester?: { email?: string | null; role?: string | null };
  details?: Record<string, any>;
  createdAt: firebase.firestore.Timestamp;
}

export async function writeAuditLog(
  req: NextApiRequest,
  action: string,
  target?: string,
  details?: Record<string, any>
) {
  if (!db) return;
  try {
    const email = typeof req.body?.requesterEmail === "string" ? req.body.requesterEmail : undefined;
    const role = typeof req.body?.requesterRole === "string" ? req.body.requesterRole : undefined;
    const entry: AuditEntry = {
      action,
      target,
      requester: { email: email || null, role: role || null },
      details,
      createdAt: firebase.firestore.Timestamp.now(),
    };
    const prefix = isDevelopment() ? "dev_" : "prod_";
    await db.collection(`${prefix}admin_audit`).add(entry as any);
  } catch {
    // best-effort only
  }
}
