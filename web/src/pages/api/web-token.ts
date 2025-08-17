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
 *   EXCEPT for certain public endpoints (contact form) that need JWT auth
 *   but don't require user login
 */

import { NextApiRequest, NextApiResponse } from "next";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import jwt from "jsonwebtoken";
import { isTokenValid } from "@/utils/server/passwordUtils";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import CryptoJS from "crypto-js";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { verifyToken } from "@/utils/server/jwtUtils";

/**
 * API handler for the web token endpoint
 *
 * @param req The Next.js API request
 * @param res The Next.js API response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Apply rate limiting
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 requests per 5 minutes per IP
    name: "web-token-requests",
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  // Only allow GET requests to simplify client usage
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Get site config to check if login is required
    const siteConfig = loadSiteConfigSync();
    const loginRequired = siteConfig?.requireLogin === true;

    // Get referer to check if it's a special case
    const referer = req.headers.referer || "";

    // Define paths that should receive tokens without login (siteAuth cookie)
    // These are pages that use withJwtOnlyAuth middleware
    const publicJwtPaths = [
      "/contact", // Contact form
      "/answers/", // Public answers
      "/verify", // Activation page must be able to fetch a token without siteAuth
    ];

    // Check if this is a request from a public JWT-only path
    const isPublicJwtPath = typeof referer === "string" && publicJwtPaths.some((path) => referer.includes(path));

    // Either check authentication if login is required, or skip if it's a public JWT path
    if (loginRequired && !isPublicJwtPath) {
      // Check for new JWT auth cookie first, then fall back to legacy siteAuth
      const authJwt = req.cookies["auth"];
      const siteAuth = req.cookies["siteAuth"];

      if (authJwt) {
        // Verify the JWT token
        try {
          const jwtSecret = process.env.SECURE_TOKEN;
          if (!jwtSecret) {
            console.error("Missing SECURE_TOKEN environment variable for JWT verification");
            return res.status(500).json({ error: "Server configuration error" });
          }

          // Verify the JWT token
          jwt.verify(authJwt, jwtSecret);
          console.log("[200] Valid JWT auth cookie found");
          // JWT is valid, proceed to token generation
        } catch (jwtError) {
          console.log("[401] Invalid JWT auth cookie:", jwtError);
          return res.status(401).json({ error: "Invalid authentication" });
        }
      } else if (siteAuth) {
        // Fall back to legacy siteAuth validation
        // Cryptographically verify the token using the same method as middleware.ts
        const storedHashedToken = process.env.SECURE_TOKEN_HASH;
        if (!storedHashedToken) {
          console.error("Missing SECURE_TOKEN_HASH environment variable");
          return res.status(500).json({ error: "Server configuration error" });
        }

        // Split token to get hash part and timestamp part
        const tokenParts = siteAuth.split(":");
        if (tokenParts.length !== 2) {
          console.log('[401] Invalid token format - expected 2 parts separated by ":"');
          return res.status(401).json({ error: "Invalid authentication format" });
        }

        const [tokenValue] = tokenParts;

        // Verify token hash matches stored hash
        const calculatedHash = CryptoJS.SHA256(tokenValue).toString();
        if (calculatedHash !== storedHashedToken) {
          console.log("[401] Token hash mismatch");
          console.log(`Expected: ${storedHashedToken}`);
          console.log(`Received: ${calculatedHash}`);
          return res.status(401).json({ error: "Invalid authentication" });
        }

        // Validate the siteAuth cookie using passwordUtils (timestamp check)
        if (!isTokenValid(siteAuth)) {
          console.log("[401] Token timestamp validation failed");
          console.log(`Token: ${siteAuth}`);
          return res.status(401).json({ error: "Expired authentication" });
        }
      } else {
        console.log("[401] Missing authentication - no auth or siteAuth cookie");
        return res.status(401).json({ error: "Authentication required (2)" });
      }
    }

    // Verify SECURE_TOKEN is available in environment variables
    if (!process.env.SECURE_TOKEN) {
      console.error("Missing SECURE_TOKEN environment variable");
      return res.status(500).json({ error: "Server configuration error" });
    }

    // Create JWT payload - conditionally include user info if authenticated
    const payload: any = {
      client: "web",
      iat: Math.floor(Date.now() / 1000),
    };

    // Check for auth cookie and add user info if present and valid
    const authCookie = req.cookies?.["auth"];
    if (authCookie) {
      try {
        const userPayload = verifyToken(authCookie) as any;
        if (userPayload?.email) {
          payload.email = userPayload.email;
          payload.role = userPayload.role || "user";
        }
      } catch (error) {
        // If auth cookie is invalid, continue with anonymous token
        // This allows graceful degradation for expired/invalid sessions
        console.log("Invalid auth cookie, issuing anonymous token:", error);
      }
    }

    // Create a JWT token with the conditional payload
    try {
      const webToken = jwt.sign(payload, process.env.SECURE_TOKEN, { expiresIn: "15m" });
      return res.status(200).json({ token: webToken });
    } catch (tokenError) {
      console.error("Error creating web token:", tokenError);
      return res.status(500).json({ error: "Failed to create token" });
    }
  } catch (error) {
    // Log errors for debugging but avoid exposing implementation details to clients
    console.error("Error in web token endpoint:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

export default withApiMiddleware(handler, { skipAuth: true });
