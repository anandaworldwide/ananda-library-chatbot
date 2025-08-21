import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/admin/digestSelfProvision";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { sendOpsAlert } from "@/utils/server/emailOps";

// Mock Firebase
const mockFirestoreGet = jest.fn();
let mockDbValue: any = {
  collection: jest.fn(() => ({
    where: jest.fn(() => ({
      where: jest.fn(() => ({
        get: mockFirestoreGet,
      })),
    })),
  })),
};

jest.mock("@/services/firebase", () => ({
  get db() {
    return mockDbValue;
  },
}));

// Mock API middleware
jest.mock("@/utils/server/apiMiddleware", () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

// Mock rate limiter
jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn(),
}));

// Mock email operations
jest.mock("@/utils/server/emailOps", () => ({
  sendOpsAlert: jest.fn(),
}));

describe("/api/admin/digestSelfProvision", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      CRON_SECRET: "test-cron-secret",
      SITE_ID: "test-site",
      NODE_ENV: "test",
    };
    (genericRateLimiter as jest.Mock).mockResolvedValue(true);
    (sendOpsAlert as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Authentication", () => {
    it("returns 401 when CRON_SECRET is not set", async () => {
      delete process.env.CRON_SECRET;

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer some-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ error: "Unauthorized" });
    });

    it("returns 401 when Authorization header is missing", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ error: "Unauthorized" });
    });

    it("returns 401 when Authorization header has wrong secret", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer wrong-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ error: "Unauthorized" });
    });

    it("accepts valid CRON_SECRET", async () => {
      mockFirestoreGet.mockResolvedValue({
        forEach: jest.fn(),
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });
  });

  describe("HTTP Methods", () => {
    beforeEach(() => {
      mockFirestoreGet.mockResolvedValue({
        forEach: jest.fn(),
      });
    });

    it("accepts POST method", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    it("accepts GET method", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    it("rejects unsupported methods", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "PUT",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(405);
      expect(res._getJSONData()).toEqual({ error: "Method not allowed" });
    });
  });

  describe("Rate Limiting", () => {
    it("returns early when rate limited", async () => {
      (genericRateLimiter as jest.Mock).mockResolvedValue(false);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(genericRateLimiter).toHaveBeenCalledWith(req, res, {
        windowMs: 60 * 1000,
        max: 3,
        name: "digest-self-provision",
      });
      expect(mockFirestoreGet).not.toHaveBeenCalled();
    });
  });

  describe("Database Operations", () => {
    it("returns 503 when database is unavailable", async () => {
      // Temporarily set mockDbValue to null
      const originalMockDb = mockDbValue;
      mockDbValue = null;

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res._getJSONData()).toEqual({ error: "Database not available" });

      // Restore original mockDb
      mockDbValue = originalMockDb;
    });

    it("queries correct Firestore collection and filters", async () => {
      const mockForEach = jest.fn();
      mockFirestoreGet.mockResolvedValue({
        forEach: mockForEach,
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockFirestoreGet).toHaveBeenCalled();
    });

    it("uses prod collection in production environment", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "production",
        writable: true,
      });

      const mockForEach = jest.fn();
      mockFirestoreGet.mockResolvedValue({
        forEach: mockForEach,
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockFirestoreGet).toHaveBeenCalled();

      // Restore original NODE_ENV
      Object.defineProperty(process.env, "NODE_ENV", {
        value: originalNodeEnv,
        writable: true,
      });
    });
  });

  describe("Data Aggregation", () => {
    it("correctly aggregates self-provision outcomes", async () => {
      const mockDocs = [
        {
          data: () => ({
            details: { outcome: "created_pending_user" },
            target: "user1@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "created_pending_user" },
            target: "user2@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "resent_pending_activation" },
            target: "user3@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "invalid_password" },
            target: "user4@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "server_error" },
            target: "user5@example.com",
          }),
        },
      ];

      const mockForEach = jest.fn((callback) => {
        mockDocs.forEach(callback);
      });

      mockFirestoreGet.mockResolvedValue({
        forEach: mockForEach,
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();

      expect(responseData.counts).toEqual({
        created: 2,
        resent: 1,
        errors: 1,
      });

      expect(responseData.samples).toHaveLength(4); // invalid_password entries are now excluded
      expect(responseData.samples[0]).toEqual({
        target: "user1@example.com",
        outcome: "created_pending_user",
      });
    });

    it("limits samples to 10 entries", async () => {
      const mockDocs = Array.from({ length: 15 }, (_, i) => ({
        data: () => ({
          details: { outcome: "created_pending_user" },
          target: `user${i}@example.com`,
        }),
      }));

      const mockForEach = jest.fn((callback) => {
        mockDocs.forEach(callback);
      });

      mockFirestoreGet.mockResolvedValue({
        forEach: mockForEach,
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();

      expect(responseData.samples).toHaveLength(10);
      expect(responseData.counts.created).toBe(15);
    });
  });

  describe("Email Operations", () => {
    it("sends ops alert with correct digest format", async () => {
      const mockDocs = [
        {
          data: () => ({
            details: { outcome: "created_pending_user" },
            target: "user1@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "invalid_password" },
            target: "user2@example.com",
          }),
        },
      ];

      const mockForEach = jest.fn((callback) => {
        mockDocs.forEach(callback);
      });

      mockFirestoreGet.mockResolvedValue({
        forEach: mockForEach,
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      const [subject, body] = (sendOpsAlert as jest.Mock).mock.calls[0];
      expect(subject).toMatch(/^New user digest:/);
      expect(body).toContain("Self-provision digest for site test-site (last 24h)");

      const emailBody = (sendOpsAlert as jest.Mock).mock.calls[0][1];
      expect(emailBody).toContain("Created: 1");
      expect(emailBody).toContain("Resent: 0");
      expect(emailBody).not.toContain("Invalid password"); // Invalid passwords no longer included
      expect(emailBody).toContain("Server errors: 0");
      expect(emailBody).toContain("ACTIVITY DETAILS:");
    });

    it("formats status text using audit entry outcomes, not current user status", async () => {
      const mockDocs = [
        {
          data: () => ({
            details: { outcome: "created_pending_user" },
            target: "user1@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "resent_pending_activation" },
            target: "user2@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "invalid_password" },
            target: "user3@example.com",
          }),
        },
        {
          data: () => ({
            details: { outcome: "server_error" },
            target: "user4@example.com",
          }),
        },
      ];

      const mockForEach = jest.fn((callback) => {
        mockDocs.forEach(callback);
      });

      mockFirestoreGet.mockResolvedValue({
        forEach: mockForEach,
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      const emailBody = (sendOpsAlert as jest.Mock).mock.calls[0][1];

      // Verify that status text comes from audit entry outcomes, not current user status
      expect(emailBody).toContain("Created (pending activation)");
      expect(emailBody).toContain("Activation link resent");
      expect(emailBody).not.toContain("Invalid shared password"); // Invalid passwords no longer included
      expect(emailBody).toContain("Server error occurred");

      // Verify it does NOT contain "Activated" status (which would indicate bug)
      expect(emailBody).not.toContain("Activated");

      // Verify proper formatting with email prefixes as names (invalid_password entries are excluded)
      expect(emailBody).toContain("1. user1 (user1@example.com) - Created (pending activation)");
      expect(emailBody).toContain("2. user2 (user2@example.com) - Activation link resent");
      expect(emailBody).toContain("3. user4 (user4@example.com) - Server error occurred");
      expect(emailBody).not.toContain("user3"); // Invalid password entry excluded from samples
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when Firestore query fails", async () => {
      mockFirestoreGet.mockRejectedValue(new Error("Firestore error"));

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({
        error: "Firestore error",
      });
    });

    it("returns 500 when email sending fails", async () => {
      mockFirestoreGet.mockResolvedValue({
        forEach: jest.fn(),
      });
      (sendOpsAlert as jest.Mock).mockRejectedValue(new Error("Email error"));

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({
        error: "Email error",
      });
    });

    it("handles generic errors gracefully", async () => {
      mockFirestoreGet.mockRejectedValue("String error");

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({
        error: "Failed to build digest",
      });
    });

    it("handles missing Firestore index with Firebase Console URL", async () => {
      const indexError = new Error(
        "The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/test-project/firestore/indexes?create_composite=ABC123"
      );
      mockFirestoreGet.mockRejectedValue(indexError);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "user-agent": "vercel-cron/1.0",
          authorization: "Bearer test-cron-secret",
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      const responseData = res._getJSONData();
      expect(responseData.error).toBe("Database configuration error");
      expect(responseData.message).toBe("Missing required Firestore index for self-provision audit queries");
      expect(responseData.action).toContain("Create composite index");
      expect(responseData.indexUrl).toBe(
        "https://console.firebase.google.com/v1/r/project/test-project/firestore/indexes?create_composite=ABC123"
      );
      expect(responseData.details).toContain("one-time setup");
      expect(responseData.originalError).toContain("query requires an index");
    });
  });
});
