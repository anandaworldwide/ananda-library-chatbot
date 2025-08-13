// Authorization tests for /api/admin/listActiveUsers

jest.mock("@/services/firebase", () => ({
  db: {
    collection: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [] }),
  },
}));

// Bypass rate limiter in middleware chain
jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
  deleteRateLimitCounter: jest.fn(),
}));

import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/admin/listActiveUsers";

describe("listActiveUsers authorization", () => {
  it("returns 401 when missing Authorization header", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res._getJSONData()).toEqual({ error: "No token provided" });
  });
});
