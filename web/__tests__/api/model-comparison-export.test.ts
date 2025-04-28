/**
 * Tests for the Model Comparison Export API
 *
 * This file tests the functionality of the model-comparison-export API endpoint, including:
 * - Rate limiting functionality
 * - Authentication requirements
 * - Export format options (CSV, JSON)
 * - Date filtering
 */

import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock Firebase BEFORE any imports - this runs before anything else due to Jest hoisting
jest.mock('@/services/firebase', () => {
  // Define the base mock collection function
  const mockCollection = jest.fn().mockReturnThis();

  // Define document mock with get function
  const mockDoc = jest.fn().mockReturnThis();

  // Define the get function with configurable return value
  const mockGet = jest.fn().mockResolvedValue({
    exists: false,
    data: () => null,
  });

  // Mock for where, orderBy, limit to support queries
  const mockWhere = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const mockLimit = jest.fn().mockReturnThis();

  // Default empty docs array for get on collections
  const mockDocs: Array<{ id: string; data: () => any }> = [];

  return {
    db: {
      collection: mockCollection,
      doc: mockDoc,
      get: mockGet,
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
    },
    // Export mock functions for test control
    mockCollection,
    mockDoc,
    mockGet,
    mockWhere,
    mockOrderBy,
    mockLimit,
    mockDocs,
  };
});

// Also mock genericRateLimiter because it imports Firebase
jest.mock('@/utils/server/genericRateLimiter', () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
  deleteRateLimitCounter: jest.fn().mockResolvedValue(undefined),
}));

// Mock JWT authentication
jest.mock('@/utils/server/jwtUtils', () => ({
  withJwtAuth: jest.fn((handler) => handler),
}));

// Mock the sudo cookie check
jest.mock('@/utils/server/sudoCookieUtils', () => ({
  getSudoCookie: jest
    .fn()
    .mockReturnValue({ sudoCookieValue: 'valid-sudo-token' }),
}));

