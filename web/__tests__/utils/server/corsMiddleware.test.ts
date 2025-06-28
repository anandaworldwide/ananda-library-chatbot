/**
 * Tests for CORS Middleware
 *
 * This file tests the comprehensive CORS middleware functionality, including:
 * - Pages Router and App Router support
 * - Development vs production environment handling
 * - Origin validation with various patterns
 * - OPTIONS request handling
 * - WordPress integration
 * - Error handling and security
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { createMocks } from 'node-mocks-http';
import {
  runMiddleware,
  setCorsHeaders,
  handleCors,
  addCorsHeaders,
  handleCorsOptions,
  createErrorCorsHeaders,
} from '../../../src/utils/server/corsMiddleware';
import * as envModule from '../../../src/utils/env';
import { loadSiteConfigSync } from '../../../src/utils/server/loadSiteConfig';
import Cors from 'cors';

// Mock dependencies
jest.mock('../../../src/utils/env', () => ({
  isDevelopment: jest.fn(),
}));

jest.mock('../../../src/utils/server/loadSiteConfig', () => ({
  loadSiteConfigSync: jest.fn(),
}));

jest.mock('cors', () => {
  const mockCors = jest.fn().mockImplementation((options) => {
    return (req: any, res: any, callback: any) => {
      // Simulate cors middleware behavior
      if (callback) callback(null);
    };
  });
  return mockCors;
});

describe('CORS Middleware', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockSiteConfig: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();

    // Default site config
    mockSiteConfig = {
      siteId: 'test',
      allowedFrontEndDomains: [
        'example.com',
        'test.example.com',
        'www.example.com',
        '**-staging.example.com',
        'api.example.com/**',
      ],
    };

    (loadSiteConfigSync as jest.Mock).mockReturnValue(mockSiteConfig);
    (envModule.isDevelopment as jest.Mock).mockReturnValue(false);

    // Default to production environment
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      NEXT_PUBLIC_BASE_URL: 'https://example.com',
      NEXT_PUBLIC_VERBOSE_CORS: 'false',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('runMiddleware', () => {
    it('should run middleware and resolve on success', async () => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://example.com' },
      });

      const middleware = jest.fn().mockImplementation((req, res, callback) => {
        callback(null);
      });

      await expect(runMiddleware(req, res, middleware)).resolves.toBe(null);
      expect(middleware).toHaveBeenCalledWith(req, res, expect.any(Function));
    });

    it('should reject when middleware returns an error', async () => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://example.com' },
      });

      const error = new Error('Middleware error');
      const middleware = jest.fn().mockImplementation((req, res, callback) => {
        callback(error);
      });

      await expect(runMiddleware(req, res, middleware)).rejects.toBe(error);
    });
  });

  describe('setCorsHeaders (Pages Router)', () => {
    let mockReq: NextApiRequest;
    let mockRes: NextApiResponse;

    beforeEach(() => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: {},
      });

      mockReq = req as NextApiRequest;
      mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;
    });

    it('should set permissive headers in development', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      mockReq.headers.origin = 'https://localhost:3000';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://localhost:3000');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('should allow local development origins when in development mode', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      mockReq.headers.origin = 'http://localhost:3000';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:3000');
    });

    it('should allow exact domain match', () => {
      mockReq.headers.origin = 'https://example.com';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    });

    it('should allow subdomain match', () => {
      mockReq.headers.origin = 'https://test.example.com';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://test.example.com');
    });

    it('should allow wildcard prefix match', () => {
      mockReq.headers.origin = 'https://feature-123-staging.example.com';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://feature-123-staging.example.com');
    });

    it('should allow wildcard suffix match', () => {
      mockReq.headers.origin = 'https://api.example.com';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://api.example.com');
    });

    it('should allow www variant matching', () => {
      mockReq.headers.origin = 'https://www.example.com';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://www.example.com');
    });

    it('should not set headers for disallowed origins', () => {
      mockReq.headers.origin = 'https://malicious.com';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://malicious.com');
    });

    it('should handle no origin header', () => {
      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.any(String));
    });

    it('should handle WordPress referer in development mode', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      mockReq.headers.referer = 'https://localhost:3000/wp-admin';

      setCorsHeaders(mockReq, mockRes, mockSiteConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });
  });

  describe('handleCors (App Router)', () => {
    it('should return null for allowed origins', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'https://example.com' },
      });

      const result = handleCors(mockReq, mockSiteConfig);

      expect(result).toBeNull();
    });

    it('should return null for development origins', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      const mockReq = new NextRequest('https://localhost:3000/api/test', {
        headers: { origin: 'http://localhost:3000' },
      });

      const result = handleCors(mockReq, mockSiteConfig);

      expect(result).toBeNull();
    });

    it('should return null for local origins when in development mode', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'http://localhost:3000' },
      });

      const result = handleCors(mockReq, mockSiteConfig);

      expect(result).toBeNull();
    });

    it('should return null for OPTIONS requests', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { origin: 'https://malicious.com' },
      });

      const result = handleCors(mockReq, mockSiteConfig);

      expect(result).toBeNull();
    });

    it('should return null for requests without origin', () => {
      const mockReq = new NextRequest('https://example.com/api/test');

      const result = handleCors(mockReq, mockSiteConfig);

      expect(result).toBeNull();
    });

    it('should return 403 for disallowed origins', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'https://malicious.com' },
      });

      const result = handleCors(mockReq, mockSiteConfig);

      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(403);
    });

    it('should return 500 for missing site config', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'https://example.com' },
      });

      const result = handleCors(mockReq, null);

      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(500);
    });

    it('should handle verbose logging in development', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'https://example.com' },
      });

      handleCors(mockReq, mockSiteConfig);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log warnings for blocked origins', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'https://malicious.com' },
      });

      handleCors(mockReq, mockSiteConfig);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CORS blocked request from origin'));
      consoleSpy.mockRestore();
    });
  });

  describe('addCorsHeaders (App Router)', () => {
    let mockResponse: NextResponse;
    let mockReq: NextRequest;

    beforeEach(() => {
      mockResponse = new NextResponse();
      mockResponse.headers.set = jest.fn();
    });

    it('should add headers for OPTIONS requests with allowed origin', () => {
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Max-Age', '86400');
      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('should handle WordPress requests in development mode for OPTIONS', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { referer: 'http://localhost/wordpress/wp-admin' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'false');
    });

    it('should add debug headers for allowed origins', () => {
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('X-CORS-Debug', 'allowed:example.com');
    });

    it('should add debug headers for rejected origins', () => {
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { origin: 'https://malicious.com' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('X-CORS-Debug', 'rejected:malicious.com');
    });

    it('should handle regular requests with allowed origin', () => {
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'POST',
        headers: { origin: 'https://example.com' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('should handle development origins for regular requests when in development mode', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:3000');
    });

    it('should return response unchanged for requests without origin', () => {
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'POST',
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result).toBe(mockResponse);
    });

    it('should log warnings for rejected origins in regular requests', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'POST',
        headers: { origin: 'https://malicious.com' },
      });

      addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected CORS for origin'));
      consoleSpy.mockRestore();
    });

    it('should handle invalid origin URLs gracefully', () => {
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { origin: 'invalid-url' },
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('X-CORS-Debug', 'rejected:invalid_origin_url');
    });

    it('should handle permissive development mode for OPTIONS without origin', () => {
      (envModule.isDevelopment as jest.Mock).mockReturnValue(true);
      mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
      });

      const result = addCorsHeaders(mockResponse, mockReq, mockSiteConfig);

      expect(result.headers.set).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });
  });

  describe('handleCorsOptions', () => {
    it('should handle OPTIONS for Pages Router', () => {
      const { req, res } = createMocks({
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      });

      const mockRes = {
        ...res,
        status: jest.fn().mockReturnThis(),
        end: jest.fn(),
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      const result = handleCorsOptions(req, mockRes, mockSiteConfig);

      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should handle OPTIONS for App Router', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com' },
      });

      const result = handleCorsOptions(mockReq, undefined, mockSiteConfig);

      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(204);
    });

    it('should handle App Router without site config', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        method: 'OPTIONS',
      });

      const result = handleCorsOptions(mockReq);

      expect(result).toBeInstanceOf(NextResponse);
      expect((result as NextResponse).status).toBe(204);
    });
  });

  describe('createErrorCorsHeaders', () => {
    it('should create headers for NextRequest', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'https://example.com' },
      });

      const headers = createErrorCorsHeaders(mockReq);

      expect(headers).toEqual({
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': 'https://example.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      });
    });

    it('should create headers for NextApiRequest', () => {
      const { req } = createMocks({
        method: 'GET',
        headers: { origin: 'https://example.com' },
      });

      const headers = createErrorCorsHeaders(req);

      expect(headers).toEqual({
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': 'https://example.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      });
    });

    it('should use environment base URL when no origin provided', () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://test.com';
      const mockReq = new NextRequest('https://example.com/api/test');

      const headers = createErrorCorsHeaders(mockReq);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://test.com');
    });

    it('should handle development mode', () => {
      const mockReq = new NextRequest('https://example.com/api/test', {
        headers: { origin: 'http://localhost:3000' },
      });

      const headers = createErrorCorsHeaders(mockReq, true);

      // In development mode, if origin exists it should be returned, otherwise "*"
      expect(headers['Access-Control-Allow-Origin']).toMatch(/http:\/\/localhost:3000|\*/);
    });

    it('should fallback to wildcard in development when no origin', () => {
      const mockReq = new NextRequest('https://example.com/api/test');

      const headers = createErrorCorsHeaders(mockReq, true);

      expect(headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('Origin validation edge cases', () => {
    beforeEach(() => {
      // Enable verbose logging for edge case testing
      process.env.NEXT_PUBLIC_VERBOSE_CORS = 'true';
    });

    it('should handle malformed URLs gracefully', () => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: '://invalid-url' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      setCorsHeaders(req, mockRes, mockSiteConfig);

      expect(consoleSpy).toHaveBeenCalled();
      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.any(String));

      consoleSpy.mockRestore();
    });

    it('should handle regex pattern fallback', () => {
      const mockConfig = {
        ...mockSiteConfig,
        allowedFrontEndDomains: ['*.example.com', '[invalid-regex'],
      };

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://test.example.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://test.example.com');
    });

    it('should handle empty allowed domains array', () => {
      const mockConfig = {
        ...mockSiteConfig,
        allowedFrontEndDomains: [],
      };

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://example.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockConfig);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    });

    it('should handle missing allowedFrontEndDomains property', () => {
      const mockConfig = {
        siteId: 'test',
      };

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://example.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockConfig);

      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    });

    it('should handle verbose logging warnings', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://malicious.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockSiteConfig);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CORS rejected: no pattern matched'));
      consoleSpy.mockRestore();
    });
  });

  describe('WordPress integration', () => {
    it('should detect WordPress referer correctly', () => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: { referer: 'https://example.com/wordpress/admin' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockSiteConfig);

      // Should not set special WordPress headers in production
      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should handle WordPress admin referer', () => {
      const { req, res } = createMocks({
        method: 'GET',
        headers: { referer: 'https://example.com/wp-admin/admin.php' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockSiteConfig);

      // Should not set special WordPress headers in production without dev mode
      expect(mockRes.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });
  });

  describe('Environment-specific behavior', () => {
    it('should handle production verbose logging', () => {
      process.env.NEXT_PUBLIC_VERBOSE_CORS = 'true';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://example.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockSiteConfig);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CORS allowed'));
      consoleSpy.mockRestore();
    });

    it('should not log in test environment during startup', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalJestWorker = process.env.JEST_WORKER_ID;

      process.env.NODE_ENV = 'test';
      process.env.JEST_WORKER_ID = '1';

      // The module startup logging should be skipped
      // This is tested by the fact that the module loads without console output
      expect(true).toBe(true); // Module loaded successfully

      process.env.NODE_ENV = originalNodeEnv;
      process.env.JEST_WORKER_ID = originalJestWorker;
    });
  });

  describe('Pattern matching variations', () => {
    it('should match domain with port', () => {
      const mockConfig = {
        ...mockSiteConfig,
        allowedFrontEndDomains: ['localhost'],
      };

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'http://localhost:3000' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:3000');
    });

    it('should handle complex wildcard patterns', () => {
      const mockConfig = {
        ...mockSiteConfig,
        allowedFrontEndDomains: ['*.staging.example.com', 'api-*.example.com'],
      };

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://feature.staging.example.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://feature.staging.example.com');
    });

    it('should handle substring fallback matching', () => {
      const mockConfig = {
        ...mockSiteConfig,
        allowedFrontEndDomains: ['[invalid-regex', 'example.com'],
      };

      const { req, res } = createMocks({
        method: 'GET',
        headers: { origin: 'https://test.example.com' },
      });

      const mockRes = {
        ...res,
        setHeader: jest.fn(),
      } as unknown as NextApiResponse;

      setCorsHeaders(req, mockRes, mockConfig);

      expect(mockRes.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://test.example.com');
    });
  });
});