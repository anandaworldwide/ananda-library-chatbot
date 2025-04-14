/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unused-vars */

// Unit tests for relatedQuestionsUtils.ts
// Tests the functionality for managing related questions

// Create mock objects we'll use in tests
const mockDB = {
  collection: jest.fn(),
  batch: jest.fn().mockImplementation(() => {
    return {
      set: jest.fn(),
      // @ts-ignore - Mock implementation doesn't need to match exact return type
      commit: jest.fn().mockResolvedValue(undefined),
    };
  }),
  doc: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  startAfter: jest.fn(),
};

// Mock firebase-admin before it's imported by services/firebase
jest.mock('firebase-admin', () => ({
  credential: {
    cert: jest.fn().mockReturnValue({}),
  },
  initializeApp: jest.fn().mockReturnValue({}),
  firestore: {
    FieldPath: {
      documentId: jest.fn().mockReturnValue('documentId'),
    },
  },
  apps: ['mockApp'], // Mock that Firebase is already initialized
}));

// Mock OpenAI before importing any modules that use it
jest.mock('openai', () => {
  const mockOpenAIClass = jest.fn().mockImplementation(() => mockOpenAI);
  return mockOpenAIClass;
});

// Mock Pinecone before importing any modules that use it
jest.mock('@pinecone-database/pinecone', () => {
  return {
    Pinecone: jest.fn().mockImplementation(() => mockPinecone),
  };
});

// Mock Firebase before importing any modules that use it
jest.mock('@/services/firebase', () => {
  return {
    db: mockDB,
  };
});

// Mock other dependencies
jest.mock('@/utils/server/redisUtils', () => ({
  getFromCache: jest.fn(),
  setInCache: jest.fn(),
  deleteFromCache: jest.fn(),
  CACHE_EXPIRATION: 86400,
}));

jest.mock('@/utils/server/answersUtils', () => ({
  getAnswersByIds: jest.fn(),
}));

jest.mock('@/utils/env', () => ({
  getEnvName: jest.fn(() => 'dev'),
}));

jest.mock('@/utils/server/firestoreUtils', () => ({
  getAnswersCollectionName: jest.fn(() => 'answers'),
}));

// Mock TextEncoder/TextDecoder which are required by dependencies
// @ts-expect-error Mock for Node.js environment
global.TextEncoder = class {
  encode(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text));
  }
};

// @ts-expect-error Mock for Node.js environment
global.TextDecoder = class {
  decode(buf: Uint8Array): string {
    return Buffer.from(buf).toString();
  }
};

import { jest } from '@jest/globals';
import {
  getRelatedQuestions,
  updateRelatedQuestionsBatch,
  updateRelatedQuestions,
  findRelatedQuestionsPinecone,
  upsertEmbeddings,
} from '../../../utils/server/relatedQuestionsUtils';
import { Answer } from '@/types/answer';
import { RelatedQuestion } from '@/types/RelatedQuestion';
import { IndexList, IndexModel, Pinecone } from '@pinecone-database/pinecone';

// Import mocked modules after mocking
import * as answersUtils from '@/utils/server/answersUtils';

const mockOpenAI = {
  embeddings: {
    // @ts-ignore - Complex mock type
    create: jest.fn().mockImplementation(function (args) {
      // Extract input from args
      const input = (args as any).input;
      // Return mock embeddings with consistent dimensions
      const mockDimension = 3072; // Match the dimension in the main code
      if (Array.isArray(input)) {
        // Handle batch embedding requests
        return Promise.resolve({
          data: input.map((_, i) => ({
            embedding: Array(mockDimension).fill(0.1 * (i + 1)),
          })),
        });
      } else {
        // Handle single embedding request
        return Promise.resolve({
          data: [{ embedding: Array(mockDimension).fill(0.1) }],
        });
      }
    }),
  },
};

