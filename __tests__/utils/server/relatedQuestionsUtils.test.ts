/**
 * Comprehensive test suite for relatedQuestionsUtils.ts
 * Uses hybrid approach with test dependency injection to test real code
 */

// OpenAI Node.js shim for test environment
import 'openai/shims/node';

import { jest } from '@jest/globals';
import { Answer } from '../../../src/types/answer';

// Set up test environment variables
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.PINECONE_API_KEY = 'test-pinecone-key';
process.env.SITE_ID = 'test-site';
process.env.PINECONE_CLOUD = 'aws';
process.env.PINECONE_REGION = 'us-west-2';

// Mock external dependencies
jest.mock('../../../src/services/firebase', () => {
  const mockDoc = {
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
  };

  const mockCollection = {
    doc: jest.fn(() => mockDoc),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    get: jest.fn(),
  };

  const mockBatch = {
    update: jest.fn(),
    set: jest.fn(),
    commit: jest.fn(),
  };

  return {
    db: {
      collection: jest.fn(() => mockCollection),
      batch: jest.fn(() => mockBatch),
    },
  };
});

jest.mock('../../../src/utils/server/firestoreUtils', () => ({
  getAnswersCollectionName: jest.fn().mockReturnValue('answers'),
}));

jest.mock('../../../src/utils/env', () => ({
  getEnvName: jest.fn().mockReturnValue('test'),
  isDevelopment: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/utils/server/firestoreRetryUtils', () => ({
  firestoreGet: jest.fn(),
  firestoreSet: jest.fn(),
  firestoreUpdate: jest.fn(),
  firestoreQueryGet: jest.fn(),
  firestoreBatchCommit: jest.fn(),
  firestoreAdd: jest.fn(),
}));

jest.mock('@pinecone-database/pinecone', () => ({
  Pinecone: jest.fn().mockImplementation(() => ({
    listIndexes: jest.fn().mockResolvedValue({ indexes: [] }),
    createIndex: jest.fn(),
    describeIndex: jest.fn().mockResolvedValue({ status: { state: 'Ready' } }),
    index: jest.fn().mockReturnValue({
      fetch: jest.fn(),
      query: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
    }),
  })),
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    embeddings: {
      create: jest.fn(),
    },
  })),
}));

jest.mock('../../../src/utils/server/answersUtils', () => ({
  getAnswersByIds: jest.fn(),
}));

// Import the functions to test AFTER mocking
import {
  upsertEmbeddings,
  findRelatedQuestionsPinecone,
  getRelatedQuestions,
  updateRelatedQuestions,
  updateRelatedQuestionsBatch,
  __setTestDependencies,
  __clearTestDependencies,
} from '../../../src/utils/server/relatedQuestionsUtils';

import { db } from '../../../src/services/firebase';
import { firestoreGet } from '../../../src/utils/server/firestoreRetryUtils';
import { getAnswersByIds } from '../../../src/utils/server/answersUtils';

