import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/verifyMagicLink";

// Mock Firebase
jest.mock("@/services/firebase", () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({})),
    })),
  },
}));

// Mock firebase-admin
jest.mock("firebase-admin", () => ({
  firestore: {
    Timestamp: {
      now: jest.fn(() => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 })),
      fromDate: jest.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 })),
    },
  },
}));

// Mock bcrypt
jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
}));

// Mock JWT utils
jest.mock("@/utils/server/jwtUtils", () => ({
  signToken: jest.fn(() => "mock-jwt-token"),
}));

// Mock API middleware
jest.mock("@/utils/server/apiMiddleware", () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

// Mock Firestore utils
jest.mock("@/utils/server/firestoreRetryUtils", () => ({
  firestoreGet: jest.fn(),
  firestoreSet: jest.fn(),
}));

// Mock getUsersCollectionName
jest.mock("@/utils/server/firestoreUtils", () => ({
  getUsersCollectionName: jest.fn(() => "test_users"),
}));

describe("/api/verifyMagicLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set JWT secret for testing
    process.env.JWT_SECRET = "test-jwt-secret";
  });

  it("should return 405 for non-POST requests", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res._getJSONData()).toEqual({
      error: "Method not allowed",
    });
  });

  it("should return 400 for missing token", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {
        email: "test@example.com",
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: "Missing token or email",
    });
  });

  it("should return 400 for non-existent user", async () => {
    const firestoreRetryUtils = await import("@/utils/server/firestoreRetryUtils");

    // Mock user doesn't exist
    (firestoreRetryUtils.firestoreGet as jest.MockedFunction<any>).mockResolvedValueOnce({
      exists: false,
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {
        token: "test-token",
        email: "nonexistent@example.com",
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._getJSONData()).toEqual({
      error: "User not found",
    });
  });

  it("should return 400 for invalid token", async () => {
    const firestoreRetryUtils = await import("@/utils/server/firestoreRetryUtils");
    const bcrypt = await import("bcryptjs");

    // Mock user exists with pending status
    (firestoreRetryUtils.firestoreGet as jest.MockedFunction<any>).mockResolvedValueOnce({
      exists: true,
      data: () => ({
        email: "test@example.com",
        inviteStatus: "pending",
        inviteTokenHash: "hashed-token",
        inviteExpiresAt: { toMillis: () => Date.now() + 86400000 }, // 24 hours from now
        roles: ["user"],
        entitlements: { basic: true },
      }),
    });

    // Mock token comparison failure
    (bcrypt.compare as jest.MockedFunction<any>).mockResolvedValueOnce(false);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {
        token: "wrong-token",
        email: "test@example.com",
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: "Invalid token",
    });
  });
});
