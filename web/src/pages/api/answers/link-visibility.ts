import { NextApiRequest, NextApiResponse } from "next";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { shouldShowAnswersPageLink } from "@/utils/server/answersPageAuth";

/**
 * API endpoint to check if the discrete answers page link should be shown.
 * This is used by the client-side AnswersPageLink component.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const siteConfig = loadSiteConfigSync(process.env.SITE_ID || "default");
    const shouldShow = await shouldShowAnswersPageLink(req, res, siteConfig);

    return res.status(200).json({ shouldShow });
  } catch (error) {
    console.error("Error checking answers page link visibility:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
