/** @jest-environment node */
import { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import suggestPromptHandler from "@/pages/api/suggestPrompt";

// Mock dependencies
jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/utils/server/firestoreUtils", () => ({
  getAnswersCollectionName: jest.fn().mockReturnValue("test_chatLogs"),
}));

// Mock Firebase first
jest.mock("@/services/firebase", () => ({
  db: {
    collection: jest.fn(),
  },
}));

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content:
        "1. How can I deepen my meditation practice?\n2. What is the purpose of spiritual growth?\n3. How do I find inner peace?",
    }),
  })),
}));

// Mock CORS middleware to avoid header issues
jest.mock("@/utils/server/corsMiddleware", () => ({
  setCorsHeaders: jest.fn(),
}));

// Mock site config loading
jest.mock("@/utils/server/loadSiteConfig", () => ({
  loadSiteConfig: jest.fn().mockResolvedValue({
    siteId: "test",
    requireLogin: true,
  }),
  loadSiteConfigSync: jest.fn().mockReturnValue({
    siteId: "test",
    requireLogin: true,
  }),
}));

// Mock JWT authentication middleware
jest.mock("@/utils/server/jwtUtils", () => ({
  withJwtAuth: jest.fn((handler) => handler),
}));

// Mock API middleware
jest.mock("@/utils/server/apiMiddleware", () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

// Import the mocked db
import { db } from "@/services/firebase";

describe("/api/suggestPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("3-question threshold enforcement", () => {
    it("returns hasEnoughHistory: false when user has fewer than 3 questions", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock Firestore query for user with only 2 chat history entries
      const mockGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: "doc1",
            data: () => ({
              question: "What is meditation?",
              answer: "Meditation is a practice...",
              restatedQuestion: "What is meditation?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc2",
            data: () => ({
              question: "How do I start meditating?",
              answer: "To start meditating...",
              restatedQuestion: "How do I start meditating?",
              timestamp: new Date(),
            }),
          },
        ],
      });

      const mockOrderBy = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      });

      const mockWhere = jest.fn().mockReturnValue({
        orderBy: mockOrderBy,
      });

      (db!.collection as jest.Mock).mockReturnValue({
        where: mockWhere,
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        suggestions: [],
        hasEnoughHistory: false,
      });
    });

    it("returns hasEnoughHistory: false when user has exactly 2 questions", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock Firestore query for user with exactly 2 chat history entries
      const mockGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: "doc1",
            data: () => ({
              question: "What is spiritual growth?",
              answer: "Spiritual growth is...",
              restatedQuestion: "What is spiritual growth?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc2",
            data: () => ({
              question: "How can I practice mindfulness?",
              answer: "Mindfulness can be practiced...",
              restatedQuestion: "How can I practice mindfulness?",
              timestamp: new Date(),
            }),
          },
        ],
      });

      const mockOrderBy = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      });

      const mockWhere = jest.fn().mockReturnValue({
        orderBy: mockOrderBy,
      });

      (db!.collection as jest.Mock).mockReturnValue({
        where: mockWhere,
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        suggestions: [],
        hasEnoughHistory: false,
      });
    });

    it("returns AI suggestions when user has exactly 3 questions", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock Firestore query for user with exactly 3 chat history entries
      const mockGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: "doc1",
            data: () => ({
              question: "What is meditation and how does it help with spiritual growth?",
              answer: "Meditation is a practice of focused attention...",
              restatedQuestion: "What is meditation and how does it help with spiritual growth?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc2",
            data: () => ({
              question: "How can I develop a consistent daily meditation practice?",
              answer: "Developing a consistent meditation practice requires...",
              restatedQuestion: "How can I develop a consistent daily meditation practice?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc3",
            data: () => ({
              question: "What are the different types of meditation techniques available?",
              answer: "There are many different meditation techniques...",
              restatedQuestion: "What are the different types of meditation techniques available?",
              timestamp: new Date(),
            }),
          },
        ],
      });

      const mockOrderBy = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      });

      const mockWhere = jest.fn().mockReturnValue({
        orderBy: mockOrderBy,
      });

      (db!.collection as jest.Mock).mockReturnValue({
        where: mockWhere,
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        suggestions: [
          "How can I deepen my meditation practice?",
          "What is the purpose of spiritual growth?",
          "How do I find inner peace?",
        ],
        hasEnoughHistory: true,
      });
    });

    it("returns AI suggestions when user has more than 3 questions", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock Firestore query for user with 5 chat history entries
      const mockGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: "doc1",
            data: () => ({
              question: "What is the meaning of life from a spiritual perspective?",
              answer: "From a spiritual perspective, the meaning of life...",
              restatedQuestion: "What is the meaning of life from a spiritual perspective?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc2",
            data: () => ({
              question: "How can I overcome negative thoughts and emotions?",
              answer: "Overcoming negative thoughts requires...",
              restatedQuestion: "How can I overcome negative thoughts and emotions?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc3",
            data: () => ({
              question: "What role does compassion play in spiritual development?",
              answer: "Compassion is fundamental to spiritual development...",
              restatedQuestion: "What role does compassion play in spiritual development?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc4",
            data: () => ({
              question: "How do I maintain spiritual practices during busy periods?",
              answer: "Maintaining spiritual practices during busy times...",
              restatedQuestion: "How do I maintain spiritual practices during busy periods?",
              timestamp: new Date(),
            }),
          },
          {
            id: "doc5",
            data: () => ({
              question: "What is the relationship between meditation and self-realization?",
              answer: "Meditation and self-realization are deeply connected...",
              restatedQuestion: "What is the relationship between meditation and self-realization?",
              timestamp: new Date(),
            }),
          },
        ],
      });

      const mockOrderBy = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      });

      const mockWhere = jest.fn().mockReturnValue({
        orderBy: mockOrderBy,
      });

      (db!.collection as jest.Mock).mockReturnValue({
        where: mockWhere,
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        suggestions: [
          "How can I deepen my meditation practice?",
          "What is the purpose of spiritual growth?",
          "How do I find inner peace?",
        ],
        hasEnoughHistory: true,
      });
    });
  });

  describe("error handling", () => {
    it("returns 405 for non-POST requests", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(405);
      expect(res._getJSONData()).toEqual({ message: "Method not allowed" });
    });

    it("returns 400 when UUID is missing", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: {},
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData()).toEqual({ message: "UUID is required and must be a string" });
    });

    it("returns 400 when UUID is not a string", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: 123 },
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData()).toEqual({ message: "UUID is required and must be a string" });
    });

    it("handles database errors gracefully", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock the collection method to throw an error (simulating database issues)
      (db!.collection as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Database connection error");
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({ message: "Failed to generate suggestions" });
    });
  });

  describe("boundary conditions", () => {
    it("handles empty chat history correctly", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock Firestore query for user with no chat history
      const mockGet = jest.fn().mockResolvedValue({
        docs: [],
      });

      const mockOrderBy = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      });

      const mockWhere = jest.fn().mockReturnValue({
        orderBy: mockOrderBy,
      });

      (db!.collection as jest.Mock).mockReturnValue({
        where: mockWhere,
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        suggestions: [],
        hasEnoughHistory: false,
      });
    });

    it("handles exactly 1 question correctly", async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        body: { uuid: "test-uuid-123" },
      });

      // Mock Firestore query for user with exactly 1 chat history entry
      const mockGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: "doc1",
            data: () => ({
              question: "What is the purpose of meditation?",
              answer: "The purpose of meditation is...",
              restatedQuestion: "What is the purpose of meditation?",
              timestamp: new Date(),
            }),
          },
        ],
      });

      const mockOrderBy = jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: mockGet,
        }),
      });

      const mockWhere = jest.fn().mockReturnValue({
        orderBy: mockOrderBy,
      });

      (db!.collection as jest.Mock).mockReturnValue({
        where: mockWhere,
      });

      await suggestPromptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({
        suggestions: [],
        hasEnoughHistory: false,
      });
    });
  });
});
