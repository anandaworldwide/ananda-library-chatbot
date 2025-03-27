// This file handles API requests for retrieving audio files from S3.
// It generates signed URLs for client-side audio playback.

import { NextApiRequest, NextApiResponse } from 'next';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { runMiddleware } from '@/utils/server/corsMiddleware';
import Cors from 'cors';
import { withJwtOnlyAuth } from '@/utils/server/apiMiddleware';

// Configure CORS specifically for audio files
const audioCors = Cors({
  methods: ['GET', 'HEAD', 'OPTIONS'],
  origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000', // Only allow our frontend domain
  credentials: true, // Required for Authorization header
  allowedHeaders: ['Authorization', 'Content-Type'], // Explicitly allow Authorization header
});

/**
 * Audio API endpoint that requires JWT authentication for frontend-to-backend security.
 * Unlike most endpoints, this does NOT require the siteAuth cookie (user login).
 *
 * Authentication Flow:
 * 1. JWT token is REQUIRED - This ensures only our frontend can access the audio files
 * 2. siteAuth cookie is NOT required - This allows non-logged-in users to play audio
 * 3. CORS is configured to only allow requests from our frontend domain
 */
const handleRequest = async (
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> => {
  // Apply CORS middleware first
  await runMiddleware(req, res, audioCors);

  // Handle preflight OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Process the request
  try {
    // Get the filename from the request
    const { filename } = req.query;

    if (!filename || typeof filename !== 'string') {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    // Sanitize the filename - handle the case when the API path is included multiple times
    // Example: fixing /api/audio//api/audio/easter-1996-festival.mp3
    let sanitizedFilename = filename;

    // Remove all instances of /api/audio/ from the path
    while (sanitizedFilename.includes('api/audio/')) {
      console.log('********* Removing api/audio/ from path');
      sanitizedFilename = sanitizedFilename.replace('api/audio/', '');
    }

    // Remove any leading slashes
    sanitizedFilename = sanitizedFilename.replace(/^\/+/, '');

    // Determine the appropriate path based on the filename structure.
    // Audio files are stored in the 'treasures' folder or other subfolders,
    // but sometimes the request doesn't include the subfolder.
    // As of 8/2024, the audio files are stored in the 'treasures' folder or bhaktan
    // folder, but pinecone data still has unqualified filenames for treasures files.
    const filePath = sanitizedFilename.includes('/')
      ? sanitizedFilename
      : `treasures/${sanitizedFilename}`;

    console.log(`Processing audio request for: ${filePath}`);

    // Ensure we only access audio files
    const s3Key = `public/audio/${filePath}`;

    try {
      // Create S3 client
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });

      // Create the command
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME || 'example-bucket',
        Key: s3Key,
      });

      // Generate the signed URL - use longer expiration like the original code
      const url = await getSignedUrl(s3Client, command, { expiresIn: 21600 });
      console.log(`Generated signed URL for: ${s3Key}`);

      // Return JSON with the direct URL to the audio file
      res.status(200).json({
        url,
        filename: sanitizedFilename,
        path: filePath,
      });

      return;
    } catch (error: any) {
      console.error('Error generating S3 signed URL:', error);

      if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      res.status(500).json({
        error: 'Error accessing file',
        details: error.message || 'Unknown error',
      });
      return;
    }
  } catch (error: any) {
    console.error('Unexpected error in audio API:', error);
    res.status(500).json({
      error: 'Error accessing file',
      details: error.message || 'Unknown error',
    });
    return;
  }
};

// Apply JWT-only authentication middleware
export default withJwtOnlyAuth(handleRequest);
