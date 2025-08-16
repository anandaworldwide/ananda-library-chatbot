import type { NextApiRequest } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { isDevelopment } from "@/utils/env";

export interface AuditEntry {
  action: string;
  target?: string;
  requester?: { email?: string | null; role?: string | null };
  details?: Record<string, any>;
  ip?: string | null;
  requestId?: string | null;
  createdAt: firebase.firestore.Timestamp;
  expireAt: firebase.firestore.Timestamp;
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

    // Extract IP address from request headers
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;

    // Extract request ID from headers
    const requestId = (req.headers["x-request-id"] as string) ?? null;

    // Calculate expiration date (1 year from now)
    const now = new Date();
    const expireDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

    const entry: AuditEntry = {
      action,
      target,
      requester: { email: email || null, role: role || null },
      details,
      ip,
      requestId,
      createdAt: firebase.firestore.Timestamp.now(),
      expireAt: firebase.firestore.Timestamp.fromDate(expireDate),
    };
    const prefix = isDevelopment() ? "dev_" : "prod_";
    await db.collection(`${prefix}admin_audit`).add(entry as any);
  } catch {
    // best-effort only
  }
}
