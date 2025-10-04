import { NextApiRequest, NextApiResponse } from "next";
import { s3Client } from "@/utils/server/awsConfig";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getFromCache, setInCache } from "@/utils/server/redisUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { isDevelopment } from "@/utils/env";

interface AdminApprover {
  name: string;
  email: string;
  location: string;
}

interface Region {
  name: string;
  admins: AdminApprover[];
}

interface AdminApproversData {
  lastUpdated: string;
  regions: Region[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Apply rate limiting
  const allowed = await genericRateLimiter(req, res, {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    name: "admin_approvers",
  });
  if (!allowed) return;

  try {
    // Load site configuration
    const siteConfig = await loadSiteConfig();
    if (!siteConfig?.siteId) {
      return res.status(500).json({ error: "Site configuration not available" });
    }

    const siteId = siteConfig.siteId;
    const cacheKey = `admin_approvers_${siteId}`;

    // Try to get from cache first (5-minute TTL)
    const cachedData = await getFromCache<AdminApproversData>(cacheKey);
    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    // Fetch from S3
    const bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME || "ananda-chatbot";

    // Use dev- prefix for development environments
    const envPrefix = isDevelopment() ? "dev-" : "";
    const key = `site-config/admin-approvers/${envPrefix}${siteId}-admin-approvers.json`;

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return res.status(404).json({ error: "Admin approvers configuration not found" });
    }

    // Read the stream
    const streamToString = (stream: any): Promise<string> => {
      return new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
    };

    const bodyContents = await streamToString(response.Body);
    const approversData: AdminApproversData = JSON.parse(bodyContents);

    // Validate the data structure
    if (!approversData.regions || !Array.isArray(approversData.regions)) {
      return res.status(500).json({ error: "Invalid admin approvers data structure" });
    }

    // Cache the result for 5 minutes (300 seconds)
    await setInCache(cacheKey, approversData, 300);

    return res.status(200).json(approversData);
  } catch (error: any) {
    // Handle specific S3 errors
    if (error.name === "NoSuchKey" || error.name === "NoSuchBucket") {
      // Log as warning since this is expected fallback behavior
      console.warn("No admin approvers configuration found, using fallback Support admin");

      // Return fallback admin approver using CONTACT_EMAIL
      const contactEmail = process.env.CONTACT_EMAIL;
      if (!contactEmail) {
        return res
          .status(404)
          .json({ error: "Admin approvers configuration not found for this site and CONTACT_EMAIL not configured" });
      }

      console.error("Error fetching admin approvers:", error);

      const fallbackData: AdminApproversData = {
        lastUpdated: new Date().toISOString(),
        regions: [
          {
            name: "General",
            admins: [
              {
                name: "Support",
                email: contactEmail,
                location: "Global Support Team",
              },
            ],
          },
        ],
      };

      return res.status(200).json(fallbackData);
    }

    if (error.name === "AccessDenied" || error.name === "Forbidden") {
      return res.status(403).json({ error: "Access denied to admin approvers configuration" });
    }

    return res.status(500).json({ error: "Internal server error" });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
