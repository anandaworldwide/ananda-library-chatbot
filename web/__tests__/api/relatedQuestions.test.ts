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

  describe('Authentication', () => {
    it('should use cron secret for JWT auth for Vercel cron requests', async () => {
      // Mock rate limiter to allow the request
      (genericRateLimiter as jest.Mock).mockImplementation(() => {
        return Promise.resolve(true);
      });

      // Store original CRON_SECRET and set a mock value
      const originalCronSecret = process.env.CRON_SECRET;
      process.env.CRON_SECRET = 'MOCK_CRON_SECRET';

      // Re-mock withJwtAuth for this specific test to ensure it's NOT called
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mockWithJwtAuth = require('@/utils/server/jwtUtils')
        .withJwtAuth as jest.Mock;
      mockWithJwtAuth.mockImplementation((handler: any) => handler); // Pass through handler directly

      // Need to re-import the handler to get the latest mocks applied correctly
      // due to how modules are cached in Jest
      jest.resetModules(); // Reset modules to re-import with fresh mocks
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('openai/shims/node'); // Re-import shim after reset
      jest.mock('@/utils/server/jwtUtils', () => ({
        // Re-mock JWT
        withJwtAuth: jest.fn((handler: any) => handler), // Pass through handler directly
      }));
      // Re-mock the handler itself or its dependencies if needed after reset
      setupPageApiMocks({ allowRateLimited: true }); // Re-setup mocks

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const requiredHandlerModule = require('@/pages/api/relatedQuestions');
      const handlerWithMiddleware = requiredHandlerModule.default;

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          'user-agent': 'vercel-cron/1.0',
          Authorization: 'Bearer MOCK_CRON_SECRET', // Add the CRON_SECRET
        },
        query: {
          updateBatch: '10', // Provide necessary query param
        },
      });

      await handlerWithMiddleware(req, res);

      // Restore original CRON_SECRET
      if (originalCronSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = originalCronSecret;
      }

      // Verify JWT auth middleware was NOT called for cron requests
      expect(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('@/utils/server/jwtUtils').withJwtAuth,
      ).not.toHaveBeenCalled();

      // Check that the request was processed (not blocked by auth)
      // It might fail validation later, but should pass auth.
      // Expecting 200 because the mock setup allows it through rate limiting
      // and the handler logic should proceed. Adjust if handler logic dictates otherwise.
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData().message).toContain(
        'Related questions batch update successful',
      );
    });

    it('should enforce JWT auth for non-cron requests', async () => {
      // Mock rate limiter to allow the request
      (genericRateLimiter as jest.Mock).mockImplementation(() => {
        return Promise.resolve(true);
      });

      // Mock withJwtAuth to simulate rejecting the request
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mockWithJwtAuth = require('@/utils/server/jwtUtils')
        .withJwtAuth as jest.Mock;
      mockWithJwtAuth.mockImplementation(() =>
        // Return the rejecting function directly
        async (req: NextApiRequest, res: NextApiResponse) => {
          res.status(401).json({ message: 'Unauthorized' });
        },
      );

      // Need to re-import the handler to get the latest mocks applied correctly
      jest.resetModules(); // Reset modules
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('openai/shims/node'); // Re-import shim after reset

      // Mock the underlying utility function to prevent env var errors
      jest.mock('@/utils/server/relatedQuestionsUtils', () => ({
        updateRelatedQuestions: jest.fn().mockResolvedValue({ current: [] }),
        updateRelatedQuestionsBatch: jest.fn().mockResolvedValue(undefined),
      }));

      // Re-mock the handler itself or its dependencies if needed after reset
      setupPageApiMocks({ allowRateLimited: true }); // Re-setup mocks

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const requiredHandlerModuleAgain = require('@/pages/api/relatedQuestions');
      const handlerWithMiddleware = requiredHandlerModuleAgain.default;

      // Explicitly mock and assign withJwtAuth after requiring modules
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jwtUtils = require('@/utils/server/jwtUtils');
      const mockJwtReject = jest.fn(
        () => async (req: NextApiRequest, res: NextApiResponse) => {
          res.status(401).json({ message: 'Unauthorized' });
        },
      );
      jwtUtils.withJwtAuth = mockJwtReject; // Overwrite the function directly

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'POST', // Use POST which triggers JWT auth path
        headers: {
          'user-agent': 'test-agent/1.0', // Non-cron user agent
        },
        body: {
          docId: 'test-doc-id',
        },
      });

      await handlerWithMiddleware(req, res);

      // Verify JWT auth middleware WAS called
      expect(mockJwtReject).toHaveBeenCalled(); // Check our specific mock function
      // Check that the request was blocked by auth
      expect(res.statusCode).toBe(401);
      expect(res._getJSONData().message).toBe('Unauthorized');
    });
  });
});
