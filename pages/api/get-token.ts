/**
 * Token Issuance API Endpoint
 *
 * This endpoint is responsible for issuing JWT tokens for authenticated clients.
 * It supports two authentication methods:
 * 1. Web frontend - using the SECURE_TOKEN directly
 * 2. WordPress plugin - using a derived token from SECURE_TOKEN with a WordPress-specific salt
 *
 * The endpoint issues JWTs with a 15-minute expiration period, identifying the client type
 * in the token payload. This enables secure communication between different clients and
 * the backend without requiring separate authentication systems.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';

/**
 * API handler for the token issuance endpoint
 *
 * @param req The Next.js API request
 * @param res The Next.js API response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('get-token endpoint called');

  // Log request information for debugging
  console.log(`Request method: ${req.method}`);
  console.log(`Content-Type: ${req.headers['content-type']}`);
  console.log(
    `Has x-shared-secret header: ${Boolean(req.headers['x-shared-secret'])}`,
  );
  console.log(`Has x-no-auth header: ${Boolean(req.headers['x-no-auth'])}`);
  console.log(
    `Has authorization header: ${Boolean(req.headers.authorization)}`,
  );
  console.log(`Has body: ${Boolean(req.body)}`);
  console.log(`Body has secret: ${Boolean(req.body?.secret)}`);

  // Only allow POST requests for security (avoids tokens in URL/query params)
  if (req.method !== 'POST') {
    console.log('Rejecting non-POST request');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Get the shared secret from headers or body to support different client types
    // - Web frontend sends via headers
    // - WordPress plugin sends via request body
    let sharedSecret =
      (req.headers['x-shared-secret'] as string) || req.body?.secret;

    // Also check for Bearer token in Authorization header
    if (!sharedSecret && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        sharedSecret = authHeader.substring(7);
        console.log('Using Authorization Bearer token');
      }
    }

    if (!sharedSecret) {
      console.log('No secret provided in request');
      console.log('Headers received:', Object.keys(req.headers).join(', '));
      console.log(
        'Has authorization header:',
        Boolean(req.headers.authorization),
      );
      return res.status(403).json({ error: 'No secret provided' });
    }

    // Extra debugging for the shared secret
    const secretStart = sharedSecret.substring(0, 3);
    const secretEnd = sharedSecret.substring(sharedSecret.length - 3);
    console.log(
      `Secret info - Length: ${sharedSecret.length}, Start: ${secretStart}..., End: ...${secretEnd}`,
    );

    // Retrieve environment variables for token validation
    const secureToken = process.env.SECURE_TOKEN;
    const secureTokenHash = process.env.SECURE_TOKEN_HASH;

    // Debug environment variables (safely)
    if (secureToken) {
      const tokenStart = secureToken.substring(0, 3);
      const tokenEnd = secureToken.substring(secureToken.length - 3);
      console.log(
        `SECURE_TOKEN info - Length: ${secureToken.length}, Start: ${tokenStart}..., End: ...${tokenEnd}`,
      );
    }
    console.log(`SECURE_TOKEN_HASH exists: ${Boolean(secureTokenHash)}`);

    // Ensure required environment variables are configured
    if (!secureToken || !secureTokenHash) {
      console.error(
        'Missing environment variables: SECURE_TOKEN or SECURE_TOKEN_HASH',
      );
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // For web frontend, directly compare with SECURE_TOKEN
    const isWebFrontend = sharedSecret === secureToken;
    console.log(`Web frontend token match: ${isWebFrontend}`);

    // For WordPress, derive a WordPress-specific token by hashing the SECURE_TOKEN
    // with a WordPress-specific salt (prefix) for additional security
    const wordpressToken = crypto
      .createHash('sha256')
      .update(`wordpress-${secureToken}`)
      .digest('hex')
      .substring(0, 32); // Use first 32 chars of the hash for better usability

    const isWordPress = sharedSecret === wordpressToken;
    console.log(`WordPress token match: ${isWordPress}`);

    // If neither secret matches, return forbidden response
    if (!isWebFrontend && !isWordPress) {
      console.log('Invalid secret provided - no match found');
      return res.status(403).json({ error: 'Invalid secret' });
    }

    // Create JWT payload with client identifier and standard timestamps
    const payload = {
      client: isWebFrontend ? 'web' : 'wordpress', // Identify client type
      iat: Math.floor(Date.now() / 1000), // Issued at timestamp
    };

    // Sign the JWT using the SECURE_TOKEN with a 15-minute expiration
    // This relatively short expiration improves security by limiting
    // the window of opportunity if a token is somehow compromised
    const token = jwt.sign(payload, secureToken, {
      expiresIn: '15m',
    });

    // Return the generated token to the client
    res.status(200).json({ token });
  } catch (error) {
    // Log errors for server-side debugging but avoid exposing details to clients
    console.error('Error generating token:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export default withApiMiddleware(handler);
