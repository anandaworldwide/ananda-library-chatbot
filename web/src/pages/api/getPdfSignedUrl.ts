import { NextApiRequest, NextApiResponse } from "next";
import { getS3PdfSignedUrl } from "@/utils/server/getS3PdfSignedUrl";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // Apply rate limiting
    const rateLimitPassed = await genericRateLimiter(req, res, {
      windowMs: 60 * 1000, // 1 minute
      max: 10, // 10 requests per minute
      name: "pdf_download",
    });

    if (!rateLimitPassed) {
      return; // Rate limit response already sent
    }

    // Extract PDF S3 key from request body
    const { pdfS3Key } = req.body;

    if (!pdfS3Key || typeof pdfS3Key !== "string") {
      return res.status(400).json({ message: "Invalid PDF S3 key" });
    }

    // Generate signed URL
    const signedUrl = await getS3PdfSignedUrl(pdfS3Key);

    return res.status(200).json({ signedUrl });
  } catch (error) {
    console.error("Error generating PDF signed URL:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
