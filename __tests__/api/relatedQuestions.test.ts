// Import OpenAI Node shim for Node.js environment
import 'openai/shims/node';

// Mock Firebase before any imports
jest.mock('@/services/firebase', () => {
  const mockCollection = jest.fn().mockReturnThis();
  const mockDoc = jest.fn().mockReturnThis();
  const mockGet = jest
    .fn()
    .mockResolvedValue({ exists: false, data: () => null });

  return {
    db: {
      collection: mockCollection,
      doc: mockDoc,
      get: mockGet,
    },
  };
});

import { NextApiRequest, NextApiResponse } from 'next';
import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/relatedQuestions';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';
import { setupPageApiMocks } from '../utils/mocks/apiTestMocks';

// Mock the JWT authentication middleware
jest.mock('@/utils/server/jwtUtils', () => ({
  withJwtAuth: jest.fn((handler) => handler),
}));

// Mock the genericRateLimiter
jest.mock('@/utils/server/genericRateLimiter', () => ({
  genericRateLimiter: jest.fn().mockImplementation((req, res, options) => {
    if (options.name === 'related-questions-api' && !res.headersSent) {
      res.status(429).json({ message: 'Too many requests' });
    }
    return Promise.resolve(false);
  }),
}));

describe('Related Questions API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup all necessary mocks including site config, Firebase, etc.
    setupPageApiMocks({
      allowRateLimited: false, // We'll control rate limiting in individual tests
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limiting for GET requests', async () => {
      // Mock rate limiter to deny the request
      (genericRateLimiter as jest.Mock).mockImplementation(
        (req, res, options) => {
          if (options.name === 'related-questions-api' && !res.headersSent) {
            res.status(429).json({ message: 'Too many requests' });
          }
          return Promise.resolve(false);
        },
      );

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: {
          updateBatch: '10',
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(genericRateLimiter).toHaveBeenCalledWith(req, res, {
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 50, // 50 requests per 5 minutes
        name: 'related-questions-api',
      });
    });

    it('should enforce rate limiting for POST requests', async () => {
      // Mock rate limiter to deny the request
      (genericRateLimiter as jest.Mock).mockImplementation(
        (req, res, options) => {
          if (options.name === 'related-questions-api' && !res.headersSent) {
            res.status(429).json({ message: 'Too many requests' });
          }
          return Promise.resolve(false);
        },
      );

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST',
        body: {
          docId: 'test-doc-id',
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(429);
      expect(genericRateLimiter).toHaveBeenCalledWith(req, res, {
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 50, // 50 requests per 5 minutes
        name: 'related-questions-api',
      });
    });

    it('should allow requests within rate limit', async () => {
      // Mock rate limiter to allow the request
      (genericRateLimiter as jest.Mock).mockImplementation(() => {
        return Promise.resolve(true);
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        query: {
          updateBatch: '10',
        },
      });

      await handler(req, res);

      expect(res.statusCode).not.toBe(429);
      expect(genericRateLimiter).toHaveBeenCalledWith(req, res, {
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 50, // 50 requests per 5 minutes
        name: 'related-questions-api',
      });
    });
  });
});
