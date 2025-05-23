/**
 * Tests for API Middleware
 *
 * This file tests the functionality of the enhanced API middleware, including:
 * - Security checks for POST requests
 * - Conditional authentication based on site configuration
 * - Options for forcing or skipping authentication
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { Socket } from 'net';
import {
  withApiMiddleware,
  withJwtOnlyAuth,
} from '@/utils/server/apiMiddleware';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { loadSiteConfigSync } from '@/utils/server/loadSiteConfig';
import { createMocks } from 'node-mocks-http';

// Mock dependencies
jest.mock('@/utils/server/jwtUtils', () => ({
  withJwtAuth: jest.fn().mockImplementation((handler) => {
    return async (req: any, res: any) => {
      // Add a flag to indicate JWT auth was applied
      req._jwtAuthApplied = true;
      return handler(req, res);
    };
  }),
}));

jest.mock('@/utils/server/loadSiteConfig', () => ({
  loadSiteConfigSync: jest.fn(),
}));

describe('API Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockHandler: jest.Mock;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset mocks
    jest.clearAllMocks();

    const { req, res } = createMocks({
      method: 'POST',
      url: '/api/test',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      query: {},
      env: {},
    });

    // Add required Next.js API methods
    mockReq = {
      ...req,
      env: {},
    };
    mockRes = {
      ...res,
      setDraftMode: jest.fn(),
      setPreviewData: jest.fn(),
      clearPreviewData: jest.fn(),
      revalidate: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    // Create a mock handler
    mockHandler = jest.fn().mockImplementation(async () => {});

    // Default to no login required
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
      allowedFrontEndDomains: ['example.com'],
    });

    // Mock process.env with default values
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASE_URL: 'https://example.com',
      VERCEL_ENV: 'production',
    };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('should pass request through without authentication when not required', async () => {
    // Setup site config to not require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
      allowedFrontEndDomains: ['example.com'],
    });

    // Create wrapped handler
    const wrappedHandler = withApiMiddleware(mockHandler);

    // Call the handler
    await wrappedHandler(mockReq, mockRes);

    // Verify that withJwtAuth was not called
    expect(withJwtAuth).not.toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
  });

  it('should apply authentication when site requires login', async () => {
    // Setup site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
      allowedFrontEndDomains: ['example.com'],
    });

    // Create wrapped handler
    const wrappedHandler = withApiMiddleware(mockHandler);

    // Call the handler
    await wrappedHandler(mockReq, mockRes);

    // Verify that withJwtAuth was called
    expect(withJwtAuth).toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should force authentication regardless of site config when forceAuth is true', async () => {
    // Setup site config to not require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
      allowedFrontEndDomains: ['example.com'],
    });

    // Create wrapped handler with forceAuth
    const wrappedHandler = withApiMiddleware(mockHandler, { forceAuth: true });

    // Call the handler
    await wrappedHandler(mockReq, mockRes);

    // Verify that withJwtAuth was called
    expect(withJwtAuth).toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should skip authentication when skipAuth is true, even if site requires login', async () => {
    // Setup site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
      allowedFrontEndDomains: ['example.com'],
    });

    // Create wrapped handler with skipAuth
    const wrappedHandler = withApiMiddleware(mockHandler, { skipAuth: true });

    // Call the handler
    await wrappedHandler(mockReq, mockRes);

    // Verify that withJwtAuth was not called
    expect(withJwtAuth).not.toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
  });

  it('should check POST request referer', async () => {
    // Setup request as POST
    mockReq.method = 'POST';
    mockReq.headers = {
      referer: 'https://example.com/page',
    };

    // Set environment variables
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASE_URL: 'https://example.com',
    };

    // Create wrapped handler
    const wrappedHandler = withApiMiddleware(mockHandler);

    // Call the handler
    await wrappedHandler(mockReq, mockRes);

    // Verify that the handler was called (referer is valid)
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should reject POST requests with invalid referer', async () => {
    // Setup request as POST with invalid referer
    mockReq.method = 'POST';
    mockReq.headers = {
      referer: 'https://attacker.com/page',
    };

    // Set environment variables
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASE_URL: 'https://example.com',
      VERCEL_ENV: 'production',
    };

    // Create wrapped handler
    const wrappedHandler = withApiMiddleware(mockHandler);

    // Call the handler
    await wrappedHandler(mockReq, mockRes);

    // Verify that response was 403
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Forbidden: Invalid referer',
    });

    // Verify that the handler was not called
    expect(mockHandler).not.toHaveBeenCalled();
  });
});

describe('API Middleware Utilities', () => {
  /**
   * Tests the security and authentication utilities of the API middleware.
   * Note: The test "should reject POST requests with invalid referer in production"
   * was updated to directly mock process.env instead of using jest.spyOn due to
   * compatibility issues with Node.js process.env (not a getter property) and
   * Vercel preview environment overrides. This ensures consistent production
   * behavior for security checks.
   */
  const mockHandler = jest.fn();
  let mockReq: any;
  let mockRes: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    jest.clearAllMocks();
    mockHandler.mockReset();

    const { req, res } = createMocks({
      method: 'GET',
      url: '/api/test',
      headers: {},
      socket: {
        remoteAddress: '127.0.0.1',
      } as Partial<Socket> as Socket,
    });

    // Add required Next.js API methods
    mockReq = {
      ...req,
      env: {},
    };
    mockRes = {
      ...res,
      setDraftMode: jest.fn(),
      setPreviewData: jest.fn(),
      clearPreviewData: jest.fn(),
      revalidate: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    // Set environment variables using object assignment to avoid direct property mutation
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASE_URL: 'https://example.com',
    };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('withApiMiddleware', () => {
    it('should apply withJwtAuth when site config requires login', async () => {
      (loadSiteConfigSync as jest.Mock).mockReturnValue({
        requireLogin: true,
        allowedFrontEndDomains: ['example.com'],
      });

      const wrappedHandler = withApiMiddleware(mockHandler);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(withJwtAuth).toHaveBeenCalledWith(expect.any(Function));
      expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should not apply withJwtAuth when site config does not require login', async () => {
      (loadSiteConfigSync as jest.Mock).mockReturnValue({
        requireLogin: false,
        allowedFrontEndDomains: ['example.com'],
      });

      const wrappedHandler = withApiMiddleware(mockHandler);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(withJwtAuth).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should not apply withJwtAuth when skipAuth option is true', async () => {
      (loadSiteConfigSync as jest.Mock).mockReturnValue({
        requireLogin: true,
        allowedFrontEndDomains: ['example.com'],
      });

      const wrappedHandler = withApiMiddleware(mockHandler, { skipAuth: true });
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(withJwtAuth).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should apply withJwtAuth when forceAuth option is true', async () => {
      (loadSiteConfigSync as jest.Mock).mockReturnValue({
        requireLogin: false,
        allowedFrontEndDomains: ['example.com'],
      });

      const wrappedHandler = withApiMiddleware(mockHandler, {
        forceAuth: true,
      });
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(withJwtAuth).toHaveBeenCalledWith(expect.any(Function));
      expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
    });
  });

  describe('withJwtOnlyAuth', () => {
    it('should apply security checks and JWT auth', async () => {
      const wrappedHandler = withJwtOnlyAuth(mockHandler);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(withJwtAuth).toHaveBeenCalledWith(expect.any(Function));
      expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should apply JWT auth without checking siteAuth cookie', async () => {
      // Implementation is in withJwtAuth, but we can test that it's called
      const wrappedHandler = withJwtOnlyAuth(mockHandler);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(withJwtAuth).toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('Security checks', () => {
    it('should validate referer for POST requests in production', async () => {
      mockReq.method = 'POST';
      mockReq.headers = {
        referer: 'https://example.com/test',
      };

      const wrappedHandler = withApiMiddleware(mockHandler);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(mockHandler).toHaveBeenCalled();
    });

    it('should reject POST requests with invalid referer in production', async () => {
      mockReq.method = 'POST';
      mockReq.headers = {
        referer: 'https://malicious-site.com/test',
      };

      // Ensure production environment
      process.env = {
        ...originalEnv,
        NODE_ENV: 'production',
        NEXT_PUBLIC_BASE_URL: 'https://example.com',
        VERCEL_ENV: 'production',
      };

      const wrappedHandler = withApiMiddleware(mockHandler);
      console.log('VERCEL_ENV value:', process.env.VERCEL_ENV);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Forbidden: Invalid referer',
      });
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should allow POST requests without referer validation in development', async () => {
      // Set environment variables using object assignment
      process.env = {
        ...originalEnv,
        NODE_ENV: 'development',
      };

      mockReq.method = 'POST';
      mockReq.headers = {
        referer: 'https://malicious-site.com/test',
      };

      const wrappedHandler = withApiMiddleware(mockHandler);
      await wrappedHandler(
        mockReq as NextApiRequest,
        mockRes as NextApiResponse,
      );

      expect(mockHandler).toHaveBeenCalled();
    });
  });
});
