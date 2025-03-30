/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/prefer-ts-expect-error */
/* eslint-disable @typescript-eslint/ban-types */

// Unit tests for relatedQuestionsUtils.ts
// Tests the functionality for managing related questions

// Define types to help with mocking
type MockDoc = {
  exists: boolean;
  data: () => any;
  id?: string;
};

type MockSnapshot = {
  empty: boolean;
  docs: Array<{ id: string; data: () => any }>;
  forEach?: (callback: (doc: any) => void) => void;
};

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
jest.mock('firebase-admin', () => {
  return {
    credential: {
      cert: jest.fn().mockReturnValue({}),
    },
    initializeApp: jest.fn().mockReturnValue({}),
    firestore: jest.fn().mockReturnValue({}),
    apps: ['mockApp'], // Mock that Firebase is already initialized
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

jest.mock('natural', () => ({
  TfIdf: jest.fn(() => ({
    addDocument: jest.fn(),
    listTerms: jest.fn(() => [
      { term: 'meditation', tfidf: 0.5 },
      { term: 'practice', tfidf: 0.3 },
    ]),
    documents: [{}],
  })),
}));

jest.mock('node-rake', () => ({
  generate: jest.fn(() => ['meditation', 'techniques']),
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
  extractAndStoreKeywords,
  fetchKeywords,
  updateRelatedQuestions,
  findRelatedQuestionsUsingKeywords,
} from '../../../utils/server/relatedQuestionsUtils';
import { Answer } from '@/types/answer';

// Import mocked modules after mocking
import * as redisUtils from '@/utils/server/redisUtils';
import * as answersUtils from '@/utils/server/answersUtils';
import rake from 'node-rake';

describe('relatedQuestionsUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRelatedQuestions', () => {
    it('should return related questions successfully', async () => {
      // Setup mocks
      const mockDoc = {
        exists: true,
        data: () => ({ relatedQuestionsV2: ['related1', 'related2'] }),
      };

      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockDocFn = jest.fn().mockReturnValue({ get: mockGet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Apply mocks
      mockDB.collection = mockCollection;

      const mockRelatedQuestions = [
        { id: 'related1', question: 'Related question 1', answer: 'Answer 1' },
        { id: 'related2', question: 'Related question 2', answer: 'Answer 2' },
      ];

      jest
        .mocked(answersUtils.getAnswersByIds)
        .mockResolvedValue(mockRelatedQuestions as any);

      // Execute
      const result = await getRelatedQuestions('question1');

      // Verify
      expect(result).toEqual(mockRelatedQuestions);
      expect(mockCollection).toHaveBeenCalledWith('answers');
      expect(mockDocFn).toHaveBeenCalledWith('question1');
      expect(answersUtils.getAnswersByIds).toHaveBeenCalledWith([
        'related1',
        'related2',
      ]);
    });

    it('should throw error if document does not exist', async () => {
      // Setup mocks
      const mockDoc = { exists: false };
      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockDocFn = jest.fn().mockReturnValue({ get: mockGet });
      const mockCollection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Apply mocks
      mockDB.collection = mockCollection;

      // Execute and verify
      await expect(getRelatedQuestions('nonexistent')).rejects.toThrow(
        'QA document not found',
      );
    });
  });

  describe('fetchKeywords', () => {
    it('should return keywords from cache if available', async () => {
      // Mock data
      const cachedKeywords = [
        { id: 'q1', keywords: ['meditation'], title: 'How to meditate?' },
      ];

      // Setup mocks
      jest
        .mocked(redisUtils.getFromCache)
        .mockResolvedValue(cachedKeywords as any);

      // Execute
      const result = await fetchKeywords();

      // Verify
      expect(result).toEqual(cachedKeywords);
      expect(redisUtils.getFromCache).toHaveBeenCalled();
    });

    it('should fetch keywords from Firestore if not in cache', async () => {
      // Setup mocks
      jest.mocked(redisUtils.getFromCache).mockResolvedValue(null as any);

      const mockDocs = [
        {
          id: 'q1',
          data: () => ({ keywords: ['meditation'], title: 'How to meditate?' }),
        },
      ];

      const mockSnapshot = {
        forEach: jest.fn((callback: any) => mockDocs.forEach(callback)),
      };

      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockSnapshot);
      const mockCollection = jest.fn().mockReturnValue({ get: mockGet });

      // Apply mocks
      mockDB.collection = mockCollection;

      // Execute
      const result = await fetchKeywords();

      // Verify
      expect(result[0].id).toBe('q1');
      expect(result[0].keywords).toEqual(['meditation']);
      expect(redisUtils.setInCache).toHaveBeenCalled();
    });
  });

  describe('findRelatedQuestionsUsingKeywords', () => {
    it('should find related questions by similarity', async () => {
      // Test data
      const newKeywords = ['meditation', 'practice'];
      const allKeywords = [
        {
          id: 'q1',
          keywords: ['meditation', 'practice'],
          title: 'Original question',
        },
        {
          id: 'q2',
          keywords: ['meditation', 'technique'],
          title: 'Related question 1',
        },
        { id: 'q3', keywords: ['meditation'], title: 'Related question 2' },
        { id: 'q4', keywords: ['unrelated'], title: 'Unrelated question' },
      ];

      // Execute
      const result = await findRelatedQuestionsUsingKeywords(
        newKeywords,
        allKeywords,
        0.1, // threshold
        'q1', // Original question ID
        'Original question',
      );

      // Verify
      expect(result.length).toBeGreaterThan(0);
      expect(result.find((q) => q.id === 'q1')).toBeUndefined(); // Should not include the original question

      // Related questions should have proper structure
      result.forEach((question) => {
        expect(question).toHaveProperty('id');
        expect(question).toHaveProperty('title');
        expect(question).toHaveProperty('similarity');
        expect(question.similarity).toBeGreaterThanOrEqual(0.1); // Should be above threshold
      });
    });

    it('should filter out duplicate titles', async () => {
      // Test data with duplicate titles
      const newKeywords = ['meditation'];
      const allKeywords = [
        { id: 'q1', keywords: ['meditation'], title: 'Original question' },
        {
          id: 'q2',
          keywords: ['meditation', 'technique'],
          title: 'Duplicate title',
        }, // Higher similarity
        { id: 'q3', keywords: ['meditation'], title: 'Duplicate title' }, // Lower similarity
        { id: 'q4', keywords: ['meditation'], title: 'Unique title' },
      ];

      // Execute
      const result = await findRelatedQuestionsUsingKeywords(
        newKeywords,
        allKeywords,
        0.1,
        'q1',
        'Original question',
      );

      // Check for no duplicate titles
      const titles = result.map((q) => q.title);
      const uniqueTitles = new Set(titles);
      expect(uniqueTitles.size).toBe(titles.length);

      // Should include 'Duplicate title' only once
      const duplicateTitles = result.filter(
        (q) => q.title === 'Duplicate title',
      );
      expect(duplicateTitles.length).toBe(1);
    });
  });

  describe('updateRelatedQuestions', () => {
    it('should update related questions for a specific question', async () => {
      // Setup mocks
      // Mock for get
      const mockDoc = {
        exists: true,
        id: 'q1',
        data: () => ({ question: 'How to meditate?' }),
      };

      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockUpdate = jest.fn();
      const mockDocFn = jest.fn().mockReturnValue({
        get: mockGet,
        update: mockUpdate,
      });

      // Apply mocks
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Mock keywords
      const mockKeywords = [
        { id: 'q1', keywords: ['meditation'], title: 'How to meditate?' },
        {
          id: 'q2',
          keywords: ['meditation', 'technique'],
          title: 'Advanced meditation techniques',
        },
      ];

      jest
        .mocked(redisUtils.getFromCache)
        .mockResolvedValue(mockKeywords as any);
      jest.mocked(rake.generate).mockReturnValue(['meditation', 'practice']);

      // Execute
      const result = await updateRelatedQuestions('q1');

      // Verify
      expect(Array.isArray(result)).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();

      // The result should have the correct structure
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id');
        expect(result[0]).toHaveProperty('title');
        expect(result[0]).toHaveProperty('similarity');
      }
    });

    it('should handle errors when fetching keywords fails', async () => {
      // Mock console.error to verify it's called
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Setup mocks
      const mockDoc = {
        exists: true,
        id: 'q1',
        data: () => ({ question: 'How to meditate?' }),
      };

      // @ts-ignore
      const mockGet = jest.fn().mockResolvedValue(mockDoc);
      const mockDocFn = jest.fn().mockReturnValue({
        get: mockGet,
      });

      // Apply mocks
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFn });

      // Mock error when fetching keywords
      const testError = new Error('Test error fetching keywords');
      jest.mocked(redisUtils.getFromCache).mockRejectedValue(testError);

      // Execute and verify
      await expect(updateRelatedQuestions('q1')).rejects.toThrow(testError);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("updateRelatedQuestions: Can't process"),
        testError,
      );

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });

  describe('extractAndStoreKeywords', () => {
    it('should extract and store keywords for valid questions', async () => {
      // Mock data
      const mockQuestions = [
        { id: 'q1', question: 'How to meditate?' },
        { id: 'q2', question: 'Advanced meditation techniques' },
      ] as Answer[];

      // Setup mocks
      jest.mocked(redisUtils.getFromCache).mockResolvedValue(null as any);

      const mockBatch = {
        set: jest.fn(),
        commit: jest.fn(),
      };

      const mockDocRef = {};
      const mockDocFn = jest.fn().mockReturnValue(mockDocRef);

      // Apply mocks
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFn });
      mockDB.batch = jest.fn().mockReturnValue(mockBatch);

      // Execute
      await extractAndStoreKeywords(mockQuestions);

      // Verify
      expect(mockBatch.set).toHaveBeenCalled();
      expect(mockBatch.commit).toHaveBeenCalled();
      expect(redisUtils.setInCache).toHaveBeenCalled();
    });

    it('should skip invalid questions', async () => {
      // Mock console.warn to verify it's called
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      // Mock data with invalid questions
      const mockQuestions = [
        { id: 'q1', question: undefined }, // Invalid - missing question
        { id: 'q2', question: '' }, // Invalid - empty question
        { id: 'q3', question: 'Valid question' }, // Valid
      ] as unknown as Answer[];

      // Setup mocks
      jest.mocked(redisUtils.getFromCache).mockResolvedValue(null as any);

      const mockBatch = {
        set: jest.fn(),
        commit: jest.fn(),
      };

      const mockDocRef = {};
      const mockDocFn = jest.fn().mockReturnValue(mockDocRef);

      // Apply mocks
      mockDB.collection = jest.fn().mockReturnValue({ doc: mockDocFn });
      mockDB.batch = jest.fn().mockReturnValue(mockBatch);

      // Execute
      await extractAndStoreKeywords(mockQuestions);

      // Verify warnings were logged for invalid questions
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('q1'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('q2'),
      );

      // Verify only valid questions were processed
      expect(mockBatch.set).toHaveBeenCalledTimes(1);

      // Restore console.warn
      consoleWarnSpy.mockRestore();
    });
  });

  describe('updateRelatedQuestionsBatch', () => {
    it('should process a batch of questions', async () => {
      // Setup mocks
      // Setup progress document
      const mockProgressDoc: MockDoc = {
        exists: true,
        data: () => ({ lastProcessedId: 'lastId' }),
      };

      // Mock progress document get and set
      // @ts-ignore - Tell TypeScript to ignore type mismatch
      const mockProgressGet = jest.fn().mockResolvedValue(mockProgressDoc);
      // @ts-ignore - Tell TypeScript to ignore type mismatch
      const mockProgressSet = jest.fn().mockResolvedValue();

      // Create a mock for progress document operations
      const mockProgressDocRef = {
        get: mockProgressGet,
        set: mockProgressSet,
      };

      // Mock the progress collection and document access
      const mockProgressCollection = {
        doc: jest.fn().mockReturnValue(mockProgressDocRef),
      };

      // Setup questions collection
      const mockDocs = [
        { id: 'q1', data: () => ({ question: 'Question 1' }) },
        { id: 'q2', data: () => ({ question: 'Question 2' }) },
      ];

      // Create a mock for the query snapshot
      const mockQuestionsSnapshot: MockSnapshot = {
        empty: false,
        docs: mockDocs,
      };

      // Mock for the last document (needed for startAfter)
      const mockLastDoc: MockDoc = {
        exists: true,
        data: () => ({ question: 'Last Question' }),
      };

      // Mock functions for answersCollection operations
      // @ts-ignore - Tell TypeScript to ignore type mismatch
      const mockAnswersGet = jest.fn().mockResolvedValue(mockQuestionsSnapshot);
      // @ts-ignore - Tell TypeScript to ignore type mismatch
      const mockLastDocGet = jest.fn().mockResolvedValue(mockLastDoc);

      // Mock for document updates
      // @ts-ignore - Tell TypeScript to ignore type mismatch
      const mockUpdate = jest.fn().mockResolvedValue();

      // Mock for document references based on ID
      const mockAnswersDocRef = jest.fn().mockImplementation((id) => {
        if (id === 'lastId') {
          return { get: mockLastDocGet };
        }
        return {
          update: mockUpdate,
          // @ts-ignore - Tell TypeScript to ignore type mismatch
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ question: 'Test' }),
          }),
        };
      });

      // Mock for the query chain
      const mockStartAfter = jest.fn().mockReturnValue({ get: mockAnswersGet });
      const mockLimit = jest
        .fn()
        .mockReturnValue({ startAfter: mockStartAfter });
      const mockOrderBy = jest.fn().mockReturnValue({ limit: mockLimit });

      // Combine into the answers collection mock
      const mockAnswersCollection = {
        doc: mockAnswersDocRef,
        orderBy: mockOrderBy,
      };

      // Set up collection mock to handle different collection names
      mockDB.collection = jest.fn().mockImplementation((name) => {
        if (name === 'progress') {
          return mockProgressCollection;
        }
        return mockAnswersCollection;
      });

      // Mock keywords
      const mockKeywords = [
        { id: 'q1', keywords: ['keyword1'], title: 'Question 1' },
        { id: 'q2', keywords: ['keyword2'], title: 'Question 2' },
      ];

      jest
        .mocked(redisUtils.getFromCache)
        .mockResolvedValue(mockKeywords as any);

      // Execute
      await updateRelatedQuestionsBatch(10);

      // Verify function calls
      expect(mockDB.collection).toHaveBeenCalledWith('progress');
      expect(mockProgressDocRef.get).toHaveBeenCalled();
      expect(mockOrderBy).toHaveBeenCalledWith('timestamp', 'desc');
      expect(mockLimit).toHaveBeenCalledWith(10);
      expect(mockLastDocGet).toHaveBeenCalled();
      expect(mockStartAfter).toHaveBeenCalled();
      expect(mockAnswersGet).toHaveBeenCalled();

      // Verify progress was updated
      expect(mockProgressSet).toHaveBeenCalledWith(
        expect.objectContaining({
          lastProcessedId: expect.any(String),
        }),
      );
    });
  });
});
