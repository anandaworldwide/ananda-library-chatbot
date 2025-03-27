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
 * - Requires a valid siteAuth cookie for authentication when site config requires login
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import jwt from 'jsonwebtoken';
import { isTokenValid } from '@/utils/server/passwordUtils';
import { loadSiteConfigSync } from '@/utils/server/loadSiteConfig';
import CryptoJS from 'crypto-js';

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
    // Get site config to check if login is required
    const siteConfig = loadSiteConfigSync();
    const loginRequired = siteConfig?.requireLogin === true;

    // Only check the siteAuth cookie if login is required
    if (loginRequired) {
      // Check for siteAuth cookie
      const siteAuth = req.cookies['siteAuth'];
      if (!siteAuth) {
        console.log('[401] Missing siteAuth cookie');
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Cryptographically verify the token using the same method as middleware.ts
      const storedHashedToken = process.env.SECURE_TOKEN_HASH;
      if (!storedHashedToken) {
        console.error('Missing SECURE_TOKEN_HASH environment variable');
        return res.status(500).json({ error: 'Server configuration error' });
      }

      // Split token to get hash part and timestamp part
      const tokenParts = siteAuth.split(':');
      if (tokenParts.length !== 2) {
        console.log(
          '[401] Invalid token format - expected 2 parts separated by ":"',
        );
        return res.status(401).json({ error: 'Invalid authentication format' });
      }

      const [tokenValue] = tokenParts;

      // Verify token hash matches stored hash
      const calculatedHash = CryptoJS.SHA256(tokenValue).toString();
      if (calculatedHash !== storedHashedToken) {
        console.log('[401] Token hash mismatch');
        console.log(`Expected: ${storedHashedToken}`);
        console.log(`Received: ${calculatedHash}`);
        return res.status(401).json({ error: 'Invalid authentication' });
      }

      // Validate the siteAuth cookie using passwordUtils (timestamp check)
      if (!isTokenValid(siteAuth)) {
        console.log('[401] Token timestamp validation failed');
        console.log(`Token: ${siteAuth}`);
        return res.status(401).json({ error: 'Expired authentication' });
      }
    }

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

export default withApiMiddleware(handler, { skipAuth: true });
