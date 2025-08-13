import type { NextApiRequest, NextApiResponse } from "next";
import firebase from "firebase-admin";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth, getTokenFromRequest, verifyToken } from "@/utils/server/jwtUtils";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!db) return res.status(503).json({ error: "Database not available" });

  const { userId } = req.query as { userId: string };
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const usersCol = getUsersCollectionName();
  const dbNonNull = db as NonNullable<typeof db>;
  const currentId = userId.toLowerCase();

  // Resolve the requester role, preferring live Firestore role for the cookie's email
  async function resolveRequesterRole(): Promise<string> {
    try {
      const cookieJwt = req.cookies?.["auth"];
      if (cookieJwt) {
        const payload: any = verifyToken(cookieJwt);
        const jwtRole = typeof payload?.role === "string" ? payload.role : "user";
        const email = typeof payload?.email === "string" ? payload.email.toLowerCase() : undefined;
        if (email) {
          try {
            const snap = await dbNonNull.collection(usersCol).doc(email).get();
            const liveRole =
              snap.exists && typeof (snap.data() as any)?.role === "string" ? (snap.data() as any).role : undefined;
            return typeof liveRole === "string" ? liveRole : jwtRole;
          } catch {
            return jwtRole;
          }
        }
        return jwtRole;
      }
      // Fallback to Authorization header payload
      const headerPayload: any = getTokenFromRequest(req);
      return typeof headerPayload?.role === "string" ? headerPayload.role : "user";
    } catch {
      return "user";
    }
  }

  if (req.method === "GET") {
    try {
      // Authorization: only admin/superuser may view
      const requesterRole = await resolveRequesterRole();
      if (requesterRole !== "admin" && requesterRole !== "superuser") {
        return res.status(403).json({ error: "Forbidden" });
      }
      const doc = await db.collection(usersCol).doc(currentId).get();
      if (!doc.exists) return res.status(404).json({ error: "User not found" });
      const data = doc.data() || {};
      return res.status(200).json({
        user: {
          id: currentId,
          email: data.email || currentId,
          uuid: data.uuid || null,
          role: data.role || "user",
          inviteStatus: data.inviteStatus || null,
          verifiedAt: data.verifiedAt?.toDate?.() ?? null,
          lastLoginAt: data.lastLoginAt?.toDate?.() ?? null,
          entitlements: data.entitlements || {},
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to fetch user" });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = (req.body || {}) as { email?: string; role?: string };
      const updates: Record<string, any> = {};
      const now = firebase.firestore.Timestamp.now();
      const siteConfig = loadSiteConfigSync();
      const requesterRole = await resolveRequesterRole();

      // Validate role if provided (only superuser can change role)
      if (body.role !== undefined) {
        const allowed = ["user", "admin", "superuser"];
        if (typeof body.role !== "string" || !allowed.includes(body.role)) {
          return res.status(400).json({ error: "Invalid role" });
        }
        if (requesterRole !== "superuser") {
          return res.status(403).json({ error: "Only superuser may change role" });
        }
        updates.role = body.role;
      }

      // If only role update (no email change)
      if (!body.email || body.email.toLowerCase() === currentId) {
        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: "No updates provided" });
        }
        updates.updatedAt = now;
        await db.collection(usersCol).doc(currentId).set(updates, { merge: true });
        const updated = await db.collection(usersCol).doc(currentId).get();
        const data = updated.data() || {};
        return res.status(200).json({
          user: {
            id: currentId,
            email: data.email || currentId,
            uuid: data.uuid || null,
            role: data.role || "user",
            inviteStatus: data.inviteStatus || null,
            verifiedAt: data.verifiedAt?.toDate?.() ?? null,
            lastLoginAt: data.lastLoginAt?.toDate?.() ?? null,
            entitlements: data.entitlements || {},
          },
        });
      }

      // Email change flow (may include role update too)
      const newEmail = body.email.toLowerCase();
      const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      await (db as NonNullable<typeof db>).runTransaction(async (tx) => {
        const currentRef = (db as NonNullable<typeof db>).collection(usersCol).doc(currentId);
        const newRef = (db as NonNullable<typeof db>).collection(usersCol).doc(newEmail);

        const [currentSnap, newSnap] = await Promise.all([tx.get(currentRef), tx.get(newRef)]);
        if (!currentSnap.exists) throw new Error("User not found");
        if (newSnap.exists) throw new Error("Email already in use");

        const data = currentSnap.data() || {};
        const newData = {
          ...data,
          email: newEmail,
          ...(updates.role ? { role: updates.role } : {}),
          updatedAt: now,
        };

        tx.set(newRef, newData, { merge: true });
        tx.delete(currentRef);
      });

      const finalDoc = await (db as NonNullable<typeof db>).collection(usersCol).doc(newEmail).get();
      const out = finalDoc.data() || {};
      // Attempt to notify both addresses about the change (suppressed during tests)
      if (process.env.NODE_ENV !== "test" && process.env.JEST_WORKER_ID === undefined) {
        try {
          const ses = new SESClient({
            region: process.env.AWS_REGION || "us-west-2",
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
            },
          });
          const brand = siteConfig?.name || siteConfig?.shortname || process.env.SITE_ID || "Ananda Library";
          const subject = `Your ${brand} account email was updated`;
          const text = `Your account email was changed from ${currentId} to ${newEmail}. If you did not request this change, please contact support immediately.`;
          const source = process.env.CONTACT_EMAIL || "noreply@ananda.org";
          const cmds = [currentId, newEmail].map(
            (addr) =>
              new SendEmailCommand({
                Source: source,
                Destination: { ToAddresses: [addr] },
                Message: { Subject: { Data: subject }, Body: { Text: { Data: text } } },
              })
          );
          for (const cmd of cmds) {
            await ses.send(cmd);
          }
        } catch (e) {
          // Non-fatal: logging only
          console.warn("Email change notification failed:", e);
        }
      }
      return res.status(200).json({
        user: {
          id: newEmail,
          email: out.email || newEmail,
          uuid: out.uuid || null,
          role: out.role || "user",
          inviteStatus: out.inviteStatus || null,
          verifiedAt: out.verifiedAt?.toDate?.() ?? null,
          lastLoginAt: out.lastLoginAt?.toDate?.() ?? null,
          entitlements: out.entitlements || {},
        },
      });
    } catch (err: any) {
      const msg = err?.message || "Failed to update user";
      const status = msg.includes("not found") ? 404 : msg.includes("already in use") ? 409 : 500;
      return res.status(status).json({ error: msg });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default withApiMiddleware(withJwtAuth(handler));
