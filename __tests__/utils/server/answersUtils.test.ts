/**
 * Unit tests for the answersUtils module
 *
 * This file tests the utility functions for handling answers, including:
 * - Getting answers by IDs
 * - Parsing and cleaning sources data
 * - Getting total document count with caching
 */

import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';

// Mock modules first before importing any modules that use them
// Mock Firebase DB
jest.mock('@/services/firebase', () => {
  return {
    db: {
      collection: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      get: jest.fn(),
      stream: jest.fn(),
    },
  };
});

// Mock cache utils
jest.mock('@/utils/server/redisUtils', () => ({
  getFromCache: jest.fn(),
  setInCache: jest.fn(),
  CACHE_EXPIRATION: 3600,
}));

// Mock environment and collection name utilities
jest.mock('@/utils/env', () => ({
  getEnvName: jest.fn().mockReturnValue('test'),
}));

jest.mock('@/utils/server/firestoreUtils', () => ({
  getAnswersCollectionName: jest.fn().mockReturnValue('answers'),
}));

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  firestore: {
    FieldPath: {
      documentId: jest.fn().mockReturnValue('id'),
    },
  },
}));

// Import the functions after mocking dependencies
import {
  getAnswersByIds,
  parseAndRemoveWordsFromSources,
  getTotalDocuments,
} from '@/utils/server/answersUtils';

// Get the mocked modules after import
const mockDb = jest.requireMock('@/services/firebase').db;
const mockCollection = mockDb.collection;
const mockWhere = mockDb.where;
const mockGet = mockDb.get;
const mockGetFromCache = jest.requireMock(
  '@/utils/server/redisUtils',
).getFromCache;
const mockSetInCache = jest.requireMock('@/utils/server/redisUtils').setInCache;

describe('answersUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAnswersByIds', () => {
    it('should return answers for valid IDs', async () => {
      const mockAnswers = [
        {
          id: 'answer1',
          question: 'Test question 1?',
          answer: 'Test answer 1',
          sources: JSON.stringify([
            {
              pageContent: 'Test source content',
              metadata: {
                title: 'Test source',
                full_info: 'This should be removed',
              },
            },
          ]),
          timestamp: { _seconds: 1234567890, _nanoseconds: 0 },
          likeCount: 5,
        },
      ];

      const mockSnapshot = {
        forEach: jest.fn((callback) => {
          mockAnswers.forEach((answer) => {
            callback({
              id: answer.id,
              data: () => ({
                ...answer,
              }),
            });
          });
        }),
      };

      mockGet.mockResolvedValue(mockSnapshot);

      const result = await getAnswersByIds(['answer1']);

      expect(mockCollection).toHaveBeenCalledWith('answers');
      expect(mockWhere).toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalled();
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('answer1');
      expect(result[0].question).toBe('Test question 1?');
      // Check that the sources have been processed
      expect(Array.isArray(result[0].sources)).toBe(true);
      if (result[0].sources) {
        // Test that full_info has been removed from metadata
        expect('full_info' in result[0].sources[0].metadata).toBe(false);
      }
    });

    it('should throw an error when database is not available', async () => {
      // Save the original mock implementation
      const originalDb = jest.requireMock('@/services/firebase').db;

      // Override the db property with null
      Object.defineProperty(jest.requireMock('@/services/firebase'), 'db', {
        get: () => null,
      });

      await expect(getAnswersByIds(['answer1'])).rejects.toThrow(
        'Database not available',
      );

      // Restore the original mock
      Object.defineProperty(jest.requireMock('@/services/firebase'), 'db', {
        get: () => originalDb,
      });
    });

    it('should handle database query errors', async () => {
      mockGet.mockRejectedValue(new Error('Database error'));

      await expect(getAnswersByIds(['answer1'])).rejects.toThrow(
        'Database error',
      );
    });

    it('should process IDs in batches', async () => {
      // Create an array of 15 IDs to test batch processing
      const ids = Array.from({ length: 15 }, (_, i) => `answer${i + 1}`);

      // Empty snapshot mock
      const mockSnapshot = {
        forEach: jest.fn(),
      };

      mockGet.mockResolvedValue(mockSnapshot);

      await getAnswersByIds(ids);

      // Should have called get twice (once for each batch of 10)
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('parseAndRemoveWordsFromSources', () => {
    it('should parse string sources into array', () => {
      const sourcesString = JSON.stringify([
        {
          pageContent: 'Test content',
          metadata: {
            title: 'Source title',
            full_info: 'Should be removed',
          },
        },
      ]);

      const result = parseAndRemoveWordsFromSources(sourcesString);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].pageContent).toBe('Test content');
      expect(result[0].metadata.title).toBe('Source title');
      expect('full_info' in result[0].metadata).toBe(false);
    });

    it('should handle array sources', () => {
      const sourcesArray: Document<DocMetadata>[] = [
        {
          pageContent: 'Test content',
          metadata: {
            title: 'Source title',
            type: 'text',
            library: 'test-library',
            full_info: 'Should be removed',
          } as DocMetadata,
        },
      ];

      const result = parseAndRemoveWordsFromSources(sourcesArray);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].pageContent).toBe('Test content');
      expect(result[0].metadata.title).toBe('Source title');
      expect('full_info' in result[0].metadata).toBe(false);
    });

    it('should return empty array for undefined sources', () => {
      const result = parseAndRemoveWordsFromSources(undefined);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle parsing errors gracefully', () => {
      // Invalid JSON string
      const invalidJson = '{ invalid: json }';

      // Mock console.error to prevent test output pollution
      const originalConsoleError = console.error;
      console.error = jest.fn();

      const result = parseAndRemoveWordsFromSources(invalidJson);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
      expect(console.error).toHaveBeenCalled();

      // Restore console.error
      console.error = originalConsoleError;
    });
  });

  describe('getTotalDocuments', () => {
    it('should return cached count if available', async () => {
      mockGetFromCache.mockResolvedValue('42');

      const result = await getTotalDocuments();

      expect(result).toBe(42);
      expect(mockGetFromCache).toHaveBeenCalledWith(
        'test_default_answers_count',
      );
      expect(mockCollection).not.toHaveBeenCalled(); // DB shouldn't be called
    });

    it('should count documents and cache result if not in cache', async () => {
      mockGetFromCache.mockResolvedValue(null);

      // Mock stream to emit 3 documents
      const mockStream = {
        [Symbol.asyncIterator]: jest.fn().mockImplementation(() => {
          let count = 0;
          return {
            next: () => {
              if (count < 3) {
                count++;
                return Promise.resolve({ done: false, value: {} });
              }
              return Promise.resolve({ done: true });
            },
          };
        }),
      };

      mockDb.stream.mockReturnValue(mockStream);

      const result = await getTotalDocuments();

      expect(result).toBe(3);
      expect(mockCollection).toHaveBeenCalledWith('answers');
      expect(mockSetInCache).toHaveBeenCalledWith(
        'test_default_answers_count',
        '3',
        expect.any(Number),
      );
    });

    it('should throw an error when database is not available', async () => {
      mockGetFromCache.mockResolvedValue(null);

      // Save the original mock implementation
      const originalDb = jest.requireMock('@/services/firebase').db;

      // Override the db property with null
      Object.defineProperty(jest.requireMock('@/services/firebase'), 'db', {
        get: () => null,
      });

      await expect(getTotalDocuments()).rejects.toThrow(
        'Database not available',
      );

      // Restore the original mock
      Object.defineProperty(jest.requireMock('@/services/firebase'), 'db', {
        get: () => originalDb,
      });
    });
  });
});
