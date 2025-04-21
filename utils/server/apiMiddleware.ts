// API middleware for handling POST requests, security checks, and conditional authentication
import { NextApiRequest, NextApiResponse } from 'next';
import { withJwtAuth } from './jwtUtils';
import { loadSiteConfigSync } from './loadSiteConfig';
import { createErrorCorsHeaders, setCorsHeaders } from './corsMiddleware';

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

// Add CORS handling to request processing chain
function applyCors(
  req: NextApiRequest,
  res: NextApiResponse,
  handler: ApiHandler,
): Promise<void> {
  const siteConfig = loadSiteConfigSync();

  if (siteConfig) {
    setCorsHeaders(req, res, siteConfig);
  } else {
    console.warn('Site config not available for CORS');
  }

  // Handle OPTIONS requests before continuing
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return Promise.resolve();
  }

  return handler(req, res);
}

/**
 * Applies security checks for POST requests
 */
function applySecurityChecks(handler: ApiHandler): ApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Apply CORS first before any security checks
    return applyCors(req, res, async (req, res) => {
      // Then continue with the original security checks
      const referer = req.headers.referer || req.headers.referrer;
      const isDevelopment = process.env.NODE_ENV === 'development';
      const siteConfig = loadSiteConfigSync();

      // Perform security checks for POST requests in non-development environments
      if (req.method === 'POST' && !isDevelopment) {
        // Check for missing referer
        if (!referer) {
          console.info(
            `POST request to ${req.url} without referer. IP: ${req.socket.remoteAddress}`,
          );
        } else if (typeof referer === 'string' && siteConfig) {
          try {
            // Validate referer against allowed domains
            const refererUrl = new URL(referer);
            const allowedDomains = siteConfig.allowedFrontEndDomains || [];

            // Check if referer matches any allowed domain pattern
            const isAllowedDomain = allowedDomains.some((domain) => {
              // Handle wildcard patterns (e.g., **-ananda-web-services-projects.vercel.app)
              if (domain.includes('**')) {
                const pattern = domain.replace('**', '.*');
                return new RegExp(`^${pattern}$`).test(refererUrl.hostname);
              }
              return refererUrl.hostname === domain;
            });

            if (!isAllowedDomain) {
              console.warn(
                `POST request to ${req.url} with invalid referer. IP: ${req.socket.remoteAddress}, Referer: ${referer}`,
              );

              // Apply CORS headers to error response
              const corsHeaders = createErrorCorsHeaders(req);
              Object.entries(corsHeaders).forEach(([key, value]) => {
                res.setHeader(key, value);
              });

              return res
                .status(403)
                .json({ message: 'Forbidden: Invalid referer' });
            }
          } catch (error) {
            console.warn(`Error parsing referer URL: ${referer}`, error);

            // Apply CORS headers to error response
            const corsHeaders = createErrorCorsHeaders(req);
            Object.entries(corsHeaders).forEach(([key, value]) => {
              res.setHeader(key, value);
            });

            return res.status(403).json({ message: 'Invalid referer format' });
          }
        }
      }

      // If all checks pass, call the original handler
      await handler(req, res);
    });
  };
}
