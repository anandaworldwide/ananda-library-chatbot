import { createMocks } from "node-mocks-http";
import { verifyToken } from "@/utils/server/jwtUtils";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { firestoreQueryGet } from "@/utils/server/firestoreRetryUtils";
import { db } from "@/services/firebase";

// Mock dependencies
jest.mock("@/utils/server/jwtUtils");
jest.mock("@/utils/server/genericRateLimiter");
jest.mock("@/utils/server/firestoreRetryUtils");
jest.mock("@/services/firebase");
jest.mock("@/utils/server/firestoreUtils");

const mockVerifyToken = verifyToken as jest.MockedFunction<typeof verifyToken>;
const mockGenericRateLimiter = genericRateLimiter as jest.MockedFunction<typeof genericRateLimiter>;
const mockFirestoreQueryGet = firestoreQueryGet as jest.MockedFunction<typeof firestoreQueryGet>;
const mockDb = db as any;

// Mock getAnswersCollectionName
jest.mock("@/utils/server/firestoreUtils", () => ({
  getAnswersCollectionName: jest.fn().mockReturnValue("test_chatLogs"),
}));

// Mock firebase-admin
jest.mock("firebase-admin", () => {
  const firestoreFn = jest.fn(() => ({
    collection: jest.fn(),
    batch: jest.fn(),
  }));
  // Attach static FieldValue property on the function so calls to firebase.firestore.FieldValue work
  (firestoreFn as any).FieldValue = {
    serverTimestamp: jest.fn().mockReturnValue("mock-timestamp"),
  };

  return {
    apps: [{}],
    firestore: firestoreFn,
    credential: {
      cert: jest.fn(),
    },
    initializeApp: jest.fn(),
  };
});

describe("/api/conversations/[convId]", () => {
  let handler: typeof import("@/pages/api/conversations/[convId]").default;

  beforeAll(async () => {
    handler = (await import("@/pages/api/conversations/[convId]")).default;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    mockGenericRateLimiter.mockResolvedValue(true);

    // Mock database operations
    const mockCollection = {
      where: jest.fn().mockReturnThis(),
    };
    mockDb.collection = jest.fn().mockReturnValue(mockCollection);

    const mockBatch = {
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue({}),
    };
    mockDb.batch = jest.fn().mockReturnValue(mockBatch);
  });

  describe("PATCH /api/conversations/[convId] (rename)", () => {
    it("should rename a conversation successfully", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
        body: { title: "New Conversation Title" },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      const mockDocs = [
        { ref: { update: jest.fn() }, id: "doc1" },
        { ref: { update: jest.fn() }, id: "doc2" },
      ];

      mockFirestoreQueryGet.mockResolvedValue({
        empty: false,
        docs: mockDocs,
      } as any);

      await handler(req as any, res as any);

      if (res._getStatusCode() !== 200) {
        console.log("Error response:", res._getData());
      }
      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toEqual({
        message: "Conversation renamed successfully",
        title: "New Conversation Title",
        updatedDocuments: 2,
      });
    });

    it("should return 400 for empty title", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
        body: { title: "" },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Title is required and must be non-empty",
      });
    });

    it("should return 400 for title too long", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
        body: { title: "a".repeat(101) },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Title must be 100 characters or less",
      });
    });

    it("should return 404 for non-existent conversation", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "non-existent-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
        body: { title: "New Title" },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      mockFirestoreQueryGet.mockResolvedValue({
        empty: true,
        docs: [],
      } as any);

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(404);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Conversation not found or access denied",
      });
    });
  });

  describe("DELETE /api/conversations/[convId]", () => {
    it("should delete a conversation successfully", async () => {
      const { req, res } = createMocks({
        method: "DELETE",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      const mockDocs = [
        { ref: { delete: jest.fn() }, id: "doc1" },
        { ref: { delete: jest.fn() }, id: "doc2" },
      ];

      mockFirestoreQueryGet.mockResolvedValue({
        empty: false,
        docs: mockDocs,
      } as any);

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(200);
      expect(JSON.parse(res._getData())).toEqual({
        message: "Conversation deleted successfully",
        deletedDocuments: 2,
      });
    });

    it("should return 404 for non-existent conversation", async () => {
      const { req, res } = createMocks({
        method: "DELETE",
        query: { convId: "non-existent-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      mockFirestoreQueryGet.mockResolvedValue({
        empty: true,
        docs: [],
      } as any);

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(404);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Conversation not found or access denied",
      });
    });
  });

  describe("Authentication", () => {
    it("should return 401 for missing authorization header", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "test-conv-id" },
        body: { title: "New Title" },
      });

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Authorization header required",
      });
    });

    it("should return 401 for invalid token", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer invalid-token" },
        body: { title: "New Title" },
      });

      mockVerifyToken.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(401);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Invalid or expired token",
      });
    });
  });

  describe("Rate limiting", () => {
    it("should respect rate limiting", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
        body: { title: "New Title" },
      });

      mockGenericRateLimiter.mockResolvedValue(false);

      await handler(req as any, res as any);

      // Rate limiter should handle the response
      expect(mockGenericRateLimiter).toHaveBeenCalledWith(req, res, {
        windowMs: 60 * 1000,
        max: 30,
        name: "conversation-operations",
      });
    });
  });

  describe("Method validation", () => {
    it("should return 405 for unsupported methods", async () => {
      const { req, res } = createMocks({
        method: "GET",
        query: { convId: "test-conv-id" },
        headers: { authorization: "Bearer valid-token" },
        cookies: { uuid: "test-uuid" },
      });

      mockVerifyToken.mockReturnValue({
        email: "test@example.com",
        uuid: "test-uuid",
      } as any);

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(405);
      expect(JSON.parse(res._getData())).toEqual({
        error: "Method not allowed",
      });
      expect(res.getHeader("Allow")).toEqual(["PATCH", "DELETE"]);
    });
  });

  describe("Input validation", () => {
    it("should return 400 for missing convId", async () => {
      const { req, res } = createMocks({
        method: "PATCH",
        query: {},
        headers: { authorization: "Bearer valid-token" },
        body: { title: "New Title" },
      });

      await handler(req as any, res as any);

      expect(res._getStatusCode()).toBe(400);
      expect(JSON.parse(res._getData())).toEqual({
        error: "convId parameter is required",
      });
    });
  });
});
