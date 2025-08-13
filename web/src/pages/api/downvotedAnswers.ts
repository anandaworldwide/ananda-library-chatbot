// This file handles API requests for fetching downvoted answers.
// It is used by the admin interface to review and manage answers that have been downvoted by users.

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { requireSuperuserRole } from "@/utils/server/authz";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 40, // 40 requests per 5 minutes
    name: "downvoted-answers-api",
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireSuperuserRole(req)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20; // Fixed limit of 20 items per page
    const offset = (page - 1) * limit;

    const answersRef = db.collection(getAnswersCollectionName());

    // Get total count of downvoted answers
    const countQuery = await answersRef.where("vote", "==", -1).count().get();
    const total = countQuery.data().count;
    const totalPages = Math.ceil(total / limit);

    // Get paginated downvoted answers
    const downvotedAnswersSnapshot = await answersRef
      .where("vote", "==", -1)
      .orderBy("timestamp", "desc")
      .offset(offset)
      .limit(limit)
      .get();

    const downvotedAnswers = downvotedAnswersSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        question: data.question || "",
        answer: data.answer || "",
        vote: data.vote || 0,
        timestamp: data.timestamp?.toDate?.() || null,
        collection: data.collection,
        adminAction: data.adminAction,
        adminActionTimestamp: data.adminActionTimestamp,
        sources: data.sources || [],
        feedbackReason: data.feedbackReason || "",
        feedbackComment: data.feedbackComment || "",
      };
    });

    return res.status(200).json({
      answers: downvotedAnswers,
      totalPages,
      currentPage: page,
    });
  } catch (error) {
    console.error("Error fetching downvoted answers:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Something went wrong",
    });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
