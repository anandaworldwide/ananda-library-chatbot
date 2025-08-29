// This file handles API requests to check if NPS survey is available.
// It checks if the required environment variables are configured.

import type { NextApiRequest, NextApiResponse } from "next";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import { withPagesCors } from "@/utils/server/pagesCorsUtils";

// Handler function to check NPS survey availability
async function handleRequest(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method Not Allowed" });
    return;
  }

  // Check if required environment variables are set
  const hasGoogleCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasSheetId = !!process.env.NPS_SURVEY_GOOGLE_SHEET_ID;

  if (!hasGoogleCredentials || !hasSheetId) {
    // Log the configuration issue on the server side
    console.error("NPS Survey configuration missing:", {
      hasGoogleCredentials,
      hasSheetId,
      timestamp: new Date().toISOString(),
    });
  }

  const isAvailable = hasGoogleCredentials && hasSheetId;

  res.status(200).json({
    available: isAvailable,
    message: isAvailable ? "NPS survey is available" : "NPS survey is not configured",
  });
}

// Export wrapped with CORS and Middleware (no auth required for availability check)
export default withApiMiddleware(withPagesCors(handleRequest), { skipAuth: true });
