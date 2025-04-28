/**
 * JWT Authentication Utilities for App Router
 *
 * This module provides App Router-specific utilities for JWT token verification.
 * It adapts the existing JWT validation from the Pages Router to work with App Router endpoints.
 *
 * The utilities support:
 * 1. Direct token verification (same as in Pages Router)
 * 2. Extracting and verifying tokens from App Router requests
 * 3. Creating middleware-like functions for JWT authentication in route handlers
 */

import { NextRequest, NextResponse } from 'next/server';
import { JwtPayload, verifyToken } from './jwtUtils';

/**
 * Extracts and verifies the JWT token from a request's Authorization header
 *
 * Handles the common pattern of extracting a Bearer token from the
 * Authorization header and verifying it in one operation.
 *
 * @param req The Next.js App Router API request
 * @returns The decoded token payload with client information
 * @throws Error if no token is provided or if the token is invalid
 */
export function getTokenFromAppRequest(req: NextRequest): JwtPayload {
  const authHeader = req.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }

  const token = authHeader.split(' ')[1];
  return verifyToken(token);
}

/**
 * Higher-order function that creates a middleware-like function for JWT authentication
 * specifically designed for App Router route handlers
 *
 * This function verifies a JWT token before allowing the handler to proceed.
 * If token verification fails, it returns an appropriate error response.
 *
 * @param handler The function to wrap with JWT authentication
 * @returns A function that first performs JWT verification
 */
export function withAppRouterJwtAuth<T>(
  handler: (req: NextRequest, context: any, token: JwtPayload) => Promise<T>,
): (req: NextRequest, context?: any) => Promise<T | Response> {
  return async (req: NextRequest, context: any = {}): Promise<T | Response> => {
    try {
      // Get and verify the token
      const jwtPayload = getTokenFromAppRequest(req);

      // If verification succeeds, call the original handler with the token payload
      return handler(req, context, jwtPayload);
    } catch (error) {
      // If verification fails, return an appropriate error response
      const message =
        error instanceof Error ? error.message : 'Authentication failed';
      return NextResponse.json({ error: message }, { status: 401 });
    }
  };
}
