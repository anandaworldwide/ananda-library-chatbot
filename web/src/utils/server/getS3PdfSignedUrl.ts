import { s3Client } from "./awsConfig";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Generates a signed URL for PDF download from S3
 * @param pdfS3Key - The S3 key for the PDF file (e.g., "ananda/public/pdf/Ananda Library/document_hash.pdf")
 * @returns Promise<string> - The signed URL for downloading the PDF
 */
export async function getS3PdfSignedUrl(pdfS3Key: string): Promise<string> {
  try {
    // Get bucket name from environment variables
    const bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME || "ananda-chatbot";

    // Create the GetObjectCommand for the PDF
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: pdfS3Key,
    });

    // Generate signed URL with 8-hour expiration
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 8 * 60 * 60, // 8 hours in seconds
    });

    return signedUrl;
  } catch (error) {
    console.error("Error generating signed URL for PDF:", error);
    throw new Error("Failed to generate PDF download URL");
  }
}
