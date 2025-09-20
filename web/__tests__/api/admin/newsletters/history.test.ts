import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/admin/newsletters/history";
import * as firestoreRetryUtils from "@/utils/server/firestoreRetryUtils";
import * as firestoreUtils from "@/utils/server/firestoreUtils";
import * as authz from "@/utils/server/authz";
import * as genericRateLimiter from "@/utils/server/genericRateLimiter";

// Mock dependencies
jest.mock("@/services/firebase", () => ({
  db: {
    collection: jest.fn(() => ({
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          // Mock query
        })),
      })),
    })),
  },
}));

jest.mock("@/utils/server/firestoreRetryUtils");
jest.mock("@/utils/server/firestoreUtils");
jest.mock("@/utils/server/authz");
jest.mock("@/utils/server/genericRateLimiter");

// Mock JWT wrapper to no-op
jest.mock("@/utils/server/jwtUtils", () => ({
  withJwtAuth: (handler: any) => handler,
  verifyToken: jest.fn(),
  getTokenFromRequest: jest.fn(() => ({ email: "admin@example.com", role: "admin" })),
}));

const mockFirestoreQueryGet = firestoreRetryUtils.firestoreQueryGet as jest.MockedFunction<
  typeof firestoreRetryUtils.firestoreQueryGet
>;
const mockGetNewslettersCollectionName = firestoreUtils.getNewslettersCollectionName as jest.MockedFunction<
  typeof firestoreUtils.getNewslettersCollectionName
>;
const mockRequireSuperuserRole = authz.requireSuperuserRole as jest.MockedFunction<typeof authz.requireSuperuserRole>;
const mockGenericRateLimiter = genericRateLimiter.genericRateLimiter as jest.MockedFunction<
  typeof genericRateLimiter.genericRateLimiter
>;

describe("/api/admin/newsletters/history", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    mockGenericRateLimiter.mockResolvedValue(true);
    mockRequireSuperuserRole.mockImplementation(() => true);
    mockGetNewslettersCollectionName.mockReturnValue("test_newsletters");
  });

  it("should return 405 for non-GET requests", async () => {
    const { req, res } = createMocks({
      method: "POST",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: "Method not allowed" });
  });

  it("should return early if rate limit is exceeded", async () => {
    mockGenericRateLimiter.mockResolvedValue(false as any);

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req as any, res as any);

    // Rate limiter should handle the response
    expect(mockGenericRateLimiter).toHaveBeenCalledWith(req, res, {
      name: "newsletterHistory",
      max: 20,
      windowMs: 60 * 1000,
    });
  });

  it("should validate superuser role", async () => {
    mockRequireSuperuserRole.mockImplementation(() => {
      throw new Error("Unauthorized");
    });

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Failed to fetch newsletter history",
      details: "Unauthorized",
    });
  });

  it("should return empty newsletters list when no newsletters exist", async () => {
    mockFirestoreQueryGet.mockResolvedValue({
      docs: [],
    } as any);

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(200);
    const responseData = JSON.parse(res._getData());
    expect(responseData).toEqual({
      newsletters: [],
      total: 0,
    });
  });

  it("should return newsletters history successfully", async () => {
    const mockNewsletters = [
      {
        id: "newsletter1",
        data: () => ({
          subject: "Test Newsletter 1",
          content: "This is test content 1",
          sentAt: { toDate: () => new Date("2024-01-15T10:00:00Z") },
          sentBy: "admin@example.com",
          recipientCount: 100,
          successCount: 98,
          errorCount: 2,
          ctaUrl: "https://example.com",
          ctaText: "Click Here",
        }),
      },
      {
        id: "newsletter2",
        data: () => ({
          subject: "Test Newsletter 2",
          content: "This is test content 2",
          sentAt: { toDate: () => new Date("2024-01-10T15:30:00Z") },
          sentBy: "admin2@example.com",
          recipientCount: 50,
          successCount: 50,
          errorCount: 0,
        }),
      },
    ];

    mockFirestoreQueryGet.mockResolvedValue({
      docs: mockNewsletters,
    } as any);

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(200);
    const responseData = JSON.parse(res._getData());

    expect(responseData.newsletters).toHaveLength(2);
    expect(responseData.total).toBe(2);

    // Check first newsletter
    expect(responseData.newsletters[0]).toEqual({
      id: "newsletter1",
      subject: "Test Newsletter 1",
      content: "This is test content 1",
      sentAt: "2024-01-15T10:00:00.000Z",
      sentBy: "admin@example.com",
      recipientCount: 100,
      successCount: 98,
      errorCount: 2,
      ctaUrl: "https://example.com",
      ctaText: "Click Here",
    });

    // Check second newsletter
    expect(responseData.newsletters[1]).toEqual({
      id: "newsletter2",
      subject: "Test Newsletter 2",
      content: "This is test content 2",
      sentAt: "2024-01-10T15:30:00.000Z",
      sentBy: "admin2@example.com",
      recipientCount: 50,
      successCount: 50,
      errorCount: 0,
      ctaUrl: null,
      ctaText: null,
    });
  });

  it("should handle newsletters with missing optional fields", async () => {
    const mockNewsletters = [
      {
        id: "newsletter1",
        data: () => ({
          subject: "Basic Newsletter",
          content: "Basic content",
          sentAt: "2024-01-15T10:00:00Z", // String instead of Timestamp
          // Missing optional fields
        }),
      },
    ];

    mockFirestoreQueryGet.mockResolvedValue({
      docs: mockNewsletters,
    } as any);

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(200);
    const responseData = JSON.parse(res._getData());

    expect(responseData.newsletters[0]).toEqual({
      id: "newsletter1",
      subject: "Basic Newsletter",
      content: "Basic content",
      sentAt: "2024-01-15T10:00:00Z",
      sentBy: "unknown",
      recipientCount: 0,
      successCount: 0,
      errorCount: 0,
      ctaUrl: null,
      ctaText: null,
    });
  });

  it("should handle Firestore query errors", async () => {
    mockFirestoreQueryGet.mockRejectedValue(new Error("Database connection failed"));

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Failed to fetch newsletter history",
      details: "Database connection failed",
    });
  });
});
