/**
 * Tests for the Proxy Token API Endpoint
 *
 * This file tests the functionality of the proxy token endpoint, including:
 * - Method validation (only GET allowed)
 * - Server-to-server token fetching
 * - Environment variable validation
 * - Error handling
 * - URL construction for different environments
 */

import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/proxy-token';

// Mock fetch function globally
global.fetch = jest.fn();

describe('Proxy Token API', () => {
  const originalEnv = process.env;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    // Silence console logs in tests
    console.log = jest.fn();
    console.error = jest.fn();

    // Reset environment variables
    process.env = { ...originalEnv };
    process.env.SECURE_TOKEN = 'test-secure-token';

    // Mock successful fetch by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: jest.fn().mockImplementation((header) => {
          if (header === 'content-type') return 'application/json';
          return null;
        }),
        entries: () => [],
      },
      json: jest.fn().mockResolvedValue({ token: 'mock-jwt-token' }),
      text: jest.fn().mockResolvedValue('{}'),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res._getJSONData()).toEqual({ error: 'Method Not Allowed' });
  });

  it('should return 500 when SECURE_TOKEN is missing', async () => {
    delete process.env.SECURE_TOKEN;

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Server configuration error' });
    expect(console.error).toHaveBeenCalled();
  });

  describe('URL construction', () => {
    it('should use host header as the first strategy for Vercel deployments', async () => {
      process.env.VERCEL_URL = 'test-vercel-url.vercel.app';

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      // The implementation now uses Strategy 4 first, which is based on the host header
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-host.com/api/get-token',
        expect.anything(),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'mock-jwt-token' });
    });

    it('should use VERCEL_URL (Strategy 1) if previous strategies fail', async () => {
      process.env.VERCEL_URL = 'test-vercel-url.vercel.app';

      // Make Strategy 4 and Strategy 2 fail, but let Strategy 1 (VERCEL_URL) succeed
      // Strategy 4 (host header)
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Host strategy failed'))
        // Strategy 2 (direct path)
        .mockRejectedValueOnce(new Error('Direct path strategy failed'))
        // Strategy 3 (absolute URL)
        .mockRejectedValueOnce(new Error('Absolute URL strategy failed'))
        // Strategy 1 (VERCEL_URL)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn().mockImplementation((header) => {
              if (header === 'content-type') return 'application/json';
              return null;
            }),
            entries: () => [],
          },
          json: jest.fn().mockResolvedValue({ token: 'vercel-url-token' }),
        });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      // The fourth call should use VERCEL_URL
      expect(global.fetch).toHaveBeenCalledTimes(4);
      expect(global.fetch).toHaveBeenNthCalledWith(
        4,
        'https://test-vercel-url.vercel.app/api/get-token',
        expect.anything(),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'vercel-url-token' });
    });

    // This test was replaced with more specific strategy tests below
    it.skip('should use VERCEL_URL for Vercel deployments if host strategy fails', async () => {
      // Test deprecated and replaced
    });

    it('should use host header in production when VERCEL_URL is not available', async () => {
      // Save the entire process.env object and create a new one for this test
      const savedEnv = process.env;
      process.env = {
        ...savedEnv,
        NODE_ENV: 'production',
        VERCEL_URL: undefined,
      };

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-production-host.com',
        },
      });

      await handler(req, res);

      // Restore the original process.env
      process.env = savedEnv;

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://test-production-host.com'),
        expect.anything(),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'mock-jwt-token' });
    });

    it('should use http for local development when VERCEL_URL is not available', async () => {
      // Save the entire process.env object and create a new one for this test
      const savedEnv = process.env;
      process.env = {
        ...savedEnv,
        NODE_ENV: 'development',
        VERCEL_URL: undefined,
      };

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'localhost:3000',
        },
      });

      await handler(req, res);

      // Restore the original process.env
      process.env = savedEnv;

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:3000'),
        expect.anything(),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'mock-jwt-token' });
    });
  });

  describe('Fetch handling', () => {
    it('should send SECURE_TOKEN in both header and body', async () => {
      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Shared-Secret': 'test-secure-token',
          }),
          body: expect.stringContaining('test-secure-token'),
        }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('should handle non-JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: {
          get: jest.fn().mockReturnValue('text/html; charset=utf-8'),
          entries: () => [],
        },
        text: jest
          .fn()
          .mockResolvedValue('<!doctype html><html>Unauthorized</html>'),
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle fetch errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle API error responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: {
          get: jest.fn().mockReturnValue('application/json'),
          entries: () => [],
        },
        json: jest.fn().mockResolvedValue({ error: 'Invalid token' }),
      });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({ error: 'Internal server error' });
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Alternative strategies', () => {
    it('should try direct path strategy for preview deployments', async () => {
      process.env.VERCEL_URL = 'preview-deployment-123-project.vercel.app';

      // Make first fetch fail but second succeed
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn().mockReturnValue('application/json'),
            entries: () => [],
          },
          json: jest.fn().mockResolvedValue({ token: 'direct-strategy-token' }),
        });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      // The second attempt should contain the direct path
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        '/api/get-token',
        expect.anything(),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'direct-strategy-token' });
    });

    it('should use direct path strategy (Strategy 2) for preview deployments if host strategy fails', async () => {
      process.env.VERCEL_URL = 'preview-deployment-123-project.vercel.app';

      // Make the first Strategy 4 (host header) fail, then let Strategy 2 (direct path) succeed
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Host strategy failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn().mockImplementation((header) => {
              if (header === 'content-type') return 'application/json';
              return null;
            }),
            entries: () => [],
          },
          json: jest.fn().mockResolvedValue({ token: 'direct-path-token' }),
        });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      // The second call should use direct path "/api/get-token"
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        '/api/get-token',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Shared-Secret': 'test-secure-token',
          }),
        }),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'direct-path-token' });
    });

    it('should try absolute URL strategy if direct path fails', async () => {
      process.env.VERCEL_URL = 'preview-deployment-123-project.vercel.app';

      // Make first two fetches fail but third succeed
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockRejectedValueOnce(new Error('Second attempt failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: jest.fn().mockReturnValue('application/json'),
            entries: () => [],
          },
          json: jest.fn().mockResolvedValue({ token: 'absolute-url-token' }),
        });

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: 'GET',
        headers: {
          host: 'test-host.com',
        },
      });

      await handler(req, res);

      // The third attempt should use the absolute URL strategy
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(global.fetch).toHaveBeenNthCalledWith(
        3,
        'https://test-host.com/api/get-token',
        expect.anything(),
      );
      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ token: 'absolute-url-token' });
    });
  });
});
