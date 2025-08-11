// Lists active users for the current site for admin UI
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!db) return res.status(503).json({ error: "Database not available" });

  const usersCol = getUsersCollectionName();

  try {
    const snapshot = await db.collection(usersCol).where("inviteStatus", "==", "accepted").limit(200).get();
    const items = snapshot.docs.map((d: any) => {
      const data = d.data() || {};
      return {
        email: data.email,
        uuid: data.uuid || null,
        roles: data.roles || [],
        verifiedAt: data.verifiedAt?.toDate?.() ?? null,
        lastLoginAt: data.lastLoginAt?.toDate?.() ?? null,
        entitlements: data.entitlements || {},
      };
    });
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to list active users" });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
