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
    // Log environment info
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`VERCEL_URL: ${process.env.VERCEL_URL || 'not set'}`);
    console.log(`Host header: ${req.headers.host}`);
    console.log(`SECURE_TOKEN exists: ${Boolean(process.env.SECURE_TOKEN)}`);

    // Determine the base URL for the API request based on environment
    let baseUrl = '';

    // Try different URL formation strategies for Vercel environments
    if (process.env.VERCEL_URL) {
      // Strategy 1: Standard VERCEL_URL approach
      baseUrl = `https://${process.env.VERCEL_URL}`;
      console.log(`Strategy 1 - Using VERCEL_URL: ${baseUrl}`);

      // Check if we're in a preview deployment (contains -) and try alternative methods
      if (process.env.VERCEL_URL.includes('-')) {
        try {
          // Strategy 2: Try a direct API request to ourselves
          // Since this is a same-origin server-side request, we'll attempt to call the local API directly
          console.log(
            'Strategy 2 - Testing direct API call without domain prefix',
          );

          // Make a direct token request to our own API
          const tokenEndpoint = `/api/get-token`;
          console.log(`Making token request to direct path: ${tokenEndpoint}`);

          const directResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
              'X-Shared-Secret': process.env.SECURE_TOKEN || '',
              'Content-Type': 'application/json',
            },
          });

          if (
            directResponse.ok &&
            directResponse.headers
              .get('content-type')
              ?.includes('application/json')
          ) {
            console.log('Direct API call worked! Using this strategy.');
            const data = await directResponse.json();
            return res.status(200).json({ token: data.token });
          } else {
            console.log(
              `Direct API call failed with status: ${directResponse.status}`,
            );
          }
        } catch (directError) {
          console.error('Error with direct API call strategy:', directError);
          // Continue to try the normal strategy
        }
      }

      // Strategy 3: Try using the absolute URL for the current request
      try {
        console.log('Strategy 3 - Using absolute URL based on request');
        // This forms an absolute URL based on the current request
        const absoluteUrl = `https://${req.headers.host}/api/get-token`;
        console.log(`Making token request to absolute URL: ${absoluteUrl}`);

        const absoluteResponse = await fetch(absoluteUrl, {
          method: 'POST',
          headers: {
            'X-Shared-Secret': process.env.SECURE_TOKEN || '',
            'Content-Type': 'application/json',
          },
        });

        if (
          absoluteResponse.ok &&
          absoluteResponse.headers
            .get('content-type')
            ?.includes('application/json')
        ) {
          console.log('Absolute URL strategy worked!');
          const data = await absoluteResponse.json();
          return res.status(200).json({ token: data.token });
        } else {
          console.log(
            `Absolute URL strategy failed with status: ${absoluteResponse.status}`,
          );
        }
      } catch (absoluteError) {
        console.error('Error with absolute URL strategy:', absoluteError);
        // Continue to try the normal strategy
      }
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
    const tokenEndpoint = `${baseUrl}/api/get-token`;
    console.log(`Making token request to: ${tokenEndpoint}`);

    // Make a server-to-server request to the token endpoint
    // This keeps the SECURE_TOKEN on the server side and never exposes it to clients
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'X-Shared-Secret': process.env.SECURE_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    // Log response details before trying to parse JSON
    console.log(`Response status: ${response.status}`);
    console.log(`Response type: ${response.headers.get('content-type')}`);

    // Check if content type is not JSON, and handle differently
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Get text response to see what we're actually getting
      const textResponse = await response.text();
      console.error(
        `Non-JSON response received: ${textResponse.substring(0, 200)}...`,
      );
      throw new Error(`Expected JSON response but got ${contentType}`);
    }

    // Parse the JSON response from the token endpoint
    const data = await response.json();

    // If token fetch failed, throw an error while hiding implementation details
    if (!response.ok) {
      console.error(`API error: ${data.error || 'Unknown error'}`);
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
