/**
 * JWT Authentication Utilities
 *
 * This module provides utilities for JWT token verification and API route protection.
 * It leverages the existing SECURE_TOKEN from the authentication system to verify tokens,
 * avoiding the need for separate JWT signing keys.
 *
 * The utilities support:
 * 1. Direct token verification
 * 2. Extracting and verifying tokens from API requests
 * 3. Creating protected API route handlers with JWT authentication
 */

import { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';

/**
 * Interface defining the structure of the JWT payload
 * - client: Identifies the client type ("web" or "wordpress")
 * - iat: Issued at timestamp
 * - exp: Expiration timestamp
 */
export interface JwtPayload {
  client: string;
  iat: number;
  exp: number;
}

/**
 * Verifies a JWT token and returns the decoded payload
 *
 * This function uses the application's SECURE_TOKEN as the JWT secret,
 * leveraging the existing authentication infrastructure instead of
 * requiring a separate JWT_SECRET.
 *
 * @param token The JWT token to verify
 * @returns The decoded token payload with client information
 * @throws Error if token is invalid, expired, or if SECURE_TOKEN is not configured
 */
export function verifyToken(token: string): JwtPayload {
  try {
    // Use the existing SECURE_TOKEN from login system for JWT verification
    const jwtSecret = process.env.SECURE_TOKEN as string;

    if (!jwtSecret) {
      throw new Error('JWT signing key is not configured');
    }

    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
    return decoded;
  } catch (error) {
    // Preserve the error message for 'JWT signing key is not configured'
    if (
      error instanceof Error &&
      error.message === 'JWT signing key is not configured'
    ) {
      throw error;
    }

    // For all other errors, throw a standardized message
    // to avoid leaking information about the verification process
    throw new Error('Invalid or expired token');
  }
}

/**
 * Extracts and verifies the JWT token from a request's Authorization header
 *
 * Handles the common pattern of extracting a Bearer token from the
 * Authorization header and verifying it in one operation.
 *
 * @param req The Next.js API request
 * @returns The decoded token payload with client information
 * @throws Error if no token is provided or if the token is invalid
 */
export function getTokenFromRequest(req: NextApiRequest): JwtPayload {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }

  const token = authHeader.split(' ')[1];
  return verifyToken(token);
}

/**
 * Higher-order function that creates a middleware for JWT authentication
 *
 * This middleware automatically handles token extraction and verification
 * before allowing the original handler to process the request. If token
 * verification fails, it returns an appropriate error response.
 *
 * Usage:
 * export default withApiMiddleware(withJwtAuth(handler));
 *
 * @param handler The API route handler to protect
 * @returns A wrapped handler that performs JWT verification
 */
export function withJwtAuth(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
    ...args: any[]
  ) => Promise<void> | void,
) {
  return async (req: NextApiRequest, res: NextApiResponse, ...args: any[]) => {
    try {
      // Get and verify the token
      getTokenFromRequest(req);
      // If verification succeeds, call the original handler
      return handler(req, res, ...args);
    } catch (error) {
      // If verification fails, return an appropriate error response
      const message =
        error instanceof Error ? error.message : 'Authentication failed';
      return res.status(401).json({ error: message });
    }
  };
}
