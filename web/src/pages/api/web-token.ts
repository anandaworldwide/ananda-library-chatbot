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
 * - Requires a valid JWT auth cookie for authentication when site config requires login
 *   EXCEPT for certain public endpoints (contact form) that need JWT auth
 *   but don't require user login
 */

import { NextApiRequest, NextApiResponse } from "next";
import { withApiMiddleware } from "@/utils/server/apiMiddleware";
import jwt from "jsonwebtoken";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { verifyToken } from "@/utils/server/jwtUtils";
import { db } from "@/services/firebase";
import { getUsersCollectionName } from "@/utils/server/firestoreUtils";
import { firestoreGet } from "@/utils/server/firestoreRetryUtils";

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
      // Only accept JWT auth cookies when requireLogin is true - no legacy siteAuth fallback
      const authJwt = req.cookies["auth"];

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
      } else {
        console.log("[401] Missing authentication - no valid auth cookie found");
        return res.status(401).json({ error: "Authentication required" });
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
        if (userPayload?.email && db) {
          // Get user's UUID from their profile
          const userDoc = await firestoreGet(
            db.collection(getUsersCollectionName()).doc(userPayload.email),
            "get user UUID for JWT",
            userPayload.email
          );

          if (userDoc.exists) {
            const userData = userDoc.data();
            payload.email = userPayload.email;
            payload.role = userPayload.role || userData?.role || "user";
            payload.uuid = userData?.uuid; // Include UUID in JWT payload
          }
        }
      } catch (error) {
        // If auth cookie is invalid, continue with anonymous token
        // This allows graceful degradation for expired/invalid sessions
        // Invalid auth cookie is expected for anonymous users - issue anonymous token
        console.log("Invalid auth cookie, issuing anonymous token");
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
