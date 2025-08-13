import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";

// Mock JWT wrapper to bypass 401 from missing Authorization and allow our role header to be read by authz
jest.mock("@/utils/server/jwtUtils", () => ({
  withJwtAuth: (handler: any) => handler,
}));

// Provide a truthy db object so handler doesn't 503 before role check
jest.mock("@/services/firebase", () => ({
  db: {},
}));

// Bypass rate limiter in this test
jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
}));

import addUserHandler from "@/pages/api/admin/addUser";
import resendActivationHandler from "@/pages/api/admin/resendActivation";
import listPendingUsersHandler from "@/pages/api/admin/listPendingUsers";

describe("Admin endpoints - non-admin forbidden", () => {
  it("/api/admin/addUser returns 403 when role=user (non-admin)", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { email: "test@example.com" },
      headers: { "x-test-role": "user" },
    });

    await addUserHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: "Forbidden" });
  });

  it("/api/admin/resendActivation returns 403 when role=user (non-admin)", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      headers: { "x-test-role": "user" },
      body: { email: "pending@example.com" },
    });

    await resendActivationHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: "Forbidden" });
  });

  it("/api/admin/listPendingUsers returns 403 when role=user (non-admin)", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
      headers: { "x-test-role": "user" },
    });

    await listPendingUsersHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: "Forbidden" });
  });
});
