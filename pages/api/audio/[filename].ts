import { NextApiRequest, NextApiResponse } from 'next';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from '@/utils/server/awsConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Set CORS headers
  const allowedOrigin = process.env.NODE_ENV === 'production' ? 
        'https://ask.anandalibrary.org' : 'http://localhost:3000';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { filename } = req.query;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (typeof filename !== 'string') {
    console.error('Invalid filename:', filename);
    return res.status(400).json({ error: 'Invalid filename' });
  }

  try {
    // Remove any leading slashes and 'api/audio/' from the filename
    const cleanFilename = filename.replace(/^\/*(api\/audio\/)*/, '');
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: `public/audio/${cleanFilename}`, 
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 21600 });

    // Send the signed URL back to the client
    res.status(200).json({ url: signedUrl });
  } catch (error) {
    if (error instanceof Error) {
      console.error('Detailed error:', error);
      res.status(500).json({ error: 'Error accessing file', details: error.message });
    } else {
      console.error('Unknown error:', error);
      res.status(500).json({ error: 'Error accessing file', details: 'Unknown error' });
    }
  }
}