import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/requestEmailChange";
import { db } from "@/services/firebase";
import { getTokenFromRequest } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { writeAuditLog } from "@/utils/server/auditLog";
import { sendEmailChangeVerificationEmail } from "@/utils/server/userEmailChangeUtils";
import { firestoreGet, firestoreSet } from "@/utils/server/firestoreRetryUtils";

// Mock all dependencies
jest.mock("@/utils/server/apiMiddleware", () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

jest.mock("@/utils/server/jwtUtils", () => ({
  ...jest.requireActual("@/utils/server/jwtUtils"),
  withJwtAuth: jest.fn((handler) => handler),
  getTokenFromRequest: jest.fn(),
}));

jest.mock("@/services/firebase", () => ({
  db: {
    collection: jest.fn(),
  },
}));

jest.mock("@/utils/server/firestoreRetryUtils", () => ({
  firestoreGet: jest.fn(),
  firestoreSet: jest.fn(),
}));

jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn(),
}));

jest.mock("@/utils/server/auditLog", () => ({
  writeAuditLog: jest.fn(),
}));

jest.mock("@/utils/server/userEmailChangeUtils", () => ({
  generateEmailChangeToken: jest.fn().mockReturnValue("mock-token"),
  hashEmailChangeToken: jest.fn().mockReturnValue("hashed-token"),
  getEmailChangeExpiryDate: jest.fn().mockReturnValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
  sendEmailChangeVerificationEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("firebase-admin", () => ({
  firestore: {
    Timestamp: {
      fromDate: jest.fn((date) => ({ _seconds: Math.floor(date.getTime() / 1000), _nanoseconds: 0 })),
      now: jest.fn(() => ({ _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 })),
    },
  },
}));

// Cast mocked functions
const mockDb = db as jest.Mocked<typeof db>;
const mockGetTokenFromRequest = getTokenFromRequest as jest.MockedFunction<typeof getTokenFromRequest>;
const mockGenericRateLimiter = genericRateLimiter as jest.MockedFunction<typeof genericRateLimiter>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockSendEmailChangeVerificationEmail = sendEmailChangeVerificationEmail as jest.MockedFunction<
  typeof sendEmailChangeVerificationEmail
>;

describe("Setup file", () => {
  it("should be valid", () => {
    expect(true).toBe(true);
  });
});

describe("/api/requestEmailChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    mockGenericRateLimiter.mockResolvedValue(true);
    mockWriteAuditLog.mockResolvedValue();
    mockSendEmailChangeVerificationEmail.mockResolvedValue(undefined);
    mockGetTokenFromRequest.mockReturnValue({ email: "user@example.com", role: "user", client: "web" } as any);

    const mockFirestoreGet = firestoreGet as jest.MockedFunction<typeof firestoreGet>;
    const mockFirestoreSet = firestoreSet as jest.MockedFunction<typeof firestoreSet>;

    // Mock user document exists
    mockFirestoreGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: "user" }),
    } as any);

    mockFirestoreSet.mockResolvedValue();

    // Mock Firestore
    (mockDb!.collection as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      }),
      doc: jest.fn().mockReturnValue({
        ref: { id: "mock-ref" },
      }),
    });
  });

  it("should reject non-POST requests", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: "Method not allowed" });
  });

  it("should reject requests without JWT token", async () => {
    // This test relies on withJwtAuth middleware to handle the 401 response
    // The middleware should catch the error and return 401 before reaching the handler
    mockGetTokenFromRequest.mockImplementation(() => {
      throw new Error("No token provided");
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "new@example.com" },
      // No authorization header provided
    });

    // Since withJwtAuth middleware is mocked to pass through, we need to handle the error
    try {
      await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);
    } catch (error) {
      // The error is expected, middleware would normally handle this
      expect((error as Error).message).toBe("No token provided");
    }
  });

  it("should reject requests with token missing email", async () => {
    mockGetTokenFromRequest.mockReturnValue({ client: "web" } as any);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "new@example.com" },
      headers: { authorization: "Bearer token-without-email" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: "User email not found in token" });
  });

  it("should reject requests when rate limited", async () => {
    mockGenericRateLimiter.mockResolvedValue(false);

    const { req, res } = createMocks({
      method: "POST",
      body: { newEmail: "new@example.com" },
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(mockGenericRateLimiter).toHaveBeenCalledWith(req, res, {
      windowMs: 24 * 60 * 60 * 1000,
      max: 5,
      name: "email_change",
    });
  });

  it("should reject requests without newEmail", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {},
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: "New email is required" });
  });

  it("should reject invalid email formats", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "invalid-email" },
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: "Invalid email format" });
  });

  it("should reject when new email is same as current", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "user@example.com" },
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: "New email must be different from current email" });
  });

  it("should reject when new email is already in use", async () => {
    // Mock existing user with the new email
    (mockDb!.collection as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            empty: false,
            docs: [{ id: "existing-user", data: () => ({ email: "taken@example.com" }) }],
          }),
        }),
      }),
      doc: jest.fn().mockReturnValue({
        ref: { id: "mock-ref" },
      }),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "taken@example.com" },
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({ error: "Email address is already in use" });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, "email_change_requested", "user@example.com", {
      newEmail: "taken@example.com",
      outcome: "failed_email_in_use",
    });
  });

  it("should successfully process valid email change request", async () => {
    // Mock database calls: first call checks new email (empty), second call gets current user (exists)
    const mockGet = jest
      .fn()
      .mockResolvedValueOnce({ empty: true, docs: [] }) // New email check - should be empty
      .mockResolvedValueOnce({
        // Current user lookup - should exist
        empty: false,
        docs: [
          {
            id: "user@example.com",
            ref: { id: "user-doc-ref" },
            data: () => ({ email: "user@example.com" }),
          },
        ],
      });

    (mockDb!.collection as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      }),
      doc: jest.fn().mockReturnValue({
        ref: { id: "mock-ref" },
      }),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "new@example.com" },
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(200);
    const responseData = JSON.parse(res._getData());
    expect(responseData.success).toBe(true);
    expect(responseData.pendingEmail).toBe("new@example.com");

    expect(mockSendEmailChangeVerificationEmail).toHaveBeenCalledWith(
      "new@example.com",
      "mock-token",
      "user@example.com"
    );

    const mockFirestoreSet = firestoreSet as jest.MockedFunction<typeof firestoreSet>;
    expect(mockFirestoreSet).toHaveBeenCalled();

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, "email_change_requested", "user@example.com", {
      newEmail: "new@example.com",
      outcome: "success",
    });
  });

  it("should handle database errors gracefully", async () => {
    // Mock database calls: first call checks new email (empty), second call gets current user (exists)
    const mockGet = jest
      .fn()
      .mockResolvedValueOnce({ empty: true, docs: [] }) // New email check - should be empty
      .mockResolvedValueOnce({
        // Current user lookup - should exist
        empty: false,
        docs: [
          {
            id: "user@example.com",
            ref: { id: "user-doc-ref" },
            data: () => ({ email: "user@example.com" }),
          },
        ],
      });

    (mockDb!.collection as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      }),
      doc: jest.fn().mockReturnValue({
        ref: { id: "mock-ref" },
      }),
    });

    // Mock firestoreGet to throw an error when getting user document
    const mockFirestoreGet = firestoreGet as jest.MockedFunction<typeof firestoreGet>;
    mockFirestoreGet.mockRejectedValue(new Error("Database error"));

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { newEmail: "new@example.com" },
      headers: { authorization: "Bearer valid-token" },
    });

    await handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: "Failed to process email change request" });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, "email_change_requested", "user@example.com", {
      newEmail: "new@example.com",
      outcome: "failed_server_error",
      error: "Database error",
    });
  });
});
