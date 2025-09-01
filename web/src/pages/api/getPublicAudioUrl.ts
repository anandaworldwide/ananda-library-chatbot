import { NextApiRequest, NextApiResponse } from "next";
import { s3Client } from "@/utils/server/awsConfig";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { withJwtOnlyAuth } from "@/utils/server/apiMiddleware";

// Valid audio file extensions and MIME types (same as secure endpoint)
const VALID_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
const VALID_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
];

/**
 * Generates a public (non-expiring) URL for audio files intended for copying/sharing
 * This endpoint is specifically for generating URLs that will be copied to clipboard
 * and shared, so they need to remain valid indefinitely.
 *
 * Security measures:
 * - JWT authentication required
 * - Content-type validation
 * - Rate limiting
 * - S3 metadata verification
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // Apply rate limiting (stricter for public URLs)
    const rateLimitPassed = await genericRateLimiter(req, res, {
      windowMs: 60 * 1000, // 1 minute
      max: 10, // 10 requests per minute (lower than secure endpoint)
      name: "public_audio_access",
    });

    if (!rateLimitPassed) {
      return; // Rate limit response already sent
    }

    // Extract audio S3 key and optional library from request body
    const { audioS3Key, library } = req.body;

    if (!audioS3Key || typeof audioS3Key !== "string") {
      return res.status(400).json({ message: "Invalid audio S3 key" });
    }

    // Construct the full S3 key with library path if provided
    let fullS3Key = audioS3Key;
    if (library && typeof library === "string" && !audioS3Key.includes("/")) {
      fullS3Key = `public/audio/${library.toLowerCase()}/${audioS3Key}`;
    } else if (!audioS3Key.startsWith("public/audio/")) {
      fullS3Key = `public/audio/${audioS3Key}`;
    }

    // Security validation: Ensure the key appears to be an audio file
    const hasValidExtension = VALID_AUDIO_EXTENSIONS.some((ext) => fullS3Key.toLowerCase().endsWith(ext));

    if (!hasValidExtension) {
      console.warn(`Rejected non-audio file request for public URL: ${fullS3Key}`);
      return res.status(400).json({
        message: "Invalid file type - audio files only",
        validExtensions: VALID_AUDIO_EXTENSIONS,
      });
    }

    // Additional security: Verify the file exists and is actually an audio file in S3
    const bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME || "ananda-chatbot";

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: fullS3Key,
      });
      const headResponse = await s3Client.send(headCommand);

      // Verify content type is audio or binary/octet-stream (common for older uploads)
      if (headResponse.ContentType) {
        const isValidAudioType = VALID_AUDIO_MIME_TYPES.some((type) =>
          headResponse.ContentType?.includes(type.split("/")[1])
        );
        const isBinaryOctetStream =
          headResponse.ContentType.includes("binary/octet-stream") ||
          headResponse.ContentType.includes("application/octet-stream");

        if (!isValidAudioType && !isBinaryOctetStream) {
          console.warn(
            `Audio content-type validation failed for public URL: ${fullS3Key} has type ${headResponse.ContentType}`
          );
          return res.status(400).json({
            message: "File is not an audio document",
            actualType: headResponse.ContentType,
          });
        }
      }
    } catch (s3Error: any) {
      // Handle S3 errors (file not found, access denied, etc.)
      if (s3Error.name === "NoSuchKey" || s3Error.name === "NotFound") {
        console.warn(`Audio file not found for public URL: ${fullS3Key}`);
        return res.status(404).json({ message: "Audio file not found" });
      } else if (s3Error.name === "Forbidden" || s3Error.name === "AccessDenied") {
        console.warn(`Access denied to audio file for public URL: ${fullS3Key}`);
        return res.status(403).json({ message: "Access denied to audio file" });
      } else {
        console.error(`S3 verification error for public URL ${fullS3Key}:`, s3Error);
        return res.status(500).json({ message: "Unable to verify audio file" });
      }
    }

    // Generate public URL (non-expiring)
    // Properly encode the S3 key path segments to handle spaces and special characters
    const encodedS3Key = fullS3Key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");

    const publicUrl = `https://${bucketName}.s3.us-west-1.amazonaws.com/${encodedS3Key}`;

    return res.status(200).json({
      publicUrl,
      contentType: "audio",
      expiresIn: null, // null indicates no expiration
      message: "Public URL generated for copying/sharing",
    });
  } catch (error) {
    console.error("Error generating public audio URL:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Use JWT-only auth since public URLs should still require authentication
// but don't require the siteAuth cookie
export default withJwtOnlyAuth(handler);
