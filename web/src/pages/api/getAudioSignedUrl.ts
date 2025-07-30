import { NextApiRequest, NextApiResponse } from "next";
import { s3Client } from "@/utils/server/awsConfig";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { withJwtOnlyAuth } from "@/utils/server/apiMiddleware";

// Valid audio file extensions and MIME types
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
 * Generates a signed URL for audio file access from S3 with security validation
 * @param audioS3Key - The S3 key for the audio file (e.g., "public/audio/library/filename.mp3")
 * @returns Promise<string> - The signed URL for accessing the audio file
 */
async function getS3AudioSignedUrl(audioS3Key: string): Promise<string> {
  try {
    // Get bucket name from environment variables
    const bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME || "ananda-chatbot";

    // Create the GetObjectCommand for the audio file
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: audioS3Key,
    });

    // Generate signed URL with 4-hour expiration (shorter than PDF for security)
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 4 * 60 * 60, // 4 hours in seconds
    });

    return signedUrl;
  } catch (error) {
    console.error("Error generating signed URL for audio:", error);
    throw new Error("Failed to generate audio access URL");
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // Apply rate limiting
    const rateLimitPassed = await genericRateLimiter(req, res, {
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 requests per minute (higher than PDF since audio is streamed)
      name: "audio_access",
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
      console.warn(`Rejected non-audio file request: ${fullS3Key}`);
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
          console.warn(`Audio content-type validation failed: ${fullS3Key} has type ${headResponse.ContentType}`);
          return res.status(400).json({
            message: "File is not an audio document",
            actualType: headResponse.ContentType,
          });
        }
      }
    } catch (s3Error: any) {
      // Handle S3 errors (file not found, access denied, etc.)
      if (s3Error.name === "NoSuchKey" || s3Error.name === "NotFound") {
        console.warn(`Audio file not found: ${fullS3Key}`);
        return res.status(404).json({ message: "Audio file not found" });
      } else if (s3Error.name === "Forbidden" || s3Error.name === "AccessDenied") {
        console.warn(`Access denied to audio file: ${fullS3Key}`);
        return res.status(403).json({ message: "Access denied to audio file" });
      } else {
        console.error(`S3 verification error for ${fullS3Key}:`, s3Error);
        return res.status(500).json({ message: "Unable to verify audio file" });
      }
    }

    // Generate signed URL only after all security checks pass
    const signedUrl = await getS3AudioSignedUrl(fullS3Key);

    return res.status(200).json({
      signedUrl,
      contentType: "audio",
      expiresIn: 4 * 60 * 60, // 4 hours
    });
  } catch (error) {
    console.error("Error generating audio signed URL:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Use JWT-only auth since audio should be accessible to authenticated users
// but doesn't require the siteAuth cookie
export default withJwtOnlyAuth(handler);
