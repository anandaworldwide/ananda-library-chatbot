import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/auth/verifyAccess";

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
      now: jest.fn(() => ({ seconds: 1640995200, nanoseconds: 0 })),
      fromDate: jest.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 })),
    },
  },
}));

// Mock API middleware
jest.mock("@/utils/server/apiMiddleware", () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

// Mock rate limiter
jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
}));

// Mock user invite utils
jest.mock("@/utils/server/userInviteUtils", () => ({
  generateInviteToken: jest.fn(() => "test-token"),
  hashInviteToken: jest.fn(() => Promise.resolve("hashed-token")),
  getInviteExpiryDate: jest.fn(() => new Date()),
  sendActivationEmail: jest.fn(() => Promise.resolve()),
}));

// Mock bcrypt
jest.mock("bcryptjs", () => ({
  compare: jest.fn(() => Promise.resolve(true)),
}));

// Mock environment variables
const originalEnv = process.env;
beforeAll(() => {
  process.env = {
    ...originalEnv,
    SITE_PASSWORD: "hashed-site-password",
  };
});

afterAll(() => {
  process.env = originalEnv;
});

// Mock Firestore utils
jest.mock("@/utils/server/firestoreRetryUtils", () => ({
  firestoreGet: jest.fn(),
  firestoreSet: jest.fn(),
}));

// Mock audit log
jest.mock("@/utils/server/auditLog", () => ({
  writeAuditLog: jest.fn(),
}));

describe("Setup file", () => {
  it("should be valid", () => {
    expect(true).toBe(true);
  });
});

describe("/api/auth/verifyAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 405 for non-POST requests", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it("should return 400 for missing email", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {},
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it("should create new user with newsletter defaulted to true", async () => {
    const firestoreRetryUtils = await import("@/utils/server/firestoreRetryUtils");
    const userInviteUtils = await import("@/utils/server/userInviteUtils");
    const auditLog = await import("@/utils/server/auditLog");

    // Mock user doesn't exist
    (firestoreRetryUtils.firestoreGet as jest.MockedFunction<any>).mockResolvedValueOnce({
      exists: false,
    });

    // Mock successful firestore set
    (firestoreRetryUtils.firestoreSet as jest.MockedFunction<any>).mockResolvedValueOnce(undefined);

    // Mock successful email sending
    (userInviteUtils.sendActivationEmail as jest.MockedFunction<any>).mockResolvedValueOnce(undefined);

    // Mock audit log
    (auditLog.writeAuditLog as jest.MockedFunction<any>).mockResolvedValueOnce(undefined);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {
        email: "test@example.com",
        sharedPassword: "test-password",
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: "created",
    });

    expect(firestoreRetryUtils.firestoreSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: "test@example.com",
        role: "user",
        entitlements: { basic: true },
        inviteStatus: "pending",
        newsletterSubscribed: true, // Should default to true
      }),
      undefined,
      "create user via verify access"
    );

    expect(userInviteUtils.sendActivationEmail).toHaveBeenCalledWith(
      "test@example.com",
      "test-token",
      expect.any(Object)
    );
  });

  it("should resend activation for existing pending user", async () => {
    const firestoreRetryUtils = await import("@/utils/server/firestoreRetryUtils");
    const userInviteUtils = await import("@/utils/server/userInviteUtils");
    const auditLog = await import("@/utils/server/auditLog");

    // Mock user exists and is pending
    (firestoreRetryUtils.firestoreGet as jest.MockedFunction<any>).mockResolvedValueOnce({
      exists: true,
      data: () => ({
        inviteStatus: "pending",
      }),
    });

    // Mock successful firestore set
    (firestoreRetryUtils.firestoreSet as jest.MockedFunction<any>).mockResolvedValueOnce(undefined);

    // Mock successful email sending
    (userInviteUtils.sendActivationEmail as jest.MockedFunction<any>).mockResolvedValueOnce(undefined);

    // Mock audit log
    (auditLog.writeAuditLog as jest.MockedFunction<any>).mockResolvedValueOnce(undefined);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {
        email: "test@example.com",
        sharedPassword: "test-password",
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: "activation-resent",
    });
  });

  it("should return already active for accepted users", async () => {
    const firestoreRetryUtils = await import("@/utils/server/firestoreRetryUtils");

    // Mock user exists and is already accepted
    (firestoreRetryUtils.firestoreGet as jest.MockedFunction<any>).mockResolvedValueOnce({
      exists: true,
      data: () => ({
        inviteStatus: "accepted",
      }),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {
        email: "test@example.com",
        sharedPassword: "test-password",
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: "already active",
    });
  });
});
