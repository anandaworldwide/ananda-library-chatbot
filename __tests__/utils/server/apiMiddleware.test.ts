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
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { loadSiteConfigSync } from '@/utils/server/loadSiteConfig';

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
  let mockReq: Partial<NextApiRequest>;
  let mockRes: Partial<NextApiResponse>;
  let mockHandler: jest.Mock;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset mocks
    jest.clearAllMocks();

    // Create mock request and response
    mockReq = {
      method: 'GET',
      url: '/api/test',
      socket: {
        remoteAddress: '127.0.0.1',
      } as Partial<Socket> as Socket,
      headers: {},
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Create a mock handler
    mockHandler = jest.fn().mockImplementation(async () => {});

    // Default to no login required
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
    });
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('should pass request through without authentication when not required', async () => {
    // Setup site config to not require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
    });

    // Create wrapped handler
    const wrappedHandler = withApiMiddleware(mockHandler);

    // Call the handler
    await wrappedHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    // Verify that withJwtAuth was not called
    expect(withJwtAuth).not.toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
  });

  it('should apply authentication when site requires login', async () => {
    // Setup site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Create wrapped handler
    const wrappedHandler = withApiMiddleware(mockHandler);

    // Call the handler
    await wrappedHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    // Verify that withJwtAuth was called
    expect(withJwtAuth).toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should force authentication regardless of site config when forceAuth is true', async () => {
    // Setup site config to not require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
    });

    // Create wrapped handler with forceAuth
    const wrappedHandler = withApiMiddleware(mockHandler, { forceAuth: true });

    // Call the handler
    await wrappedHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    // Verify that withJwtAuth was called
    expect(withJwtAuth).toHaveBeenCalled();

    // Verify that the handler was called
    expect(mockHandler).toHaveBeenCalled();
  });

  it('should skip authentication when skipAuth is true, even if site requires login', async () => {
    // Setup site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Create wrapped handler with skipAuth
    const wrappedHandler = withApiMiddleware(mockHandler, { skipAuth: true });

    // Call the handler
    await wrappedHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

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
    await wrappedHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

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
    await wrappedHandler(mockReq as NextApiRequest, mockRes as NextApiResponse);

    // Verify that response was 403
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Forbidden: Invalid referer',
    });

    // Verify that the handler was not called
    expect(mockHandler).not.toHaveBeenCalled();
  });
});
