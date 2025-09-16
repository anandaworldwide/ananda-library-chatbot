import { renderHook, act } from "@testing-library/react";
import { useChatHistory } from "@/hooks/useChatHistory";
import { fetchWithAuth } from "@/utils/client/tokenManager";

// Mock dependencies
jest.mock("@/utils/client/tokenManager", () => ({
  getToken: jest.fn(() => "mock-token"),
  isAuthenticated: jest.fn(() => true),
  fetchWithAuth: jest.fn(),
}));

jest.mock("@/utils/client/uuid", () => ({
  getOrCreateUUID: jest.fn(() => "test-uuid"),
}));

const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;

describe("useChatHistory - Star Functionality", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default successful response for regular conversations
    mockFetchWithAuth.mockImplementation((url: string) => {
      if (url.includes("/api/chats")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: "msg-1",
                question: "Test question 1",
                answer: "Test answer 1",
                timestamp: { seconds: 1640995200 },
                collection: "all",
                convId: "conv-1",
                title: "Test Conversation 1",
                isStarred: false,
              },
              {
                id: "msg-2",
                question: "Test question 2",
                answer: "Test answer 2",
                timestamp: { seconds: 1640995100 },
                collection: "all",
                convId: "conv-2",
                title: "Test Conversation 2",
                isStarred: true,
              },
            ]),
        } as Response);
      }

      if (url.includes("starred=true")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: "msg-2",
                question: "Test question 2",
                answer: "Test answer 2",
                timestamp: { seconds: 1640995100 },
                collection: "all",
                convId: "conv-2",
                title: "Test Conversation 2",
                isStarred: true,
              },
            ]),
        } as Response);
      }

      if (url.includes("/api/conversations/star")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }

      return Promise.reject(new Error("Unexpected URL"));
    });
  });

  describe("Star Conversations Management", () => {
    it("should star a conversation successfully", async () => {
      const { result } = renderHook(() => useChatHistory(10));

      await act(async () => {
        await result.current.starConversation("conv-1");
      });

      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        "/api/conversations/star",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ convId: "conv-1", action: "star" }),
        })
      );
    });

    it("should unstar a conversation successfully", async () => {
      const { result } = renderHook(() => useChatHistory(10));

      await act(async () => {
        await result.current.unstarConversation("conv-2");
      });

      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        "/api/conversations/star",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ convId: "conv-2", action: "unstar" }),
        })
      );
    });

    it("should handle star conversation errors", async () => {
      mockFetchWithAuth.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useChatHistory(10));

      await expect(
        act(async () => {
          await result.current.starConversation("conv-1");
        })
      ).rejects.toThrow("Network error");
    });
  });
});
