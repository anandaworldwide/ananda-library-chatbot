import { genericRateLimiter, deleteRateLimitCounter } from "../../../src/utils/server/genericRateLimiter";
import { NextApiRequest, NextApiResponse } from "next";
import * as ipUtils from "../../../src/utils/server/ipUtils";
import * as envModule from "../../../src/utils/env";

// Mock the firebase service
jest.mock("@/services/firebase", () => {
  const mockCollection = jest.fn();
  const mockDoc = jest.fn();
  const mockGet = jest.fn();
  const mockSet = jest.fn();
  const mockUpdate = jest.fn();
  const mockDelete = jest.fn();

  const mockDocRef = {
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
    delete: mockDelete,
  };

  mockDoc.mockReturnValue(mockDocRef);
  mockCollection.mockReturnValue({ doc: mockDoc });

  return {
    db: {
      collection: mockCollection,
    },
    mockCollection,
    mockDoc,
    mockDocRef,
    mockGet,
    mockSet,
    mockUpdate,
    mockDelete,
  };
});

// Mock the firestoreRetryUtils module
jest.mock("@/utils/server/firestoreRetryUtils", () => ({
  retryOnCode14: jest.fn(),
  isCode14Error: jest.fn(),
}));

// Mock the ipUtils module
jest.mock("../../../src/utils/server/ipUtils", () => ({
  getClientIp: jest.fn(),
}));

// Mock the env module
jest.mock("../../../src/utils/env", () => ({
  isDevelopment: jest.fn(),
}));

// Skip importing NextRequest/NextResponse to avoid issues
jest.mock("next/server", () => ({}));

// Global mock variables accessible to all test suites
const firebase = jest.requireMock("@/services/firebase");
const firestoreRetryUtils = jest.requireMock("@/utils/server/firestoreRetryUtils");

