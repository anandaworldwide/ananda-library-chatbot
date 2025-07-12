import { NextApiRequest, NextApiResponse } from "next";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { setCorsHeaders } from "@/utils/server/corsMiddleware";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { getClientIp } from "@/utils/server/ipUtils";

interface MissingSourcesReport {
  docId: string;
  expectedCount: number;
  actualCount: number;
  timestamp: string;
  userAgent: string;
  type: "missing_sources" | "partial_sources";
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const siteConfig = loadSiteConfigSync();
  if (!siteConfig) {
    res.status(500).json({ error: "Failed to load site configuration" });
    return;
  }

  // Set CORS headers
  setCorsHeaders(req, res, siteConfig);

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Apply rate limiting - correct parameter order: req, res, config, ip
  const clientIp = getClientIp(req);
  const rateLimitResult = await genericRateLimiter(
    req,
    res,
    {
      name: "debug_missing_sources",
      max: 10,
      windowMs: 60 * 1000, // 1 minute
    },
    clientIp
  );

  if (!rateLimitResult) {
    // Rate limit exceeded, genericRateLimiter already sent the response
    return;
  }

  try {
    const report: MissingSourcesReport = req.body;

    // Validate the report structure
    if (!report.docId || typeof report.docId !== "string") {
      res.status(400).json({ error: "Invalid docId" });
      return;
    }

    if (typeof report.expectedCount !== "number" || report.expectedCount < 0) {
      res.status(400).json({ error: "Invalid expectedCount" });
      return;
    }

    if (typeof report.actualCount !== "number" || report.actualCount < 0) {
      res.status(400).json({ error: "Invalid actualCount" });
      return;
    }

    if (!report.type || !["missing_sources", "partial_sources"].includes(report.type)) {
      res.status(400).json({ error: "Invalid type" });
      return;
    }

    // Log the missing sources report for debugging
    const timestamp = new Date().toISOString();
    const logPrefix = report.type === "missing_sources" ? "🚨 MISSING SOURCES BUG" : "⚠️ PARTIAL SOURCES WARNING";

    console.log(`${logPrefix} - Frontend Report Received:`);
    console.log(`  DocId: ${report.docId}`);
    console.log(`  Expected: ${report.expectedCount} sources`);
    console.log(`  Actual: ${report.actualCount} sources`);
    console.log(`  Type: ${report.type}`);
    console.log(`  Client IP: ${clientIp}`);
    console.log(`  User Agent: ${report.userAgent || "unknown"}`);
    console.log(`  Frontend Timestamp: ${report.timestamp}`);
    console.log(`  Backend Timestamp: ${timestamp}`);
    console.log(`  Time Difference: ${new Date(timestamp).getTime() - new Date(report.timestamp).getTime()}ms`);

    // Additional debugging for missing sources
    if (report.type === "missing_sources") {
      console.log(`🔍 SOURCES BUG ANALYSIS:`);
      console.log(`  - Backend logs should show sources being sent via SSE`);
      console.log(`  - Frontend logs should show sources being received but not processed`);
      console.log(`  - This indicates a timing/race condition in the SSE stream`);
      console.log(`  - Check if sources SSE message arrived after 'done' message`);
    }

    // Log structured data for potential analysis
    const structuredLog = {
      event: "frontend_sources_report",
      type: report.type,
      docId: report.docId,
      expectedCount: report.expectedCount,
      actualCount: report.actualCount,
      clientIp,
      userAgent: report.userAgent,
      frontendTimestamp: report.timestamp,
      backendTimestamp: timestamp,
      timeDifference: new Date(timestamp).getTime() - new Date(report.timestamp).getTime(),
    };

    console.log(`📊 STRUCTURED LOG:`, JSON.stringify(structuredLog));

    res.status(200).json({
      success: true,
      message: "Missing sources report received and logged",
      timestamp,
    });
  } catch (error) {
    console.error("Error processing missing sources report:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export default withJwtAuth(handler);
