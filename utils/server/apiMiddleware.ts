// API middleware for handling POST requests, security checks, and conditional authentication
import { NextApiRequest, NextApiResponse } from 'next';
import { withJwtAuth } from './jwtUtils';
import { loadSiteConfigSync } from './loadSiteConfig';

type ApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

type ApiMiddlewareOptions = {
  // Force authentication regardless of site configuration
  forceAuth?: boolean;
  // Skip authentication even if site configuration requires it
  skipAuth?: boolean;
};

/**
 * Middleware that applies common API functionality:
 * 1. Security checks for POST requests
 * 2. Conditional authentication based on site configuration
 *
 * @param handler The API route handler to wrap
 * @param options Configuration options for the middleware
 * @returns A wrapped handler with security and conditional auth applied
 */
export function withApiMiddleware(
  handler: ApiHandler,
  options: ApiMiddlewareOptions = {},
): ApiHandler {
  // Get the base handler with security checks
  const securityHandler = applySecurityChecks(handler);

  // Apply conditional authentication if not explicitly skipped
  if (options.skipAuth !== true) {
    // Either force auth or check site config
    const siteConfig = loadSiteConfigSync();
    if (options.forceAuth || (siteConfig && siteConfig.requireLogin)) {
      return withJwtAuth(securityHandler);
    }
  }

  // Return the handler with just security checks
  return securityHandler;
}

/**
 * Middleware for endpoints that require JWT authentication but not siteAuth cookie.
 * This is used for endpoints that need frontend-to-backend security but should be
 * accessible to non-logged-in users (e.g., contact form, audio playback).
 *
 * @param handler The API route handler to wrap
 * @returns A wrapped handler with JWT auth applied
 */
export function withJwtOnlyAuth(handler: ApiHandler): ApiHandler {
  // Apply security checks first
  const securityHandler = applySecurityChecks(handler);

  // Then apply JWT auth without checking siteAuth cookie
  return withJwtAuth(securityHandler);
}

/**
 * Applies security checks for POST requests
 */
function applySecurityChecks(handler: ApiHandler): ApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const referer = req.headers.referer || req.headers.referrer;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || '';
    const isVercelPreview = process.env.VERCEL_ENV === 'preview';
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Perform security checks for POST requests in non-development environments
    if (req.method === 'POST' && !isDevelopment) {
      // Check for missing referer
      if (!referer) {
        console.info(
          `POST request to ${req.url} without referer. IP: ${req.socket.remoteAddress}`,
        );
        // You might want to allow this, or handle it differently based on your security requirements
      } else if (typeof referer === 'string') {
        // Validate referer against base URL
        const refererUrl = new URL(referer);
        const baseUrlObj = new URL(baseUrl);

        if (!isVercelPreview && refererUrl.hostname !== baseUrlObj.hostname) {
          console.warn(
            `POST request to ${req.url} with invalid referer. IP: ${req.socket.remoteAddress}, Referer: ${referer}`,
          );
          return res
            .status(403)
            .json({ message: 'Forbidden: Invalid referer' });
        }
      }
    }

    // If all checks pass, call the original handler
    await handler(req, res);
  };
}
