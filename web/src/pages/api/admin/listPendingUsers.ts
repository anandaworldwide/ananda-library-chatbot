// Lists pending users for the current site for admin UI
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth, verifyToken } from "@/utils/server/jwtUtils";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { requireAdminRole } from "@/utils/server/authz";
import { firestoreGet } from "@/utils/server/firestoreRetryUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  // Authorization: admin or superuser only (fallback to live Firestore role if JWT role missing)
  let isAllowed = requireAdminRole(req);
  if (!isAllowed) {
    try {
      const cookieJwt = req.cookies?.["auth"];
      if (cookieJwt && db) {
        const payload: any = verifyToken(cookieJwt);
        const email = typeof payload?.email === "string" ? payload.email.toLowerCase() : undefined;
        if (email) {
          const snap = await firestoreGet(db.collection(getUsersCollectionName()).doc(email), "authz: get user", email);
          const liveRole = snap.exists ? ((snap.data() as any)?.role as string | undefined) : undefined;
          isAllowed = liveRole === "admin" || liveRole === "superuser";
        }
      }
    } catch {
      // fall through
    }
  }
  if (!isAllowed) return res.status(403).json({ error: "Forbidden" });

  const usersCol = getUsersCollectionName();

  try {
    const snapshot = await db.collection(usersCol).where("inviteStatus", "==", "pending").limit(200).get();
    const items = snapshot.docs.map((d: any) => {
      const data = d.data() || {};
      return {
        email: data.email,
        invitedAt: data.createdAt?.toDate?.() ?? null,
        expiresAt: data.inviteExpiresAt?.toDate?.() ?? null,
      };
    });
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to list pending users" });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
