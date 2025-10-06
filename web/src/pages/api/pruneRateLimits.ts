import { db } from "@/services/firebase";
import type { NextApiRequest, NextApiResponse } from "next";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { isDevelopment } from "@/utils/env";

const PRUNE_OLDER_THAN_DAYS = 90;
const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  const now = Date.now();
  const cutoffTime = now - PRUNE_OLDER_THAN_DAYS * MS_IN_A_DAY;

  const collectionPrefix = isDevelopment() ? "dev" : "prod";
  const rateLimitsRef = db.collection(`${collectionPrefix}_rateLimits`);
  const oldRateLimitsQuery = rateLimitsRef.where("firstRequestTime", "<", cutoffTime);

  const oldRateLimitsSnapshot = await oldRateLimitsQuery.get();
  const batch = db.batch();

  oldRateLimitsSnapshot.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  res.status(200).json({
    message: `Pruned ${oldRateLimitsSnapshot.size} old rate limit entries from ${collectionPrefix}_rateLimits.`,
  });
}

export default withApiMiddleware(handler);
