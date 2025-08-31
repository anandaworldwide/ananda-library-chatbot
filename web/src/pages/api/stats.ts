import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import NodeCache from "node-cache";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";

const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 requests per 5 minutes
    name: "stats-api",
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cachedStats = cache.get("stats");
  if (cachedStats) {
    return res.status(200).json(cachedStats);
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    ninetyDaysAgo.setHours(0, 0, 0, 0); // Set to start of the day
    ninetyDaysAgo.setTime(ninetyDaysAgo.getTime() - ninetyDaysAgo.getTimezoneOffset() * 60000); // Adjust to Pacific Time

    const chatLogsRef = db.collection(getAnswersCollectionName());
    const chatLogsSnapshot = await chatLogsRef.where("timestamp", ">=", ninetyDaysAgo).get();

    const stats = {
      questionsPerDay: {} as Record<string, number>,
      totalQuestions: 0,
    };

    // Initialize stats for the last 90 days
    for (let i = 0; i < 90; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      date.setTime(date.getTime() - date.getTimezoneOffset() * 60000); // Adjust to Pacific Time
      const dateString = date.toISOString().split("T")[0];
      stats.questionsPerDay[dateString] = 0;
    }

    chatLogsSnapshot.forEach((doc) => {
      const data = doc.data();
      const date = new Date(data.timestamp._seconds * 1000);
      date.setTime(date.getTime() - date.getTimezoneOffset() * 60000); // Adjust to Pacific Time
      const dateString = date.toISOString().split("T")[0];

      stats.totalQuestions++;
      stats.questionsPerDay[dateString] = (stats.questionsPerDay[dateString] || 0) + 1;
    });

    cache.set("stats", stats);
    res.status(200).json(stats);
  } catch (error) {
    console.error("Error in stats handler:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Something went wrong",
    });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