// Mock apiMiddleware
jest.mock('@/utils/server/apiMiddleware', () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

// Mock loadSiteConfig module
jest.mock('@/utils/server/loadSiteConfig', () => ({
  loadSiteConfigSync: jest.fn().mockReturnValue({
    siteId: 'test-site',
    enableModelComparison: true,
  }),
}));

// Global mock for Firestore
const mockFirestore = jest.requireMock('@/services/firebase');

// Mock environment check
jest.mock('@/utils/env', () => ({
  isDevelopment: jest.fn().mockReturnValue(false),
  getEnvName: jest.fn().mockReturnValue('production'),
}));

// Import the handler after all mocks are set up
import handler from '@/pages/api/model-comparison-export';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

describe('Model Comparison Export API', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default behavior allowing requests
    (genericRateLimiter as jest.Mock).mockResolvedValue(true);
  });

  test('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res._getJSONData()).toEqual({ error: 'Method not allowed' });
  });

  test('should respect rate limits', async () => {
    // Mock the rate limiter to reject the request
    (genericRateLimiter as jest.Mock).mockImplementation((req, res) => {
      res.status(429).json({
        message: 'Too many requests, please try again later',
      });
      return Promise.resolve(false);
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(429);
    expect(res._getJSONData()).toEqual({
      message: 'Too many requests, please try again later',
    });
  });

  test('should require sudo access', async () => {
    // Mock getSudoCookie to return no sudo cookie
    const sudoCookieUtils = jest.requireMock('@/utils/server/sudoCookieUtils');
    sudoCookieUtils.getSudoCookie.mockReturnValueOnce({
      sudoCookieValue: null,
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({
      error: 'Unauthorized: Sudo access required',
    });
  });

  test('should return empty array when no submissions are found', async () => {
    // Mock Firestore to return empty array
    const emptySnapshot = {
      docs: [],
      empty: true,
    };

    // Configure where chain to return our empty snapshot
    mockFirestore.db.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue(emptySnapshot),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const headers = res._getHeaders();
    expect(headers['content-type']).toBe('application/json');
    expect(headers['content-disposition']).toContain(
      'attachment; filename=model-comparison-votes-',
    );
    expect(headers['content-disposition']).toContain('.json');
    expect(res._getJSONData()).toEqual([]);
  });

  test('should generate JSON for valid submissions by default', async () => {
    // Fixed Firebase timestamp for consistent tests
    const mockTimestamp = {
      toDate: () => new Date('2023-04-15T10:30:00Z'),
      seconds: 1681556600,
      nanoseconds: 0,
    };

    // Mock data for submissions
    const mockSubmissions = [
      {
        id: 'submission1',
        data: () => ({
          timestamp: mockTimestamp,
          winner: 'A',
          modelAConfig: {
            model: 'Claude 3',
            temperature: 0.7,
          },
          modelBConfig: {
            model: 'GPT-4',
            temperature: 0.5,
          },
          question: 'What is consciousness?',
          reasons: {
            moreAccurate: true,
            betterWritten: true,
            moreHelpful: false,
            betterReasoning: true,
            betterSourceUse: false,
          },
          userComments: 'Model A was more thorough',
          collection: 'test-collection',
        }),
      },
      {
        id: 'submission2',
        data: () => ({
          timestamp: mockTimestamp,
          winner: 'B',
          modelAConfig: {
            model: 'Claude 3',
            temperature: 0.7,
          },
          modelBConfig: {
            model: 'GPT-4',
            temperature: 0.5,
          },
          question: 'How do I meditate?',
          reasons: {
            moreAccurate: false,
            betterWritten: true,
            moreHelpful: true,
            betterReasoning: false,
            betterSourceUse: false,
          },
          userComments: 'Model B was clearer',
          collection: 'test-collection',
        }),
      },
    ];

    // Mock snapshot with our test data
    const mockSnapshot = {
      docs: mockSubmissions,
      empty: false,
    };

    // Configure Firestore mock
    mockFirestore.db.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue(mockSnapshot),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    // Check response
    expect(res.statusCode).toBe(200);
    const headers = res._getHeaders();
    expect(headers['content-type']).toBe('application/json');
    expect(headers['content-disposition']).toContain(
      'attachment; filename=model-comparison-votes-',
    );
    expect(headers['content-disposition']).toContain('.json');

    // Check the JSON response
    const jsonResponse = res._getJSONData();
    expect(jsonResponse).toHaveLength(2);
    expect(jsonResponse[0].id).toBe('submission1');
    expect(jsonResponse[0].winner).toBe('A');
    expect(jsonResponse[0].question).toBe('What is consciousness?');
    expect(jsonResponse[1].id).toBe('submission2');
    expect(jsonResponse[1].winner).toBe('B');
  });

  test('should generate CSV when format=csv is specified', async () => {
    // Fixed Firebase timestamp for consistent tests
    const mockTimestamp = {
      toDate: () => new Date('2023-04-15T10:30:00Z'),
      seconds: 1681556600,
      nanoseconds: 0,
    };

    // Mock data for submissions
    const mockSubmissions = [
      {
        id: 'submission1',
        data: () => ({
          timestamp: mockTimestamp,
          winner: 'A',
          modelAConfig: {
            model: 'Claude 3',
            temperature: 0.7,
          },
          modelBConfig: {
            model: 'GPT-4',
            temperature: 0.5,
          },
          question: 'What is consciousness?',
          reasons: {
            moreAccurate: true,
            betterWritten: true,
            moreHelpful: false,
            betterReasoning: true,
            betterSourceUse: false,
          },
          userComments: 'Model A was more thorough',
          collection: 'test-collection',
        }),
      },
    ];

    // Mock snapshot with our test data
    const mockSnapshot = {
      docs: mockSubmissions,
      empty: false,
    };

    // Configure Firestore mock
    mockFirestore.db.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue(mockSnapshot),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        format: 'csv',
      },
    });

    await handler(req, res);

    // Check response
    expect(res.statusCode).toBe(200);
    const headers = res._getHeaders();
    expect(headers['content-type']).toBe('text/csv');
    expect(headers['content-disposition']).toContain(
      'attachment; filename=model-comparison-votes-',
    );
    expect(headers['content-disposition']).toContain('.csv');

    // Check that the CSV content was set
    const csvContent = res._getData();
    expect(csvContent).toContain(
      'id,timestamp,winner,modelA,temperatureA,modelB,temperatureB,question',
    );
    expect(csvContent).toContain('submission1');
    expect(csvContent).toContain('2023-04-15T10:30:00.000Z');
    expect(csvContent).toContain('A');
    expect(csvContent).toContain('Claude 3');
    expect(csvContent).toContain('0.7');
    expect(csvContent).toContain('GPT-4');
    expect(csvContent).toContain('0.5');
    expect(csvContent).toContain('"What is consciousness?"');
  });

  test('should handle Firestore errors', async () => {
    // Mock Firestore to throw an error
    mockFirestore.db.collection.mockReturnValue({
      get: jest.fn().mockRejectedValue(new Error('Firestore connection error')),
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({
      error: 'Failed to export votes',
    });
  });
});
