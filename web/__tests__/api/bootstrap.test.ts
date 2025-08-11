import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/admin/bootstrap";

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

// Mock loadSiteConfigSync
jest.mock("@/utils/server/loadSiteConfig", () => ({
  loadSiteConfigSync: jest.fn(() => ({ name: "Test Site" })),
}));

describe("/api/admin/bootstrap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables
    process.env.ADMIN_BOOTSTRAP_SUPERUSERS = undefined;
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

  it("should return 404 when bootstrap is disabled", async () => {
    // Environment variable is already undefined from beforeEach
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({
      error: "Bootstrap disabled",
    });
  });

  it("should successfully create superuser accounts", async () => {
    const firestoreRetryUtils = await import("@/utils/server/firestoreRetryUtils");

    // Set environment variables for bootstrap
    process.env.ENABLE_ADMIN_BOOTSTRAP = "true";
    process.env.ADMIN_BOOTSTRAP_SUPERUSERS = "admin1@example.com,admin2@example.com";

    // Mock users don't exist
    (firestoreRetryUtils.firestoreGet as jest.MockedFunction<any>)
      .mockResolvedValueOnce({ exists: false }) // admin1
      .mockResolvedValueOnce({ exists: false }); // admin2

    // Mock successful firestore sets
    (firestoreRetryUtils.firestoreSet as jest.MockedFunction<any>)
      .mockResolvedValueOnce(undefined) // admin1
      .mockResolvedValueOnce(undefined); // admin2

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: "ok",
      results: {
        "admin1@example.com": "created",
        "admin2@example.com": "created",
      },
    });

    // Verify both users were created
    expect(firestoreRetryUtils.firestoreSet).toHaveBeenCalledTimes(2);
    expect(firestoreRetryUtils.firestoreSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: "admin1@example.com",
        roles: ["superuser"],
        entitlements: { basic: true },
        inviteStatus: "accepted",
        createdAt: expect.anything(),
        updatedAt: expect.anything(),
        verifiedAt: expect.anything(),
      }),
      undefined,
      "bootstrap create"
    );
  });
});
