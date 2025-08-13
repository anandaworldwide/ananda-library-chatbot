/*
 * Admin page gating helper
 *
 * Purpose
 * - Enforce correct admin access model per site type.
 *
 * Rules
 * - Login sites (siteConfig.requireLogin === true):
 *     Require a valid auth JWT cookie with role of "admin" or "superuser".
 *     Sudo cookie is NOT used on these sites.
 * - No-login sites (siteConfig.requireLogin === false):
 *     Require a valid sudoCookie (set via the bless flow). There are no user logins,
 *     so JWT role checks are not applicable here.
 *
 * Usage
 * - Call from getServerSideProps for admin pages to return notFound when access is denied.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyToken } from "./jwtUtils";
import { getSudoCookie } from "./sudoCookieUtils";
import type { SiteConfig } from "@/types/siteConfig";

export function isAdminPageAllowed(
  req: NextApiRequest,
  res: NextApiResponse | undefined,
  siteConfig: SiteConfig | null
): boolean {
  const requireLogin = !!siteConfig?.requireLogin;
  if (requireLogin) {
    try {
      const cookieJwt = req.cookies?.["auth"];
      if (!cookieJwt) return false;
      const payload: any = verifyToken(cookieJwt);
      const role = typeof payload?.role === "string" ? (payload.role as string).toLowerCase() : "user";
      return role === "admin" || role === "superuser";
    } catch {
      return false;
    }
  }

  const sudo = getSudoCookie(req, res);
  return !!sudo.sudoCookieValue;
}

export function isSuperuserPageAllowed(
  req: NextApiRequest,
  res: NextApiResponse | undefined,
  siteConfig: SiteConfig | null
): boolean {
  const requireLogin = !!siteConfig?.requireLogin;
  if (requireLogin) {
    try {
      const cookieJwt = req.cookies?.["auth"];
      if (!cookieJwt) return false;
      const payload: any = verifyToken(cookieJwt);
      const role = typeof payload?.role === "string" ? (payload.role as string).toLowerCase() : "user";
      return role === "superuser";
    } catch {
      return false;
    }
  }

  const sudo = getSudoCookie(req, res);
  return !!sudo.sudoCookieValue;
}
