// This file handles API requests for retrieving audio files from S3.
// It generates signed URLs for client-side audio playback.

import { NextApiRequest, NextApiResponse } from 'next';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';

// Define the handler function
const handleRequest = async (
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> => {
  // Process the request directly
  try {
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

    // Get the filename from the request
    const { filename } = req.query;

    if (!filename || typeof filename !== 'string') {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    // Sanitize the filename
    let sanitizedFilename = filename.replace(/^\/+/, '');

    // Remove API path prefix if present
    sanitizedFilename = sanitizedFilename.replace(/^api\/audio\//, '');

    // Ensure we only access audio files
    const s3Key = `public/audio/${sanitizedFilename}`;

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

      // Generate the signed URL
      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

      res.status(200).json({ url });
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

// Export the handler with standard JWT auth
export default withJwtAuth(withApiMiddleware(handleRequest));
