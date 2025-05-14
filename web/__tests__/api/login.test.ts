/**
 * Tests for the Login API endpoint
 *
 * This file tests the functionality of the login API endpoint, including:
 * - Method validation (only POST allowed)
 * - Input validation (password format, redirect URL)
 * - Rate limiting
 * - Authentication logic
 * - Cookie setting
 * - Redirect handling
 */

import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import handler from '@/pages/api/login';

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

// Mock crypto
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mocked-hashed-token'),
  }),
}));

// Mock cookies library
const setCookieMock = jest.fn();
jest.mock('cookies', () => {
  return jest.fn().mockImplementation(() => {
    return {
      set: setCookieMock,
    };
  });
});

// Mock rate limiter
jest.mock('@/utils/server/genericRateLimiter', () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
  deleteRateLimitCounter: jest.fn().mockResolvedValue(undefined),
}));

// Mock environment check
jest.mock('@/utils/env', () => ({
  isDevelopment: jest.fn().mockReturnValue(false),
}));

// Mock CORS middleware
jest.mock('@/utils/server/corsMiddleware', () => ({
  __esModule: true,
  default: jest.fn(),
  runMiddleware: jest.fn().mockResolvedValue(undefined),
  setCorsHeaders: jest.fn(),
  createErrorCorsHeaders: jest.fn().mockReturnValue({}),
}));

describe('Login API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.SITE_PASSWORD = 'hashed-password';
    process.env.SECURE_TOKEN = 'secure-token';
    process.env.SECURE_TOKEN_HASH = 'mocked-hashed-token';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res._getJSONData()).toEqual({
      message: 'Method not allowed',
    });
  });

  it('should handle OPTIONS request for CORS', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'OPTIONS',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res._isEndCalled()).toBe(true);
  });

  it('should validate password presence', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: '',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      message: 'Invalid password',
    });
  });

  it('should validate password length', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: '12345', // too short
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      message: 'Invalid password length',
    });
  });

  it('should validate redirect URL', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: 'validpassword123',
        redirect: 'javascript:alert("xss")', // invalid URL
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      message: 'Invalid redirect URL',
    });
  });

  it('should authenticate user with valid credentials and set cookies', async () => {
    // Mock successful password match
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: 'validpassword123',
        redirect: '/dashboard',
      },
      headers: {
        'x-forwarded-proto': 'https',
      },
    });

    await handler(req, res);

    expect(bcrypt.compare).toHaveBeenCalledWith(
      'validpassword123',
      'hashed-password',
    );
    expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    expect(setCookieMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: 'Authenticated',
      redirect: '/dashboard',
    });
  });

  it('should reject login with invalid password', async () => {
    // Mock failed password match
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: 'wrongpassword',
      },
    });

    await handler(req, res);

    expect(bcrypt.compare).toHaveBeenCalledWith(
      'wrongpassword',
      'hashed-password',
    );
    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({
      message: 'Incorrect password',
    });
  });

  it('should handle missing environment variables', async () => {
    delete process.env.SITE_PASSWORD;

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: 'validpassword123',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      message: 'Bad request',
    });
  });

  it('should handle token hash mismatch', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    process.env.SECURE_TOKEN_HASH = 'different-token-hash';

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: 'validpassword123',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({
      message: 'Server error',
    });
  });

  it('should use default redirect if not provided', async () => {
    // Mock successful password match
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {
        password: 'validpassword123',
      },
      headers: {
        'x-forwarded-proto': 'https',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: 'Authenticated',
      redirect: '/',
    });
  });
});
