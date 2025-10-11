import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { isDevelopment } from "@/utils/env";

interface ComparisonVote {
  userId: string;
  timestamp: Date;
  winner: "A" | "B" | "skip";
  modelAConfig: {
    model: string;
    temperature: number;
    response: string;
  };
  modelBConfig: {
    model: string;
    temperature: number;
    response: string;
  };
  question: string;
  reasons?: {
    moreAccurate: boolean;
    betterWritten: boolean;
    moreHelpful: boolean;
    betterReasoning: boolean;
    betterSourceUse: boolean;
  };
  userComments?: string;
  collection: string;
  mediaTypes: {
    text: boolean;
    audio: boolean;
    youtube: boolean;
  };
  shareConsent?: boolean;
  siteId?: string;
  source?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 votes per minute
    name: "model_comparison_vote",
  });

  if (!isAllowed) {
    return; // Rate limiter already sent the response
  }

  const voteData: ComparisonVote = req.body;

  // Validate required fields
  if (!voteData.userId || !voteData.modelAConfig || !voteData.modelBConfig || !voteData.question) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    const prefix = isDevelopment() ? "dev_" : "prod_";
    const voteRef = db.collection(`${prefix}model_comparison_votes`);

    // Build the data to store, filtering out undefined values
    const dataToStore: any = {
      userId: voteData.userId,
      timestamp: new Date(),
      winner: voteData.winner,
      modelAConfig: voteData.modelAConfig,
      modelBConfig: voteData.modelBConfig,
      question: voteData.question,
      collection: voteData.collection,
      mediaTypes: voteData.mediaTypes,
    };

    // Add optional fields only if they're defined
    if (voteData.reasons) {
      dataToStore.reasons = voteData.reasons;
    }
    if (voteData.userComments) {
      dataToStore.userComments = voteData.userComments;
    }
    if (voteData.shareConsent !== undefined) {
      dataToStore.shareConsent = voteData.shareConsent;
    }
    if (voteData.siteId) {
      dataToStore.siteId = voteData.siteId;
    }
    if (voteData.source) {
      dataToStore.source = voteData.source;
    }

    await voteRef.add(dataToStore);

    res.status(200).json({ message: "Vote recorded successfully" });
  } catch (error) {
    console.error("Error recording vote:", error);
    res.status(500).json({ error: "Failed to record vote" });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
