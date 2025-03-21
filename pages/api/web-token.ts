/**
 * Web Token API Endpoint
 *
 * This endpoint generates JWT tokens for the web frontend client.
 * It solves a critical security problem: the frontend needs tokens but can't securely
 * store the SECURE_TOKEN needed to obtain them.
 *
 * By creating tokens directly from environment variables, this endpoint provides
 * a secure way for the frontend to obtain authentication without exposing secrets.
 *
 * Security considerations:
 * - Only accessible via GET for simplicity
 * - Server-side environment variables are never exposed to the client
 * - Error messages are generic to avoid leaking implementation details
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import jwt from 'jsonwebtoken';

/**
 * API handler for the web token endpoint
 *
 * @param req The Next.js API request
 * @param res The Next.js API response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests to simplify client usage
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Log basic debugging information
    const token = process.env.SECURE_TOKEN || '';
    if (token) {
      const tokenStart = token.substring(0, 3);
      const tokenEnd = token.substring(token.length - 3);
      const tokenLength = token.length;
      console.log(
        `Token debug - Length: ${tokenLength}, Start: ${tokenStart}..., End: ...${tokenEnd}`,
      );
    }

    // Log environment info
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Host header: ${req.headers.host}`);
    console.log(`SECURE_TOKEN exists: ${Boolean(process.env.SECURE_TOKEN)}`);

    // Verify SECURE_TOKEN is available in environment variables
    if (!process.env.SECURE_TOKEN) {
      console.error('Missing SECURE_TOKEN environment variable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Create a JWT token directly using the secure token
    try {
      const webToken = jwt.sign(
        {
          client: 'web',
          iat: Math.floor(Date.now() / 1000),
        },
        process.env.SECURE_TOKEN,
        { expiresIn: '15m' },
      );

      console.log('Successfully created web token');
      return res.status(200).json({ token: webToken });
    } catch (tokenError) {
      console.error('Error creating web token:', tokenError);
      return res.status(500).json({ error: 'Failed to create token' });
    }
  } catch (error) {
    // Log errors for debugging but avoid exposing implementation details to clients
    console.error('Error in web token endpoint:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

export default withApiMiddleware(handler);
