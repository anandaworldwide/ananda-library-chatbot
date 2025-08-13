import type { NextApiRequest } from "next";
import { getTokenFromRequest, verifyToken } from "./jwtUtils";

type Role = "user" | "admin" | "superuser";

export function getRequesterRole(req: NextApiRequest): Role {
  // Test-friendly override to avoid brittle JWT setup in unit tests
  if (process.env.NODE_ENV === "test") {
    const testRole = (req.headers["x-test-role"] as string | undefined)?.toLowerCase();
    if (testRole === "admin" || testRole === "superuser" || testRole === "user") {
      return testRole;
    }
  }

  try {
    // Prefer cookie when available
    const cookieJwt = req.cookies?.["auth"];
    if (cookieJwt) {
      const payload: any = verifyToken(cookieJwt);
      const role = typeof payload?.role === "string" ? (payload.role as string).toLowerCase() : "user";
      if (role === "admin" || role === "superuser") return role;
      return "user";
    }
  } catch {
    // fall through to header-based check
  }

  try {
    const headerPayload: any = getTokenFromRequest(req);
    const role = typeof headerPayload?.role === "string" ? (headerPayload.role as string).toLowerCase() : "user";
    if (role === "admin" || role === "superuser") return role;
    return "user";
  } catch {
    return "user";
  }
}

export function requireAdminRole(req: NextApiRequest): boolean {
  const role = getRequesterRole(req);
  return role === "admin" || role === "superuser";
}

export function requireSuperuserRole(req: NextApiRequest): boolean {
  const role = getRequesterRole(req);
  return role === "superuser";
}
