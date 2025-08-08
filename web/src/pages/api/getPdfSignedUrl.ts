import { NextApiRequest, NextApiResponse } from "next";
import { getS3PdfSignedUrl } from "@/utils/server/getS3PdfSignedUrl";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { withJwtOnlyAuth } from "@/utils/server/apiMiddleware";
import { db } from "@/services/firebase";
import firebase from "firebase-admin";
import { s3Client } from "@/utils/server/awsConfig";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // Apply rate limiting: stricter than audio (5/min)
    const rateLimitPassed = await genericRateLimiter(req, res, {
      windowMs: 60 * 1000, // 1 minute
      max: 5, // 5 requests per minute
      name: "pdf_download",
    });
    // Additional hourly cap: 20 requests per hour
    const hourlyLimitPassed = await genericRateLimiter(req, res, {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 20, // 20 requests per hour
      name: "pdf_download_hourly",
    });

    if (!hourlyLimitPassed) {
      return; // Rate limit response already sent
    }

    if (!rateLimitPassed) {
      return; // Rate limit response already sent
    }

    // Extract PDF S3 key and frontend UUID from request body
    const { pdfS3Key, uuid } = req.body;

    if (!pdfS3Key || typeof pdfS3Key !== "string") {
      return res.status(400).json({ message: "Invalid PDF S3 key" });
    }

    // Require a valid UUID from the frontend (cookie/localStorage propagated to request)
    if (!uuid || typeof uuid !== "string" || uuid.length !== 36) {
      return res.status(400).json({ message: "Invalid or missing UUID" });
    }

    // Security validation: Ensure the key appears to be a PDF file
    if (!pdfS3Key.toLowerCase().endsWith(".pdf")) {
      console.warn(`Rejected non-PDF file request: ${pdfS3Key}`);
      return res.status(400).json({ message: "Invalid file type - PDFs only" });
    }

    // Additional security: Verify the file exists and is actually a PDF in S3
    const bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME || "ananda-chatbot";

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: pdfS3Key,
      });
      const headResponse = await s3Client.send(headCommand);

      // Verify content type is PDF or binary/octet-stream (common for older uploads)
      if (headResponse.ContentType) {
        const isValidPdfType = headResponse.ContentType.includes("pdf");
        const isBinaryOctetStream =
          headResponse.ContentType.includes("binary/octet-stream") ||
          headResponse.ContentType.includes("application/octet-stream");

        if (!isValidPdfType && !isBinaryOctetStream) {
          console.warn(`File content-type validation failed: ${pdfS3Key} has type ${headResponse.ContentType}`);
          return res.status(400).json({
            message: "File is not a PDF document",
            actualType: headResponse.ContentType,
          });
        }
      }
    } catch (s3Error: any) {
      // Handle S3 errors (file not found, access denied, etc.)
      if (s3Error.name === "NoSuchKey" || s3Error.name === "NotFound") {
        console.warn(`PDF file not found: ${pdfS3Key}`);
        return res.status(404).json({ message: "PDF file not found" });
      } else if (s3Error.name === "Forbidden" || s3Error.name === "AccessDenied") {
        console.warn(`Access denied to PDF file: ${pdfS3Key}`);
        return res.status(403).json({ message: "Access denied to PDF file" });
      } else {
        console.error(`S3 verification error for ${pdfS3Key}:`, s3Error);
        return res.status(500).json({ message: "Unable to verify PDF file" });
      }
    }

    // Generate signed URL only after all security checks pass
    const signedUrl = await getS3PdfSignedUrl(pdfS3Key);

    // Fire-and-forget: log the download event to Firestore (if db is initialized)
    try {
      if (db) {
        const envPrefix = process.env.NODE_ENV === "development" ? "dev" : "prod";
        await db.collection(`${envPrefix}_pdf_downloads`).add({
          uuid,
          pdfKey: pdfS3Key,
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          // If we later include user id/claims in JWT, we can store it here
          // userId: decodedToken.userId,
          ip: req.socket.remoteAddress || null,
          userAgent: req.headers["user-agent"] || null,
        });
      }
    } catch (logErr) {
      console.warn("PDF download logging failed:", logErr);
    }

    return res.status(200).json({ signedUrl });
  } catch (error) {
    console.error("Error generating PDF signed URL:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export default withJwtOnlyAuth(handler);