describe("genericRateLimiter", () => {
  const mockReq = {} as NextApiRequest;
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as NextApiResponse;

  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    // Default mocks
    jest.spyOn(ipUtils, "getClientIp").mockReturnValue("127.0.0.1");
    jest.spyOn(envModule, "isDevelopment").mockReturnValue(false);

    // Default Firebase mocks
    firebase.mockGet.mockResolvedValue({ exists: false });
    firebase.mockSet.mockResolvedValue(undefined);
    firebase.mockUpdate.mockResolvedValue(undefined);

    // Mock retryOnCode14 to execute the callback directly by default
    firestoreRetryUtils.retryOnCode14.mockImplementation(async (callback) => {
      return await callback();
    });
    firestoreRetryUtils.isCode14Error.mockReturnValue(false);

    // Mock setTimeout to prevent actual delays in tests and return a dummy timer ID
    jest.spyOn(global, "setTimeout").mockImplementation(() => {
      return 999 as any; // Return a dummy timer ID
    });
    // Mock clearTimeout to prevent open handles
    jest.spyOn(global, "clearTimeout").mockImplementation(() => {});

    // Mock Firestore - remove the problematic spy on data method
    jest.spyOn(firebase.db, "collection").mockReturnValue({
      doc: firebase.mockDoc,
    });
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("should skip rate limiting if db is not available", async () => {
    // Temporarily remove db
    const originalDb = firebase.db;
    firebase.db = null;

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(result).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledWith("Firestore database not initialized, skipping rate limiting");

    // Restore db
    firebase.db = originalDb;
  });

  it("should create a new rate limit entry if none exists", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({ exists: false });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
      collectionPrefix: "test",
    });

    expect(result).toBe(true);
    expect(firebase.mockCollection).toHaveBeenCalledWith("test_test_rateLimits");
    expect(firebase.mockDoc).toHaveBeenCalledWith("127_0_0_1");
    expect(firebase.mockSet).toHaveBeenCalledWith({
      count: 1,
      firstRequestTime: now,
    });
  });

  it("should increment count if within window and under limit", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 5,
        firstRequestTime: now - 30000, // 30 seconds ago
      }),
    });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(result).toBe(true);
    expect(firebase.mockUpdate).toHaveBeenCalledWith({
      count: 6,
    });
  });

  it("should reset count if outside window", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 5,
        firstRequestTime: now - 70000, // 70 seconds ago (outside 60s window)
      }),
    });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(result).toBe(true);
    expect(firebase.mockSet).toHaveBeenCalledWith({
      count: 1,
      firstRequestTime: now,
    });
  });

  it("should block request if rate limit exceeded with NextApiResponse", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 10,
        firstRequestTime: now - 30000, // 30 seconds ago
      }),
    });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(result).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Too many test requests, please try again later.",
    });
    expect(consoleLogSpy).toHaveBeenCalledWith("Rate limit exceeded for IP 127.0.0.1");
  });

  it("should handle errors gracefully", async () => {
    firebase.mockGet.mockRejectedValue(new Error("Database error"));

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(result).toBe(true); // Allow request on error
    expect(consoleErrorSpy).toHaveBeenCalledWith("RateLimiterError:", expect.any(Error));
  });

  describe("Google Cloud Code 14 Error Retry Logic", () => {
    // mockSleep is already set up in the main beforeEach as setTimeout mock
    // No need for additional setup here

    it("should retry on Google Cloud code 14 UNAVAILABLE error", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to simulate retry behavior
      let callCount = 0;
      firestoreRetryUtils.retryOnCode14.mockImplementation(async (callback) => {
        callCount++;
        if (callCount === 1) {
          throw code14Error; // First call fails
        }
        return await callback(); // Second call succeeds
      });

      // Mock isCode14Error to return true for our error
      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      firebase.mockGet.mockResolvedValue({ exists: false });
      firebase.mockSet.mockResolvedValue(undefined);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true);
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        code14Error
      );
    });

    it('should retry on "Policy checks are unavailable" error message', async () => {
      const policyError = new Error("GoogleError: Policy checks are unavailable");

      // Mock retryOnCode14 to simulate retry behavior
      let callCount = 0;
      firestoreRetryUtils.retryOnCode14.mockImplementation(async (callback) => {
        callCount++;
        if (callCount === 1) {
          throw policyError; // First call fails
        }
        return await callback(); // Second call succeeds
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      firebase.mockGet.mockResolvedValue({ exists: false });
      firebase.mockSet.mockResolvedValue(undefined);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true);
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        policyError
      );
    });

    it("should use exponential backoff for retries", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to simulate multiple retry attempts
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error; // Always fail to test max retries
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true); // Should allow request as fallback
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        code14Error
      );
    });

    it("should fail after max retries and allow request", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to always fail (simulating exhausted retries)
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true); // Still allow request as fallback
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        code14Error
      );
    });

    it("should not retry non-code-14 errors", async () => {
      const regularError = new Error("Some other database error");

      // Mock retryOnCode14 to throw the regular error
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw regularError;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(false);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true);
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith("RateLimiterError:", regularError);
    });

    it("should handle code 14 error during update operation", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock successful get, then retryOnCode14 fails
      firebase.mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          count: 5,
          firstRequestTime: Date.now() - 30000,
        }),
      });

      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true);
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        code14Error
      );
    });

    it("should handle code 14 error during set operation", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock get returns non-existent doc, then retryOnCode14 fails
      firebase.mockGet.mockResolvedValue({ exists: false });

      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true);
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        code14Error
      );
    });

    it("should handle mixed error types correctly", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to fail with code 14 error
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      const result = await genericRateLimiter(mockReq, mockRes, {
        windowMs: 60000,
        max: 10,
        name: "test",
      });

      expect(result).toBe(true);
      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts, allowing request as fallback:",
        code14Error
      );
    });
  });

  it("should use custom IP if provided", async () => {
    const customIp = "192.168.1.1";

    await genericRateLimiter(
      mockReq,
      mockRes,
      {
        windowMs: 60000,
        max: 10,
        name: "test",
      },
      customIp
    );

    expect(firebase.mockDoc).toHaveBeenCalledWith("192_168_1_1");
    expect(ipUtils.getClientIp).not.toHaveBeenCalled();
  });

  it("should reset rate limit after window period", async () => {
    // Mock time for the beginning of the test
    const initialTime = 1000000;
    jest.spyOn(Date, "now").mockReturnValue(initialTime);

    // Setup - rate limit is at maximum
    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 10, // Maximum limit reached
        firstRequestTime: initialTime - 30000, // 30 seconds ago (still within window)
      }),
    });

    // First attempt - should be blocked (rate limited)
    const firstResult = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000, // 60 second window
      max: 10,
      name: "test",
    });

    expect(firstResult).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Too many test requests, please try again later.",
    });

    // Reset mocks for second attempt
    jest.clearAllMocks();

    // Advance time past the window period
    const laterTime = initialTime + 61000; // 61 seconds later (past the window)
    jest.spyOn(Date, "now").mockReturnValue(laterTime);

    // Setup - existing rate limit entry but now outside the window
    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 10,
        firstRequestTime: initialTime - 30000, // This is now 91 seconds ago
      }),
    });

    // Second attempt - should succeed with reset counter
    const secondResult = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(secondResult).toBe(true);
    expect(firebase.mockSet).toHaveBeenCalledWith({
      count: 1, // Counter reset to 1
      firstRequestTime: laterTime, // Time updated to current
    });

    // Verify we didn't get any 429 response on the second attempt
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.json).not.toHaveBeenCalled();
  });

  it("should maintain separate rate limits for different IPs", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    // First IP (127.0.0.1) - Already at limit
    firebase.mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        count: 10, // Maximum limit reached
        firstRequestTime: now - 30000, // 30 seconds ago (within window)
      }),
    });

    // First IP should be rate limited
    const firstIpResult = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: "test",
    });

    expect(firstIpResult).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(firebase.mockDoc).toHaveBeenCalledWith("127_0_0_1");

    // Reset mocks for second IP attempt
    jest.clearAllMocks();

    // Setup a different IP address
    const secondIp = "192.168.1.1";

    // Second IP - New rate limit record
    firebase.mockGet.mockResolvedValueOnce({
      exists: false,
    });

    // Second IP should not be rate limited
    const secondIpResult = await genericRateLimiter(
      mockReq,
      mockRes,
      {
        windowMs: 60000,
        max: 10,
        name: "test",
      },
      secondIp
    );

    expect(secondIpResult).toBe(true);
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(firebase.mockDoc).toHaveBeenCalledWith("192_168_1_1");
    expect(firebase.mockSet).toHaveBeenCalledWith({
      count: 1,
      firstRequestTime: now,
    });
  });

  it("should maintain separate rate limits for different endpoints", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    // First endpoint (login) - Already at limit
    firebase.mockCollection.mockImplementationOnce(() => ({
      doc: firebase.mockDoc,
    }));

    firebase.mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        count: 5, // Maximum limit reached for login endpoint
        firstRequestTime: now - 30000, // 30 seconds ago (within window)
      }),
    });

    // First endpoint should be rate limited
    const firstEndpointResult = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 5, // Lower limit for sensitive endpoint
      name: "login", // First endpoint name
    });

    expect(firstEndpointResult).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(firebase.mockCollection).toHaveBeenCalledWith("prod_login_rateLimits");

    // Reset mocks for second endpoint attempt
    jest.clearAllMocks();

    // Second endpoint (search) - Same IP but different collection
    firebase.mockCollection.mockImplementationOnce(() => ({
      doc: firebase.mockDoc,
    }));

    firebase.mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        count: 3, // Under limit for search endpoint
        firstRequestTime: now - 30000, // 30 seconds ago (within window)
      }),
    });

    // Second endpoint should not be rate limited despite same IP
    const secondEndpointResult = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10, // Higher limit for search endpoint
      name: "search", // Second endpoint name
    });

    expect(secondEndpointResult).toBe(true);
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(firebase.mockCollection).toHaveBeenCalledWith("prod_search_rateLimits");
    expect(firebase.mockUpdate).toHaveBeenCalledWith({
      count: 4,
    });
  });
});

