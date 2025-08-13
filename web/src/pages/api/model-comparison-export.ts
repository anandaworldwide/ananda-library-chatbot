// This file handles API requests for exporting model comparison vote data.
// It provides data export in JSON or CSV format with optional date filtering.

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { isDevelopment } from "@/utils/env";
import { getSudoCookie } from "@/utils/server/sudoCookieUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { requireAdminRole } from "@/utils/server/authz";

interface ExportOptions {
  format?: "csv" | "json";
  startDate?: string;
  endDate?: string;
}

interface VoteData {
  id: string;
  timestamp: FirebaseFirestore.Timestamp;
  winner: "A" | "B" | "skip";
  modelAConfig: {
    model: string;
    temperature: number;
  };
  modelBConfig: {
    model: string;
    temperature: number;
  };
  question: string;
  reasons: {
    moreAccurate: boolean;
    betterWritten: boolean;
    moreHelpful: boolean;
    betterReasoning: boolean;
    betterSourceUse: boolean;
  };
  userComments?: string;
  collection: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 requests per 5 minutes
    name: "model-comparison-export-api",
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Authorization by site type
  const siteConfig = loadSiteConfigSync();
  const loginRequired = !!siteConfig?.requireLogin;
  if (loginRequired) {
    if (!requireAdminRole(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  } else {
    const sudoStatus = getSudoCookie(req, res);
    if (!sudoStatus.sudoCookieValue) {
      return res.status(403).json({ error: "Unauthorized: Sudo access required" });
    }
  }

  // Check if db is available
  if (!db) {
    return res.status(503).json({ error: "Database not available" });
  }

  const { format = "json", startDate, endDate } = req.query as unknown as ExportOptions;

  try {
    const prefix = isDevelopment() ? "dev_" : "prod_";
    const collectionRef = db.collection(`${prefix}model_comparison_votes`);
    let query: FirebaseFirestore.Query = collectionRef;

    // Add date filters if provided
    if (startDate) {
      query = query.where("timestamp", ">=", new Date(startDate));
    }
    if (endDate) {
      query = query.where("timestamp", "<=", new Date(endDate));
    }

    const snapshot = await query.get();
    const votes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as VoteData[];

    if (format === "csv") {
      const csvHeaders = [
        "id",
        "timestamp",
        "winner",
        "modelA",
        "temperatureA",
        "modelB",
        "temperatureB",
        "question",
        "moreAccurate",
        "betterWritten",
        "moreHelpful",
        "betterReasoning",
        "betterSourceUse",
        "userComments",
        "collection",
      ].join(",");

      const csvRows = votes.map((vote) =>
        [
          vote.id,
          vote.timestamp.toDate().toISOString(),
          vote.winner,
          vote.modelAConfig.model,
          vote.modelAConfig.temperature,
          vote.modelBConfig.model,
          vote.modelBConfig.temperature,
          `"${vote.question.replace(/"/g, '""')}"`,
          vote.reasons.moreAccurate || false,
          vote.reasons.betterWritten || false,
          vote.reasons.moreHelpful || false,
          vote.reasons.betterReasoning || false,
          vote.reasons.betterSourceUse || false,
          `"${(vote.userComments || "").replace(/"/g, '""')}"`,
          vote.collection,
        ].join(",")
      );

      const csv = [csvHeaders, ...csvRows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=model-comparison-votes-${new Date().toISOString().split("T")[0]}.csv`
      );
      return res.status(200).send(csv);
    }

    // Default JSON response
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=model-comparison-votes-${new Date().toISOString().split("T")[0]}.json`
    );
    return res.status(200).json(votes);
  } catch (error) {
    console.error("Error exporting votes:", error);
    return res.status(500).json({ error: "Failed to export votes" });
  }
}

export default withApiMiddleware(withJwtAuth(handler));