// Mock Pinecone index operations
const mockPineconeIndex = {
  upsert: jest.fn().mockResolvedValue({} as never),
  // @ts-ignore - Complex mock type
  query: jest.fn().mockImplementation(function (args) {
    // Extract filter from args
    const filter = (args as any).filter;
    const siteId = filter?.siteId?.$eq;

    // Create mock matches that respect the siteId filter
    const mockMatches = [];
    if (siteId === 'test-site-1') {
      mockMatches.push(
        {
          id: 'site1-q1',
          score: 0.95,
          metadata: { title: 'Site 1 Question 1', siteId: 'test-site-1' },
        },
        {
          id: 'site1-q2',
          score: 0.85,
          metadata: { title: 'Site 1 Question 2', siteId: 'test-site-1' },
        },
      );
    } else if (siteId === 'test-site-2') {
      mockMatches.push(
        {
          id: 'site2-q1',
          score: 0.92,
          metadata: { title: 'Site 2 Question 1', siteId: 'test-site-2' },
        },
        {
          id: 'site2-q2',
          score: 0.82,
          metadata: { title: 'Site 2 Question 2', siteId: 'test-site-2' },
        },
      );
    }

    return Promise.resolve({ matches: mockMatches });
  }),
  // @ts-ignore - Complex mock type
  fetch: jest.fn().mockImplementation(function (args) {
    // Extract ID from args which is an array with a single ID
    const id = (args as any)[0];

    // Mock implementation to return metadata for a specific ID
    const records = {
      'site1-q1': {
        metadata: { title: 'Site 1 Question 1', siteId: 'test-site-1' },
      },
      'site2-q1': {
        metadata: { title: 'Site 2 Question 1', siteId: 'test-site-2' },
      },
    } as any; // Add type assertion to avoid index type error

    return Promise.resolve({ records: { [id]: records[id] || null } });
  }),
};

// Mock Pinecone client
const mockPinecone = {
  index: jest.fn().mockReturnValue(mockPineconeIndex),
  listIndexes: jest.fn<() => Promise<IndexList>>().mockResolvedValue({
    indexes: [
      {
        name: 'dev-related-questions',
        dimension: 3072,
        metric: 'cosine',
        host: 'test.pinecone.io',
        spec: { serverless: { cloud: 'aws', region: 'us-west-2' } },
        status: { ready: true, state: 'Ready' },
        vectorType: 'float32',
      },
    ],
  }),
  describeIndex: jest
    .fn<(name: string) => Promise<IndexModel>>()
    .mockResolvedValue({
      name: 'dev-related-questions',
      dimension: 3072,
      metric: 'cosine',
      host: 'test.pinecone.io',
      spec: { serverless: { cloud: 'aws', region: 'us-west-2' } },
      status: { ready: true, state: 'Ready' },
      vectorType: 'float32',
    }),
  createIndex: jest
    .fn<(name: string, spec: any) => Promise<void>>()
    .mockResolvedValue(undefined),
} as unknown as Pinecone;

