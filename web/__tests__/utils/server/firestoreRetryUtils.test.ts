/**
 * Tests for firestoreRetryUtils.ts
 * Tests the centralized retry logic for Google Cloud code 14 errors
 */

import {
  isCode14Error,
  retryOnCode14,
  firestoreGet,
  firestoreSet,
  firestoreUpdate,
  firestoreDelete,
  firestoreAdd,
  firestoreBatchCommit,
  firestoreQueryGet,
} from "../../../src/utils/server/firestoreRetryUtils";

describe("firestoreRetryUtils", () => {
  let consoleWarnSpy: jest.SpyInstance;
  let mockSleep: jest.SpyInstance;
  let mockClearTimeout: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    // Mock setTimeout to avoid actual delays in tests
    mockSleep = jest.spyOn(global, "setTimeout").mockImplementation((fn: TimerHandler) => {
      if (typeof fn === "function") {
        fn();
      }
      return 123 as any; // Return a proper timeout ID
    });
    mockClearTimeout = jest.spyOn(global, "clearTimeout").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    mockSleep.mockRestore();
    mockClearTimeout.mockRestore();
  });

  describe("isCode14Error", () => {
    it("should return true for error with code 14", () => {
      const error = new Error("Test error");
      (error as any).code = 14;
      expect(isCode14Error(error)).toBe(true);
    });

    it('should return true for "Policy checks are unavailable" message', () => {
      const error = new Error("Policy checks are unavailable");
      expect(isCode14Error(error)).toBe(true);
    });

    it("should return true for UNAVAILABLE error message", () => {
      const error = new Error("Service UNAVAILABLE");
      expect(isCode14Error(error)).toBe(true);
    });

    it("should return true for DEADLINE_EXCEEDED error message", () => {
      const error = new Error("DEADLINE_EXCEEDED");
      expect(isCode14Error(error)).toBe(true);
    });

    it("should return true for EBUSY error message", () => {
      const error = new Error("EBUSY resource temporarily unavailable");
      expect(isCode14Error(error)).toBe(true);
    });

    it("should return false for non-code-14 errors", () => {
      const error = new Error("Regular error");
      expect(isCode14Error(error)).toBe(false);
    });

    it("should return false for non-Error objects", () => {
      expect(isCode14Error("string error")).toBe(false);
      expect(isCode14Error(null)).toBe(false);
      expect(isCode14Error(undefined)).toBe(false);
    });
  });

  describe("retryOnCode14", () => {
    it("should succeed on first attempt", async () => {
      const mockOperation = jest.fn().mockResolvedValue("success");

      const result = await retryOnCode14(mockOperation, "test operation");

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should retry on code 14 error and succeed", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      const mockOperation = jest.fn().mockRejectedValueOnce(code14Error).mockResolvedValue("success");

      const result = await retryOnCode14(mockOperation, "test operation", "test context");

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks unavailable during test operation (test context) (attempt 1/3), retrying in 1000ms..."
      );
    });

    it("should use exponential backoff", async () => {
      const code14Error = new Error("UNAVAILABLE");
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(code14Error)
        .mockRejectedValueOnce(code14Error)
        .mockResolvedValue("success");

      const result = await retryOnCode14(mockOperation, "test operation");

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(3);

      // The setTimeout is called multiple times:
      // - Once for timeout promise on first attempt (14000ms)
      // - Once for retry delay (1000ms)
      // - Once for timeout promise on second attempt (14000ms)
      // - Once for retry delay (2000ms)
      // - Once for timeout promise on third attempt (14000ms)
      // We check that the retry delays (1000ms and 2000ms) are present
      const retryDelayCalls = mockSleep.mock.calls.filter((call) => call[1] === 1000 || call[1] === 2000);
      expect(retryDelayCalls).toHaveLength(2);
      expect(retryDelayCalls[0][1]).toBe(1000);
      expect(retryDelayCalls[1][1]).toBe(2000);
    });

    it("should fail after max retries", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      const mockOperation = jest.fn().mockRejectedValue(code14Error);

      await expect(retryOnCode14(mockOperation, "test operation")).rejects.toThrow(code14Error);

      expect(mockOperation).toHaveBeenCalledTimes(3);
      // Check that we have at least 2 retry delay calls (1000ms and 2000ms)
      const retryDelayCalls = mockSleep.mock.calls.filter((call) => call[1] === 1000 || call[1] === 2000);
      expect(retryDelayCalls).toHaveLength(2);
    });

    it("should not retry non-code-14 errors", async () => {
      const regularError = new Error("Regular error");
      const mockOperation = jest.fn().mockRejectedValue(regularError);

      await expect(retryOnCode14(mockOperation, "test operation")).rejects.toThrow(regularError);

      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should work without context parameter", async () => {
      const code14Error = new Error("Policy checks are unavailable");
      const mockOperation = jest.fn().mockRejectedValueOnce(code14Error).mockResolvedValue("success");

      const result = await retryOnCode14(mockOperation, "test operation");

      expect(result).toBe("success");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Google Cloud policy checks unavailable during test operation (attempt 1/3), retrying in 1000ms..."
      );
    });

    it("should properly handle timeout cleanup on success", async () => {
      // Reset clearTimeout spy to track calls for this test
      mockClearTimeout.mockClear();

      const mockOperation = jest.fn().mockResolvedValue("success");

      const result = await retryOnCode14(mockOperation, "test operation");

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(1);
      // Verify that clearTimeout was called to clean up the timeout
      expect(mockClearTimeout).toHaveBeenCalledWith(123);
    });

    it("should properly handle timeout cleanup on error", async () => {
      // Reset clearTimeout spy to track calls for this test
      mockClearTimeout.mockClear();

      const regularError = new Error("Regular error");
      const mockOperation = jest.fn().mockRejectedValue(regularError);

      await expect(retryOnCode14(mockOperation, "test operation")).rejects.toThrow(regularError);

      expect(mockOperation).toHaveBeenCalledTimes(1);
      // Verify that clearTimeout was called even when operation fails
      expect(mockClearTimeout).toHaveBeenCalledWith(123);
    });

    it("should handle timeout promise creation without temporal dead zone issues", async () => {
      // This test ensures the timeout promise is created properly without accessing
      // timeoutPromise before it's initialized (the bug we just fixed)
      // Reset mocks to track calls for this test
      mockClearTimeout.mockClear();
      mockSleep.mockClear();

      const mockOperation = jest.fn().mockResolvedValue("success");

      const result = await retryOnCode14(mockOperation, "test operation");

      expect(result).toBe("success");
      expect(mockOperation).toHaveBeenCalledTimes(1);
      // The setTimeout should be called for the timeout promise (14000ms)
      expect(mockSleep).toHaveBeenCalledWith(expect.any(Function), 14000);
      // clearTimeout should be called to clean up
      expect(mockClearTimeout).toHaveBeenCalledWith(123);
    });
  });

  describe("Firestore wrapper functions", () => {
    let mockDocRef: any;
    let mockCollectionRef: any;
    let mockBatch: any;
    let mockQuery: any;

    beforeEach(() => {
      mockDocRef = {
        get: jest.fn().mockResolvedValue({ data: "test" }),
        set: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };

      mockCollectionRef = {
        add: jest.fn().mockResolvedValue({ id: "new-doc-id" }),
      };

      mockBatch = {
        commit: jest.fn().mockResolvedValue(undefined),
      };

      mockQuery = {
        get: jest.fn().mockResolvedValue({ docs: [] }),
      };
    });

    describe("firestoreGet", () => {
      it("should call docRef.get() and return result", async () => {
        const result = await firestoreGet(mockDocRef, "test get", "doc123");

        expect(result).toEqual({ data: "test" });
        expect(mockDocRef.get).toHaveBeenCalledTimes(1);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("Policy checks are unavailable");
        mockDocRef.get.mockRejectedValueOnce(code14Error).mockResolvedValue({ data: "test" });

        const result = await firestoreGet(mockDocRef, "test get", "doc123");

        expect(result).toEqual({ data: "test" });
        expect(mockDocRef.get).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test get (doc123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });

    describe("firestoreSet", () => {
      it("should call docRef.set() without options", async () => {
        const data = { field: "value" };
        await firestoreSet(mockDocRef, data, undefined, "test set", "doc123");

        expect(mockDocRef.set).toHaveBeenCalledWith(data);
      });

      it("should call docRef.set() with options", async () => {
        const data = { field: "value" };
        const options = { merge: true };
        await firestoreSet(mockDocRef, data, options, "test set", "doc123");

        expect(mockDocRef.set).toHaveBeenCalledWith(data, options);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("UNAVAILABLE");
        mockDocRef.set.mockRejectedValueOnce(code14Error).mockResolvedValue(undefined);

        await firestoreSet(mockDocRef, { field: "value" }, undefined, "test set", "doc123");

        expect(mockDocRef.set).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test set (doc123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });

    describe("firestoreUpdate", () => {
      it("should call docRef.update()", async () => {
        const data = { field: "updated" };
        await firestoreUpdate(mockDocRef, data, "test update", "doc123");

        expect(mockDocRef.update).toHaveBeenCalledWith(data);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("DEADLINE_EXCEEDED");
        mockDocRef.update.mockRejectedValueOnce(code14Error).mockResolvedValue(undefined);

        await firestoreUpdate(mockDocRef, { field: "updated" }, "test update", "doc123");

        expect(mockDocRef.update).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test update (doc123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });

    describe("firestoreDelete", () => {
      it("should call docRef.delete()", async () => {
        await firestoreDelete(mockDocRef, "test delete", "doc123");

        expect(mockDocRef.delete).toHaveBeenCalledTimes(1);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("EBUSY");
        mockDocRef.delete.mockRejectedValueOnce(code14Error).mockResolvedValue(undefined);

        await firestoreDelete(mockDocRef, "test delete", "doc123");

        expect(mockDocRef.delete).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test delete (doc123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });

    describe("firestoreAdd", () => {
      it("should call collectionRef.add()", async () => {
        const data = { field: "value" };
        const result = await firestoreAdd(mockCollectionRef, data, "test add", "collection123");

        expect(result).toEqual({ id: "new-doc-id" });
        expect(mockCollectionRef.add).toHaveBeenCalledWith(data);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("Policy checks are unavailable");
        mockCollectionRef.add.mockRejectedValueOnce(code14Error).mockResolvedValue({ id: "new-doc-id" });

        const result = await firestoreAdd(mockCollectionRef, { field: "value" }, "test add", "collection123");

        expect(result).toEqual({ id: "new-doc-id" });
        expect(mockCollectionRef.add).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test add (collection123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });

    describe("firestoreBatchCommit", () => {
      it("should call batch.commit()", async () => {
        await firestoreBatchCommit(mockBatch, "test batch commit", "batch123");

        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("UNAVAILABLE");
        mockBatch.commit.mockRejectedValueOnce(code14Error).mockResolvedValue(undefined);

        await firestoreBatchCommit(mockBatch, "test batch commit", "batch123");

        expect(mockBatch.commit).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test batch commit (batch123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });

    describe("firestoreQueryGet", () => {
      it("should call query.get()", async () => {
        const result = await firestoreQueryGet(mockQuery, "test query", "query123");

        expect(result).toEqual({ docs: [] });
        expect(mockQuery.get).toHaveBeenCalledTimes(1);
      });

      it("should retry on code 14 error", async () => {
        const code14Error = new Error("DEADLINE_EXCEEDED");
        mockQuery.get.mockRejectedValueOnce(code14Error).mockResolvedValue({ docs: [] });

        const result = await firestoreQueryGet(mockQuery, "test query", "query123");

        expect(result).toEqual({ docs: [] });
        expect(mockQuery.get).toHaveBeenCalledTimes(2);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "Google Cloud policy checks unavailable during test query (query123) (attempt 1/3), retrying in 1000ms..."
        );
      });
    });
  });
});
