/**
 * Proxy Token API Endpoint
 *
 * This endpoint acts as a secure intermediary for the web frontend to obtain JWT tokens.
 * It solves a critical security problem: the frontend needs tokens but can't securely
 * store the SECURE_TOKEN needed to obtain them.
 *
 * By exposing this proxy endpoint, the frontend can request tokens without needing
 * direct access to any secrets. The proxy endpoint makes server-to-server calls using
 * the securely stored SECURE_TOKEN environment variable.
 *
 * Security considerations:
 * - Only accessible via GET for simplicity (tokens aren't in URL parameters)
 * - Server-side environment variables are never exposed to the client
 * - Error messages are generic to avoid leaking implementation details
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';

/**
 * API handler for the proxy token endpoint
 *
 * @param req The Next.js API request
 * @param res The Next.js API response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests to simplify client usage
  // Since no sensitive information is sent in the request,
  // GET provides a simpler interface for the frontend
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Determine the base URL for the API request based on environment
    // This supports development, production, and preview deployments
    let baseUrl = '';

    // For Vercel deployments (including preview deployments)
    if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
      console.log(`Using VERCEL_URL: ${baseUrl}`);
    }
    // Fallback to host header for local development and production
    else {
      baseUrl =
        process.env.NODE_ENV === 'production'
          ? `https://${req.headers.host}`
          : `http://${req.headers.host}`;
      console.log(`Using host header: ${baseUrl}`);
    }

    // Verify SECURE_TOKEN is available in environment variables
    if (!process.env.SECURE_TOKEN) {
      console.error('Missing SECURE_TOKEN environment variable');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Log the request we're about to make (token hidden for security)
    console.log(`Making token request to: ${baseUrl}/api/get-token`);

    // Make a server-to-server request to the token endpoint
    // This keeps the SECURE_TOKEN on the server side and never exposes it to clients
    const response = await fetch(`${baseUrl}/api/get-token`, {
      method: 'POST',
      headers: {
        'X-Shared-Secret': process.env.SECURE_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    // Parse the JSON response from the token endpoint
    const data = await response.json();

    // If token fetch failed, throw an error while hiding implementation details
    if (!response.ok) {
      throw new Error(data.error || 'Token fetch failed');
    }

    // Forward the token to the client
    // The client only receives the JWT token, not any of the secrets used to generate it
    res.status(200).json({ token: data.token });
  } catch (error) {
    // Log detailed error for server-side debugging
    console.error('Error in proxy token endpoint:', error);
    // Return generic error to the client to avoid leaking implementation details
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withApiMiddleware(handler);