// Mock environment variables need Pinecone cloud/region
const originalEnv = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    OPENAI_API_KEY: 'test-openai-key',
    PINECONE_API_KEY: 'test-pinecone-key',
    SITE_ID: 'test-site-1', // Default site ID for tests
    PINECONE_CLOUD: 'aws', // Add mock value
    PINECONE_REGION: 'us-west-2', // Add mock value
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('relatedQuestionsUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRelatedQuestions', () => {
    it('should return related questions successfully', async () => {
      // Setup mocks
      const mockDoc = {
        exists: true,
        data: () => ({
          relatedQuestionsV2: [
            { id: 'related1', title: 'Related 1', similarity: 0.9 },
            { id: 'related2', title: 'Related 2', similarity: 0.8 },
          ],
        }),
      };

      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockDocFn = jest.fn().mockReturnValue({ get: mockGet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Apply mocks
      mockDB.collection = mockCollection;

      const mockRelatedAnswers = [
        { id: 'related1', question: 'Related question 1', answer: 'Answer 1' },
        { id: 'related2', question: 'Related question 2', answer: 'Answer 2' },
      ];

      jest
        .mocked(answersUtils.getAnswersByIds)
        .mockResolvedValue(mockRelatedAnswers as any);

      // Execute
      const result = await getRelatedQuestions('question1');

      // Verify
      expect(result).toEqual(mockRelatedAnswers);
      expect(mockCollection).toHaveBeenCalledWith('answers');
      expect(mockDocFn).toHaveBeenCalledWith('question1');
      // Verify it calls getAnswersByIds with the IDs from relatedQuestionsV2
      expect(answersUtils.getAnswersByIds).toHaveBeenCalledWith([
        'related1',
        'related2',
      ]);
    });

    it('should return empty array if document does not exist', async () => {
      // Changed expectation
      // Setup mocks
      const mockDoc = { exists: false };
      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockDocFn = jest.fn().mockReturnValue({ get: mockGet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Apply mocks
      mockDB.collection = mockCollection;

      // Execute and verify
      const result = await getRelatedQuestions('nonexistent');
      expect(result).toEqual([]); // Should return empty array, not throw
    });

    it('should return empty array if relatedQuestionsV2 is missing or empty', async () => {
      const mockDocMissing = {
        exists: true,
        data: () => ({}), // No relatedQuestionsV2 field
      };
      const mockDocEmpty = {
        exists: true,
        data: () => ({ relatedQuestionsV2: [] }), // Empty array
      };

      // Test missing field
      // @ts-ignore - Bypassing complex mock resolved value type
      const mockGetMissing = jest.fn().mockResolvedValue(mockDocMissing);
      const mockDocFnMissing = jest
        .fn()
        .mockReturnValue({ get: mockGetMissing });
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFnMissing });
      let result = await getRelatedQuestions('q_missing');
      expect(result).toEqual([]);
      expect(answersUtils.getAnswersByIds).not.toHaveBeenCalled();

      // Test empty array
      // @ts-ignore - Bypassing complex mock resolved value type
      const mockGetEmpty = jest.fn().mockResolvedValue(mockDocEmpty);
      const mockDocFnEmpty = jest.fn().mockReturnValue({ get: mockGetEmpty });
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFnEmpty });
      result = await getRelatedQuestions('q_empty');
      expect(result).toEqual([]);
      expect(answersUtils.getAnswersByIds).not.toHaveBeenCalled();
    });
  });
});

