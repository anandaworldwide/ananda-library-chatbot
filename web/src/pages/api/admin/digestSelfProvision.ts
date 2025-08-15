// API: Daily digest of self-provision attempts. Intended for Vercel Cron (once per day).
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/services/firebase";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withJwtAuth } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { sendOpsAlert } from "@/utils/server/emailOps";

/**
 * Middleware that allows either JWT authentication or Vercel cron requests
 * @param handler The API route handler to wrap
 * @returns A wrapped handler that checks for either valid JWT or Vercel cron
 */
function withJwtOrCronAuth(handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const userAgent = req.headers["user-agent"] || "";
    const isVercelCron = userAgent.startsWith("vercel-cron/");
    const authHeader = req.headers.authorization || "";

    if (isVercelCron) {
      // Verify that cron requests provide the correct secret
      if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      // Allow authorized Vercel cron requests through
      return handler(req, res);
    } else {
      // For all other requests, require JWT authentication
      return withJwtAuth(handler)(req, res);
    }
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Light rate limit to avoid accidental rapid calls
  const allowed = await genericRateLimiter(req, res, { windowMs: 60 * 1000, max: 3, name: "digest-self-provision" });
  if (!allowed) return;

  if (!db) return res.status(503).json({ error: "Database not available" });

  try {
    const now = new Date();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const siteId = process.env.SITE_ID || "default";
    const collection = process.env.NODE_ENV === "production" ? "prod_admin_audit" : "dev_admin_audit";

    // Fetch last 24h self_provision_attempt entries
    const snap = await db
      .collection(collection)
      .where("action", "==", "self_provision_attempt")
      .where("createdAt", ">=", since)
      .get();

    let created = 0;
    let resent = 0;
    let invalid = 0;
    let errors = 0;
    const samples: Array<{ target?: string; outcome?: string }> = [];

    snap.forEach((doc) => {
      const data = doc.data() as any;
      const outcome = data?.details?.outcome as string | undefined;
      if (outcome === "created_pending_user") created++;
      else if (outcome === "resent_pending_activation") resent++;
      else if (outcome === "invalid_password") invalid++;
      else if (outcome === "server_error") errors++;
      if (samples.length < 10) samples.push({ target: data?.target, outcome });
    });

    const body = [
      `Self-provision digest for site ${siteId} (last 24h)`,
      `Created: ${created}`,
      `Resent: ${resent}`,
      `Invalid password: ${invalid}`,
      `Server errors: ${errors}`,
      `Samples: ${JSON.stringify(samples, null, 2)}`,
    ].join("\n");

    await sendOpsAlert("Self-provision daily digest", body);
    return res.status(200).json({ ok: true, counts: { created, resent, invalid, errors }, samples });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to build digest" });
  }
}

// Apply API middleware, skipping its default auth check and relying solely on withJwtOrCronAuth
export default withApiMiddleware(withJwtOrCronAuth(handler), {
  skipAuth: true,
});
