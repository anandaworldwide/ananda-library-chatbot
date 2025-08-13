import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";

// Wrap middleware to no-op so we can control auth in test
jest.mock("@/utils/server/jwtUtils", () => ({
  withJwtAuth: (handler: any) => handler,
  verifyToken: jest.fn(),
}));

// Mock firebase-admin timestamps used by handler
jest.mock("firebase-admin", () => ({
  firestore: {
    Timestamp: {
      now: jest.fn(() => ({ seconds: 1, nanoseconds: 0 })),
      fromDate: jest.fn((date: Date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 })),
    },
  },
}));

// Users collection name
jest.mock("@/utils/server/firestoreUtils", () => ({
  getUsersCollectionName: jest.fn(() => "test_users"),
}));

// Minimal DB mock with internal state
jest.mock("@/services/firebase", () => {
  const __docMap: Record<string, any> = {};
  const collection = jest.fn(() => ({
    doc: jest.fn((id: string) => ({
      get: jest.fn(async () => {
        const entry = __docMap[id];
        if (entry === undefined) return { exists: false, data: () => ({}) };
        return { exists: true, data: () => entry };
      }),
      set: jest.fn(async (_data: any) => {
        __docMap[id] = { ...(__docMap[id] || {}), ..._data };
        return undefined;
      }),
    })),
  }));
  return { db: { collection } };
});

import handler from "@/pages/api/admin/users/[userId]";

describe("/api/admin/users/[userId] role change authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows superuser to change role", async () => {
    const jwtUtils = await import("@/utils/server/jwtUtils");
    (jwtUtils.verifyToken as jest.Mock).mockReturnValue({ email: "super@example.com", role: "superuser" });

    // Target user id
    const targetEmail = "target@example.com";

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "PATCH",
      query: { userId: targetEmail },
      cookies: { auth: "token" },
      body: { role: "admin" },
    });

    await handler(req, res);
    // withApiMiddleware returns void/Promise<void>; assertions on res
    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.user.email).toBe(targetEmail);
    expect(["admin", "superuser", "user"]).toContain(data.user.role);
  });

  it("rejects admin attempting to change role (403)", async () => {
    const jwtUtils = await import("@/utils/server/jwtUtils");
    (jwtUtils.verifyToken as jest.Mock).mockReturnValue({ email: "admin@example.com", role: "admin" });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "PATCH",
      query: { userId: "target@example.com" },
      cookies: { auth: "token" },
      body: { role: "superuser" },
    });

    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: "Only superuser may change role" });
  });

  it("rejects invalid role with 400", async () => {
    const jwtUtils = await import("@/utils/server/jwtUtils");
    (jwtUtils.verifyToken as jest.Mock).mockReturnValue({ email: "super@example.com", role: "superuser" });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "PATCH",
      query: { userId: "target@example.com" },
      cookies: { auth: "token" },
      body: { role: "owner" },
    });

    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({ error: "Invalid role" });
  });
});