// New tests for the OpenAI and Pinecone integration
describe('Pinecone Integration with Site ID Filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure Pinecone client is properly mocked with correct types
    (
      mockPinecone.listIndexes as jest.Mock<() => Promise<IndexList>>
    ).mockResolvedValue({
      indexes: [
        {
          name: 'dev-related-questions',
          dimension: 3072,
          metric: 'cosine',
          host: 'test.pinecone.io',
          spec: { serverless: { cloud: 'aws', region: 'us-west-2' } },
          status: { ready: true, state: 'Ready' },
          vectorType: 'float32',
        },
      ],
    });
    (
      mockPinecone.describeIndex as jest.Mock<
        (name: string) => Promise<IndexModel>
      >
    ).mockResolvedValue({
      name: 'dev-related-questions',
      dimension: 3072,
      metric: 'cosine',
      host: 'test.pinecone.io',
      spec: { serverless: { cloud: 'aws', region: 'us-west-2' } },
      status: { ready: true, state: 'Ready' },
      vectorType: 'float32',
    });
  });

  describe('upsertEmbeddings', () => {
    // ... existing tests ...
  });

  describe('findRelatedQuestionsPinecone', () => {
    // ... existing tests ...
  });

  describe('updateRelatedQuestions with Pinecone', () => {
    it('should update Firestore with related questions from the same site only', async () => {
      // Set up mocks
      const mockDoc = {
        exists: true,
        data: () => ({
          question: 'How to meditate?',
          relatedQuestionsV2: [], // Initially empty
        }),
      };

      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockUpdate = jest.fn().mockResolvedValue({} as never);
      const mockDocFn = jest.fn().mockReturnValue({
        get: mockGet,
        update: mockUpdate,
      });

      // Apply mocks
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Set SITE_ID for this test
      process.env.SITE_ID = 'test-site-1';

      // Execute the function
      const result = await updateRelatedQuestions('site1-q1');

      // Verify the update was called with site-specific related questions
      expect(mockUpdate).toHaveBeenCalled();
      const updateArgs = mockUpdate.mock.calls[0][0] as any;
      expect(updateArgs).toHaveProperty('relatedQuestionsV2');

      // Verify the related questions in the update are from the same site
      const relatedQuestions =
        updateArgs.relatedQuestionsV2 as RelatedQuestion[];
      expect(Array.isArray(relatedQuestions)).toBe(true);
      relatedQuestions.forEach((q: RelatedQuestion) => {
        expect(q.id.startsWith('site1-')).toBe(true);
      });

      // Verify the returned previous and current related questions
      expect(result).toHaveProperty('previous');
      expect(result).toHaveProperty('current');
      expect(Array.isArray(result.current)).toBe(true);

      // Verify the current related questions are from the correct site
      result.current.forEach((q: RelatedQuestion) => {
        expect(q.id.startsWith('site1-')).toBe(true);
      });
    });
  });

  describe('updateRelatedQuestionsBatch with Pinecone', () => {
    it('should process a batch and update documents with site-specific related questions', async () => {
      // Setup mocks for progress tracking
      const mockProgressDoc = {
        exists: true,
        data: () => ({ lastProcessedId: null }), // Start from beginning
      };

      // @ts-ignore
      const mockProgressGet = jest.fn().mockResolvedValue(mockProgressDoc);
      // @ts-ignore
      const mockProgressSet = jest.fn().mockResolvedValue({} as never);

      const mockProgressDocRef = {
        get: mockProgressGet,
        set: mockProgressSet,
      };

      const mockProgressCollection = {
        doc: jest.fn().mockReturnValue(mockProgressDocRef),
      };

      // Setup mocks for questions
      const mockDocs = [
        {
          id: 'site1-q1',
          data: () => ({
            id: 'site1-q1',
            question: 'Site 1 Question 1',
            relatedQuestionsV2: [],
          }),
        },
        {
          id: 'site1-q2',
          data: () => ({
            id: 'site1-q2',
            question: 'Site 1 Question 2',
            relatedQuestionsV2: [],
          }),
        },
      ];

      const mockQuestionsSnapshot = {
        empty: false,
        docs: mockDocs,
        size: mockDocs.length,
      };

      // @ts-ignore
      const mockAnswersGet = jest.fn().mockResolvedValue(mockQuestionsSnapshot);
      // @ts-ignore
      const mockUpdate = jest.fn().mockResolvedValue({} as never);

      const mockDocRef = {
        update: mockUpdate,
      };

      // @ts-ignore - Bypassing complex mock implementation type
      const mockDoc = jest.fn().mockReturnValue(mockDocRef);

      // Mock for the query chain
      const mockLimit = jest.fn().mockReturnValue({ get: mockAnswersGet });
      const mockStartAfter = jest.fn().mockReturnValue({ limit: mockLimit });
      const mockOrderBy = jest
        .fn()
        .mockReturnValue({ startAfter: mockStartAfter, limit: mockLimit });

      // Combine into the answers collection mock
      const mockAnswersCollection = {
        doc: mockDoc,
        orderBy: mockOrderBy,
      };

      // Set up collection mock
      mockDB.collection = jest.fn().mockImplementation((name) => {
        if (name === 'progress') {
          return mockProgressCollection;
        }
        return mockAnswersCollection;
      });

      // Set SITE_ID for this test
      process.env.SITE_ID = 'test-site-1';

      // Execute the function
      await updateRelatedQuestionsBatch(2);

      // Verify Pinecone upsert was called
      expect(mockPineconeIndex.upsert).toHaveBeenCalled();

      // Get the upsert args to verify site ID in metadata
      const upsertArgs = mockPineconeIndex.upsert.mock.calls[0][0] as any[];
      expect(Array.isArray(upsertArgs)).toBe(true);
      upsertArgs.forEach((vector: any) => {
        expect(vector).toHaveProperty('metadata.siteId', 'test-site-1');
      });

      // Verify Pinecone query was called with the site ID filter
      expect(mockPineconeIndex.query).toHaveBeenCalled();
      mockPineconeIndex.query.mock.calls.forEach((call: any) => {
        expect(call[0]).toHaveProperty('filter.siteId.$eq', 'test-site-1');
      });

      // Verify Firestore documents were updated
      expect(mockUpdate).toHaveBeenCalledTimes(mockDocs.length);

      // Verify progress was updated
      expect(mockProgressSet).toHaveBeenCalledWith({
        lastProcessedId: 'site1-q2',
      });
    });
  });
});
