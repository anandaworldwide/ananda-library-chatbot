import { NextApiRequest, NextApiResponse } from "next";
import { getS3PdfSignedUrl } from "@/utils/server/getS3PdfSignedUrl";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { s3Client } from "@/utils/server/awsConfig";
import { HeadObjectCommand } from "@aws-sdk/client-s3";

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

    return res.status(200).json({ signedUrl });
  } catch (error) {
    console.error("Error generating PDF signed URL:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