describe('relatedQuestionsUtils - Real Code Tests', () => {
  let mockOpenAI: any;
  let mockPinecone: any;
  let mockPineconeIndex: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up test dependencies
    mockPineconeIndex = {
      upsert: jest.fn().mockResolvedValue({}),
      query: jest.fn().mockResolvedValue({
        matches: [
          { id: 'related-1', score: 0.9, metadata: { questionId: 'related-1' } },
          { id: 'related-2', score: 0.8, metadata: { questionId: 'related-2' } },
        ],
      }),
    };

    mockPinecone = {
      index: jest.fn().mockReturnValue(mockPineconeIndex),
    };

    mockOpenAI = {
      embeddings: {
        create: jest.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      },
    };

    // Inject test dependencies
    __setTestDependencies({
      openai: mockOpenAI,
      pinecone: mockPinecone,
      pineconeIndex: mockPineconeIndex,
      pineconeIndexName: 'test-index',
    });
  });

  afterEach(() => {
    __clearTestDependencies();
  });

  describe('upsertEmbeddings', () => {
    it('should upsert embeddings for questions with original text', async () => {
      const questions = [
        { questionId: 'q1', questionText: 'What is meditation?' },
      ];

      const result = await upsertEmbeddings(questions);

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['What is meditation?'],
      });
      expect(mockPineconeIndex.upsert).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        upsertedCount: 1,
        failedQuestions: [],
      });
    });

    it('should use restated questions when available', async () => {
      const questions = [
        {
          questionId: 'q1',
          questionText: 'What is meditation?',
          restatedQuestion: 'Can you explain what meditation is?',
        },
      ];

      await upsertEmbeddings(questions);

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['Can you explain what meditation is?'],
      });
    });

    it('should handle OpenAI API failures gracefully', async () => {
      mockOpenAI.embeddings.create.mockRejectedValue(new Error('OpenAI API failure'));

      const questions = [
        { questionId: 'q1', questionText: 'What is meditation?' },
      ];

      const result = await upsertEmbeddings(questions);

      expect(result).toEqual({
        success: false,
        upsertedCount: 0,
        failedQuestions: ['q1'],
        error: expect.stringContaining('OpenAI API failure'),
      });
    });

    it('should handle Pinecone upsert failures gracefully', async () => {
      mockPineconeIndex.upsert.mockRejectedValue(new Error('Pinecone upsert failed'));

      const questions = [
        { questionId: 'q1', questionText: 'What is meditation?' },
      ];

      const result = await upsertEmbeddings(questions);

      expect(result).toEqual({
        success: false,
        upsertedCount: 0,
        failedQuestions: ['q1'],
        error: expect.stringContaining('Pinecone upsert failed'),
      });
    });

    it('should handle empty questions array', async () => {
      const result = await upsertEmbeddings([]);

      expect(result).toEqual({
        success: true,
        upsertedCount: 0,
        failedQuestions: [],
      });
      expect(mockOpenAI.embeddings.create).not.toHaveBeenCalled();
      expect(mockPineconeIndex.upsert).not.toHaveBeenCalled();
    });

    it('should handle batch processing with mixed success/failure', async () => {
      // Mock partial failure in Pinecone upsert
      mockPineconeIndex.upsert
        .mockResolvedValueOnce({}) // First batch succeeds
        .mockRejectedValueOnce(new Error('Pinecone failure')); // Second batch fails

      const questions = [
        { questionId: 'q1', questionText: 'Question 1' },
        { questionId: 'q2', questionText: 'Question 2' },
      ];

      const result = await upsertEmbeddings(questions);

      expect(result.success).toBe(false);
      expect(result.upsertedCount).toBe(1);
      expect(result.failedQuestions).toContain('q2');
    });
  });

  describe('findRelatedQuestionsPinecone', () => {
    it('should find related questions using question text', async () => {
      const result = await findRelatedQuestionsPinecone('What is meditation?', 5);

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'What is meditation?',
      });
      expect(mockPineconeIndex.query).toHaveBeenCalledWith({
        vector: expect.any(Array),
        topK: 5,
        includeMetadata: true,
      });
      expect(result).toEqual([
        { questionId: 'related-1', score: 0.9 },
        { questionId: 'related-2', score: 0.8 },
      ]);
    });

    it('should handle OpenAI embedding failure', async () => {
      mockOpenAI.embeddings.create.mockRejectedValue(new Error('OpenAI failure'));

      await expect(findRelatedQuestionsPinecone('test', 5))
        .rejects.toThrow('OpenAI failure');
    });

    it('should handle Pinecone query failure', async () => {
      mockPineconeIndex.query.mockRejectedValue(new Error('Pinecone query failed'));

      await expect(findRelatedQuestionsPinecone('test', 5))
        .rejects.toThrow('Pinecone query failed');
    });

    it('should filter out results without questionId metadata', async () => {
      mockPineconeIndex.query.mockResolvedValue({
        matches: [
          { id: 'valid-1', score: 0.9, metadata: { questionId: 'q1' } },
          { id: 'invalid-1', score: 0.8, metadata: {} }, // No questionId
          { id: 'valid-2', score: 0.7, metadata: { questionId: 'q2' } },
        ],
      });

      const result = await findRelatedQuestionsPinecone('test', 5);

      expect(result).toEqual([
        { questionId: 'q1', score: 0.9 },
        { questionId: 'q2', score: 0.7 },
      ]);
    });

    it('should handle empty results from Pinecone', async () => {
      mockPineconeIndex.query.mockResolvedValue({ matches: [] });

      const result = await findRelatedQuestionsPinecone('test', 5);

      expect(result).toEqual([]);
    });
  });

  describe('updateRelatedQuestions', () => {
    beforeEach(() => {
      // Mock Firestore document get
      (firestoreGet as jest.Mock).mockResolvedValue({
        exists: true,
        data: () => ({
          question: 'What is meditation?',
          restatedQuestion: 'Can you explain meditation?',
        }),
      });

      // Mock Firestore update
      const mockUpdate = jest.fn().mockResolvedValue({});
      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue({
          update: mockUpdate,
        }),
      });
    });

    it('should update related questions for a single question', async () => {
      const result = await updateRelatedQuestions('question-1');

      expect(firestoreGet).toHaveBeenCalled();
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'Can you explain meditation?', // Uses restated question
      });
      expect(mockPineconeIndex.query).toHaveBeenCalled();
      expect(result).toEqual({
        questionId: 'question-1',
        relatedQuestions: [
          { questionId: 'related-1', score: 0.9 },
          { questionId: 'related-2', score: 0.8 },
        ],
      });
    });

    it('should use restated question when available', async () => {
      await updateRelatedQuestions('question-1');

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'Can you explain meditation?',
      });
    });

    it('should handle question not found', async () => {
      (firestoreGet as jest.Mock).mockResolvedValue({
        exists: false,
      });

      await expect(updateRelatedQuestions('nonexistent'))
        .rejects.toThrow('Question not found: nonexistent');
    });

    it('should handle missing question text', async () => {
      (firestoreGet as jest.Mock).mockResolvedValue({
        exists: true,
        data: () => ({}), // No question text
      });

      await expect(updateRelatedQuestions('q1'))
        .rejects.toThrow('Question data or text missing for ID: q1');
    });

    it('should continue on Firestore update failure but return results', async () => {
      const mockUpdate = jest.fn().mockRejectedValue(new Error('Firestore update failed'));
      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue({
          update: mockUpdate,
        }),
      });

      const result = await updateRelatedQuestions('question-1');

      // Should still return results even if update fails
      expect(result).toEqual({
        questionId: 'question-1',
        relatedQuestions: [
          { questionId: 'related-1', score: 0.9 },
          { questionId: 'related-2', score: 0.8 },
        ],
      });
    });
  });

  describe('updateRelatedQuestionsBatch', () => {
    beforeEach(() => {
      // Mock progress document
      const mockProgressDoc = {
        get: jest.fn().mockResolvedValue({
          exists: false,
        }),
        set: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      };

      // Mock questions collection
      const mockQuestionsGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'q1',
            data: () => ({ question: 'Question 1', restatedQuestion: 'Restated 1' }),
          },
          {
            id: 'q2',
            data: () => ({ question: 'Question 2' }),
          },
        ],
      });

      (db.collection as jest.Mock).mockImplementation((collectionName: string) => {
        if (collectionName === 'progress') {
          return { doc: jest.fn().mockReturnValue(mockProgressDoc) };
        }
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          startAfter: jest.fn().mockReturnThis(),
          get: mockQuestionsGet,
          doc: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({}),
          }),
        };
      });

      // Mock batch operations
      const mockBatch = {
        update: jest.fn(),
        commit: jest.fn().mockResolvedValue({}),
      };
      (db.batch as jest.Mock).mockReturnValue(mockBatch);
    });

    it('should process a batch of questions successfully', async () => {
      const result = await updateRelatedQuestionsBatch({ batchSize: 2 });

      expect(result.processedCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(2);
    });

    it('should handle questions with restated questions in batch', async () => {
      await updateRelatedQuestionsBatch({ batchSize: 2 });

      // Should use restated question for q1 and original question for q2
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['Restated 1'],
      });
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['Question 2'],
      });
    });

    it('should handle empty batch gracefully', async () => {
      (db.collection as jest.Mock).mockImplementation((collectionName: string) => {
        if (collectionName === 'progress') {
          return { doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
            set: jest.fn().mockResolvedValue({}),
          })};
        }
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        };
      });

      const result = await updateRelatedQuestionsBatch({ batchSize: 10 });

      expect(result.processedCount).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });

    it('should handle batch embedding generation failure', async () => {
      mockOpenAI.embeddings.create.mockRejectedValue(new Error('OpenAI API failure'));

      try {
        await updateRelatedQuestionsBatch({ batchSize: 2 });
        fail('Expected function to throw');
      } catch (error: any) {
        // Verify the error is from OpenAI
        expect(error.message).toContain('OpenAI API failure');
      }
    });

    it('should handle Firestore batch commit failure with retries', async () => {
      const mockBatch = {
        update: jest.fn(),
        commit: jest.fn()
          .mockRejectedValueOnce(new Error('Firestore batch failed'))
          .mockRejectedValueOnce(new Error('Firestore batch failed'))
          .mockResolvedValueOnce({}), // Succeeds on third try
      };
      (db.batch as jest.Mock).mockReturnValue(mockBatch);

      const result = await updateRelatedQuestionsBatch({ batchSize: 2 });

      expect(mockBatch.commit).toHaveBeenCalledTimes(3);
      expect(result.successCount).toBe(2);
    });

    it('should test batch processing with lastProcessedId not found', async () => {
      // Mock scenario where lastProcessedId doesn't exist in current batch
      const mockQuestionsGet = jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'q3', // Different from lastProcessedId
            data: () => ({ question: 'Question 3' }),
          },
        ],
      });

      (db.collection as jest.Mock).mockImplementation((collectionName: string) => {
        if (collectionName === 'progress') {
          return { doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ lastProcessedId: 'q1' }), // Not in current batch
            }),
            update: jest.fn().mockResolvedValue({}),
          })};
        }
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          startAfter: jest.fn().mockReturnThis(),
          get: mockQuestionsGet,
          doc: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({}),
          }),
        };
      });

      const result = await updateRelatedQuestionsBatch({ batchSize: 10 });

      expect(result.processedCount).toBe(1);
      expect(result.successCount).toBe(1);
    });

    it('should test updateRelatedQuestionsBatch with actual question processing', async () => {
      // Mock more realistic scenario with progress tracking
      let progressUpdateCalls = 0;
      const mockProgressDoc = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ lastProcessedId: null }),
        }),
        update: jest.fn().mockImplementation(() => {
          progressUpdateCalls++;
          return Promise.resolve({});
        }),
      };

      (db.collection as jest.Mock).mockImplementation((collectionName: string) => {
        if (collectionName === 'progress') {
          return { doc: jest.fn().mockReturnValue(mockProgressDoc) };
        }
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'q1',
                data: () => ({ question: 'Test question 1' }),
              },
            ],
          }),
          doc: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({}),
          }),
        };
      });

      const result = await updateRelatedQuestionsBatch({ batchSize: 1 });

      expect(result.processedCount).toBe(1);
      expect(progressUpdateCalls).toBeGreaterThan(0);
    });
  });

  describe('getRelatedQuestions', () => {
    beforeEach(() => {
      const mockDoc = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            relatedQuestionsV2: [
              { questionId: 'related-1', score: 0.9 },
              { questionId: 'related-2', score: 0.8 },
              { questionId: 'source-question', score: 0.7 }, // Should be filtered out
            ],
          }),
        }),
      };

      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue(mockDoc),
      });

      // Mock getAnswersByIds
      (getAnswersByIds as jest.Mock).mockResolvedValue([
        { id: 'related-1', question: 'Related question 1' } as Answer,
        { id: 'related-2', question: 'Related question 2' } as Answer,
      ]);
    });

    it('should return related questions for valid question ID', async () => {
      const result = await getRelatedQuestions('source-question');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'related-1',
        question: 'Related question 1',
      });
      expect(result[1]).toEqual({
        id: 'related-2',
        question: 'Related question 2',
      });
    });

    it('should return empty array for non-existent question ID', async () => {
      const mockDoc = {
        get: jest.fn().mockResolvedValue({
          exists: false,
        }),
      };

      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue(mockDoc),
      });

      const result = await getRelatedQuestions('nonexistent');

      expect(result).toEqual([]);
    });

    it('should return empty array when document data is undefined', async () => {
      const mockDoc = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => undefined,
        }),
      };

      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue(mockDoc),
      });

      const result = await getRelatedQuestions('question-id');

      expect(result).toEqual([]);
    });

    it('should handle missing relatedQuestionsV2 field', async () => {
      const mockDoc = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({}), // No relatedQuestionsV2 field
        }),
      };

      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue(mockDoc),
      });

      const result = await getRelatedQuestions('question-id');

      expect(result).toEqual([]);
    });

    it('should filter out source question ID from results', async () => {
      const result = await getRelatedQuestions('source-question');

      // Should not include the source question itself
      expect(result).toHaveLength(2);
      expect(result.map(q => q.id)).not.toContain('source-question');
    });

    it('should handle getAnswersByIds failure gracefully', async () => {
      (getAnswersByIds as jest.Mock).mockRejectedValue(new Error('Database error'));

      const result = await getRelatedQuestions('source-question');

      expect(result).toEqual([]);
    });
  });

  describe('Advanced Coverage Tests - Targeting 70%', () => {
    it('should test batch processing with progress tracking', async () => {
      // Test the progress tracking logic specifically
      const mockProgressDoc = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ lastProcessedId: 'q1' }),
        }),
        update: jest.fn().mockResolvedValue({}),
      };

      (db.collection as jest.Mock).mockImplementation((collectionName: string) => {
        if (collectionName === 'progress') {
          return { doc: jest.fn().mockReturnValue(mockProgressDoc) };
        }
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          startAfter: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'q2',
                data: () => ({ question: 'Question 2' }),
              },
            ],
          }),
          doc: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({}),
          }),
        };
      });

      const result = await updateRelatedQuestionsBatch({ batchSize: 1 });

      expect(mockProgressDoc.update).toHaveBeenCalledWith({
        lastProcessedId: 'q2',
        lastUpdated: expect.any(Object),
      });
      expect(result.processedCount).toBe(1);
    });

    it('should test error handling in batch processing with non-retryable errors', async () => {
      // Test non-retryable Firestore errors
      const mockBatch = {
        update: jest.fn(),
        commit: jest.fn().mockRejectedValue(new Error('PERMISSION_DENIED')),
      };
      (db.batch as jest.Mock).mockReturnValue(mockBatch);

      try {
        await updateRelatedQuestionsBatch({ batchSize: 1 });
        fail('Expected function to throw');
      } catch (error: any) {
        // Verify it's the expected error
        expect(error.message).toContain('PERMISSION_DENIED');
      }
    });

    it('should test getQuestionsBatch with cursor pagination', async () => {
      // Test the internal getQuestionsBatch function through batch processing
      const mockQuestionsGet = jest.fn()
        .mockResolvedValueOnce({
          docs: [
            {
              id: 'q1',
              data: () => ({ question: 'Question 1' }),
            },
          ],
        })
        .mockResolvedValueOnce({
          docs: [], // Empty second batch
        });

      (db.collection as jest.Mock).mockImplementation((collectionName: string) => {
        if (collectionName === 'progress') {
          return { doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
            set: jest.fn().mockResolvedValue({}),
          })};
        }
        return {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: mockQuestionsGet,
          doc: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({}),
          }),
        };
      });

      const result = await updateRelatedQuestionsBatch({ batchSize: 1 });

      expect(result.processedCount).toBe(1);
      expect(mockQuestionsGet).toHaveBeenCalledTimes(2); // Once for batch, once for next check
    });

    it('should test findRelatedQuestionsPineconeWithEmbedding function', async () => {
      // Test the function that accepts pre-computed embeddings
      const embedding = new Array(1536).fill(0.1);

      // This tests the direct embedding path in findRelatedQuestionsPinecone
      mockPineconeIndex.query.mockResolvedValue({
        matches: [
          { id: 'test-1', score: 0.95, metadata: { questionId: 'test-1' } },
        ],
      });

      const result = await findRelatedQuestionsPinecone(embedding, 5);

      expect(mockPineconeIndex.query).toHaveBeenCalledWith({
        vector: embedding,
        topK: 5,
        includeMetadata: true,
      });
      expect(result).toEqual([
        { questionId: 'test-1', score: 0.95 },
      ]);
      // Should not call OpenAI when embedding is provided
      expect(mockOpenAI.embeddings.create).not.toHaveBeenCalled();
    });

    it('should test database availability checks', async () => {
      // Test the checkDbAvailable function through getRelatedQuestions
      const mockDoc = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ relatedQuestionsV2: [] }),
        }),
      };

      (db.collection as jest.Mock).mockReturnValue({
        doc: jest.fn().mockReturnValue(mockDoc),
      });

      const result = await getRelatedQuestions('test-id');

      expect(db.collection).toHaveBeenCalledWith('answers');
      expect(result).toEqual([]);
    });
  });
});