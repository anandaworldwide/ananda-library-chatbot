/**
 * Tests for title generation utility
 */

import "openai/shims/node";
import { generateTitle, generateAndUpdateTitle } from "@/utils/server/titleGeneration";
import { firestoreUpdate } from "@/utils/server/firestoreRetryUtils";
import { db } from "@/services/firebase";
import { ChatOpenAI } from "@langchain/openai";

// Mock dependencies
jest.mock("@/utils/server/firestoreRetryUtils");
jest.mock("@/services/firebase");
jest.mock("@langchain/openai");

const mockFirestoreUpdate = firestoreUpdate as jest.MockedFunction<typeof firestoreUpdate>;
const mockDb = db as jest.Mocked<typeof db>;
const mockChatOpenAI = ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>;

describe("titleGeneration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("generateTitle", () => {
    it("should generate AI title when model succeeds", async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        content: "Meditation Technique Guide",
      });

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      // Use a question longer than 5 words to trigger AI generation
      const result = await generateTitle("How do I meditate properly for better results?");

      expect(result).toBe("Meditation Technique Guide");
      expect(mockInvoke).toHaveBeenCalledWith(expect.stringContaining("Generate a concise four-word title"));
    });

    it("should fall back to truncated question when AI fails", async () => {
      const mockInvoke = jest.fn().mockRejectedValue(new Error("AI failed"));

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      const result = await generateTitle("How do I meditate properly for better health?");

      expect(result).toBe("How do I meditate...");
    });

    it("should use full question when 5 words or less", async () => {
      const mockInvoke = jest.fn().mockRejectedValue(new Error("AI failed"));

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      const result = await generateTitle("What is meditation?");

      expect(result).toBe("What is meditation?");
      // Should not call AI for short questions
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should use full question for exactly 5 words", async () => {
      const mockInvoke = jest.fn().mockRejectedValue(new Error("AI failed"));

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      const result = await generateTitle("How do I meditate properly?");

      expect(result).toBe("How do I meditate properly?");
      // Should not call AI for 5-word questions
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should handle AI response that is too long", async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        content: "This is a very long title that exceeds the word limit",
      });

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      const result = await generateTitle("How do I meditate properly for better health and wellness?");

      expect(result).toBe("How do I meditate...");
    });

    it("should handle empty AI response", async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        content: "",
      });

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      const result = await generateTitle("How do I meditate properly for better health and wellness?");

      expect(result).toBe("How do I meditate...");
    });

    it("should generate title in same language as question", async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        content: "Principios Básicos Meditación Espiritual",
      });

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      const result = await generateTitle("¿Cuáles son los principios más importantes para realizar a Dios?");

      expect(result).toBe("Principios Básicos Meditación Espiritual");
      expect(mockInvoke).toHaveBeenCalledWith(expect.stringContaining("SAME LANGUAGE as the original question"));
    });
  });

  describe("generateAndUpdateTitle", () => {
    const mockDocRef = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
    };

    beforeEach(() => {
      (mockDb as any).collection = jest.fn().mockReturnValue(mockDocRef);
      mockDocRef.doc = jest.fn().mockReturnValue(mockDocRef);
    });

    it("should generate title and update document successfully", async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        content: "Meditation Technique Guide",
      });

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      mockFirestoreUpdate.mockResolvedValue(undefined);

      // Use a question longer than 5 words to trigger AI generation
      await generateAndUpdateTitle("doc123", "How do I meditate properly for better results?");

      expect(mockFirestoreUpdate).toHaveBeenCalledWith(
        mockDocRef,
        { title: "Meditation Technique Guide" },
        "title generation update",
        expect.stringContaining("doc123")
      );
    });

    it("should use fallback title when AI fails", async () => {
      const mockInvoke = jest.fn().mockRejectedValue(new Error("AI failed"));

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      mockFirestoreUpdate.mockResolvedValue(undefined);

      await generateAndUpdateTitle("doc123", "How do I meditate properly for better health and wellness?");

      expect(mockFirestoreUpdate).toHaveBeenCalledWith(
        mockDocRef,
        { title: "How do I meditate..." },
        "title generation update",
        expect.stringContaining("doc123")
      );
    });

    it("should handle Firestore update failure gracefully", async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        content: "Meditation Technique Guide",
      });

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      mockFirestoreUpdate.mockRejectedValue(new Error("Firestore failed"));

      // Should not throw
      await expect(generateAndUpdateTitle("doc123", "How do I meditate properly?")).resolves.toBeUndefined();
    });

    it("should attempt fallback title update when both AI and primary update fail", async () => {
      const mockInvoke = jest.fn().mockRejectedValue(new Error("AI failed"));

      mockChatOpenAI.mockImplementation(
        () =>
          ({
            invoke: mockInvoke,
          }) as any
      );

      mockFirestoreUpdate.mockRejectedValueOnce(new Error("First update failed")).mockResolvedValueOnce(undefined);

      await generateAndUpdateTitle("doc123", "How do I meditate properly for better health and wellness?");

      expect(mockFirestoreUpdate).toHaveBeenCalledTimes(2);
      expect(mockFirestoreUpdate).toHaveBeenLastCalledWith(
        mockDocRef,
        { title: "How do I meditate..." },
        "fallback title update",
        expect.stringContaining("doc123")
      );
    });
  });
});