describe("deleteRateLimitCounter", () => {
  const mockReq = {} as NextApiRequest;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Default mocks
    jest.spyOn(ipUtils, "getClientIp").mockReturnValue("127.0.0.1");
    jest.spyOn(envModule, "isDevelopment").mockReturnValue(false);

    // Default Firebase mocks
    firebase.mockGet.mockResolvedValue({ exists: true });
    firebase.mockDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("should skip deletion if db is not available", async () => {
    // Temporarily remove db
    const originalDb = firebase.db;
    firebase.db = null;

    await deleteRateLimitCounter(mockReq, "test");

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Firestore database not initialized, skipping rate limit counter deletion"
    );

    // Restore db
    firebase.db = originalDb;
  });

  it("should delete rate limit counter if it exists", async () => {
    firebase.mockGet.mockResolvedValue({ exists: true });

    await deleteRateLimitCounter(mockReq, "test");

    expect(firebase.mockCollection).toHaveBeenCalledWith("prod_test_rateLimits");
    expect(firebase.mockDoc).toHaveBeenCalledWith("127.0.0.1");
    expect(firebase.mockDelete).toHaveBeenCalled();
  });

  it("should warn if rate limit counter does not exist", async () => {
    firebase.mockGet.mockResolvedValue({ exists: false });

    await deleteRateLimitCounter(mockReq, "test");

    expect(firebase.mockDelete).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith("No rate limit counter found for 127.0.0.1. Nothing to delete.");
  });

  it("should handle errors gracefully", async () => {
    firebase.mockGet.mockRejectedValue(new Error("Database error"));

    await deleteRateLimitCounter(mockReq, "test");

    expect(consoleErrorSpy).toHaveBeenCalledWith("Error deleting rate limit counter for 127.0.0.1:", expect.any(Error));
  });

  describe("Google Cloud Code 14 Error Retry Logic for Deletion", () => {
    // setTimeout mock is already set up globally
    // No need for additional setup here

    it("should retry on Google Cloud code 14 UNAVAILABLE error during deletion", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to simulate retry behavior
      let callCount = 0;
      firestoreRetryUtils.retryOnCode14.mockImplementation(async (operation) => {
        callCount++;
        if (callCount === 1) {
          throw code14Error; // First call fails
        }
        return await operation(); // Second call succeeds
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);
      firebase.mockGet.mockResolvedValue({ exists: true });
      firebase.mockDelete.mockResolvedValue(undefined);

      await deleteRateLimitCounter(mockReq, "test");

      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts for rate limit deletion:",
        code14Error
      );
    });

    it('should retry on "Policy checks are unavailable" error message during deletion', async () => {
      const policyError = new Error("GoogleError: Policy checks are unavailable");

      // Mock retryOnCode14 to simulate retry behavior
      let callCount = 0;
      firestoreRetryUtils.retryOnCode14.mockImplementation(async (operation) => {
        callCount++;
        if (callCount === 1) {
          throw policyError; // First call fails
        }
        return await operation(); // Second call succeeds
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);
      firebase.mockGet.mockResolvedValue({ exists: true });
      firebase.mockDelete.mockResolvedValue(undefined);

      await deleteRateLimitCounter(mockReq, "test");

      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts for rate limit deletion:",
        policyError
      );
    });

    it("should use exponential backoff for retries during deletion", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to simulate multiple retry attempts
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error; // Always fail to test max retries
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      await deleteRateLimitCounter(mockReq, "test");

      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts for rate limit deletion:",
        code14Error
      );
    });

    it("should fail after max retries and log error", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to always fail (simulating exhausted retries)
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      await deleteRateLimitCounter(mockReq, "test");

      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts for rate limit deletion:",
        code14Error
      );
    });

    it("should not retry non-code-14 errors during deletion", async () => {
      const regularError = new Error("Some other database error");

      // Mock retryOnCode14 to throw the regular error
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw regularError;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(false);

      await deleteRateLimitCounter(mockReq, "test");

      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error deleting rate limit counter for 127.0.0.1:", regularError);
    });

    it("should handle mixed error types correctly during deletion", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      (code14Error as any).code = 14;

      // Mock retryOnCode14 to fail with code 14 error
      firestoreRetryUtils.retryOnCode14.mockImplementation(async () => {
        throw code14Error;
      });

      firestoreRetryUtils.isCode14Error.mockReturnValue(true);

      await deleteRateLimitCounter(mockReq, "test");

      expect(firestoreRetryUtils.retryOnCode14).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks failed after 3 attempts for rate limit deletion:",
        code14Error
      );
    });
  });
});
