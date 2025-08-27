import type { NextApiRequest } from "next";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { JwtPayload } from "@/utils/server/jwtUtils";

/**
 * Securely retrieves UUID based on site configuration and authentication status
 *
 * For authenticated sites (requireLogin: true):
 * - Uses UUID from JWT token payload (secure, cryptographically signed)
 *
 * For anonymous sites (requireLogin: false):
 * - Uses UUID from cookies (allows anonymous users)
 *
 * @param req - Next.js API request object
 * @param userPayload - Verified JWT payload (if authenticated)
 * @returns Object with success/error status and UUID or error message
 */
export function getSecureUUID(
  req: NextApiRequest,
  userPayload?: JwtPayload
): { success: true; uuid: string } | { success: false; error: string; statusCode: number } {
  const siteConfig = loadSiteConfigSync();

  if (siteConfig?.requireLogin) {
    // For authenticated sites: Use secure UUID from JWT token
    if (!userPayload?.uuid) {
      return {
        success: false,
        error: "UUID not found in authentication token",
        statusCode: 400,
      };
    }
    return { success: true, uuid: userPayload.uuid };
  } else {
    // For anonymous sites: Use UUID from cookies
    const uuid = req.cookies?.["uuid"];
    if (!uuid) {
      return {
        success: false,
        error: "UUID not found in cookies",
        statusCode: 400,
      };
    }
    return { success: true, uuid };
  }
}

/**
 * Type guard to check if the result is successful
 */
export function isUUIDSuccess(result: ReturnType<typeof getSecureUUID>): result is { success: true; uuid: string } {
  return result.success;
}
