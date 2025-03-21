/**
 * Tests for the Token API Endpoint
 *
 * This file tests the functionality of the token issuance endpoint, including:
 * - Method validation (only POST allowed)
 * - Authentication methods (web frontend and WordPress)
 * - Token generation with JWT
 * - Error handling
 */

import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import handler from '../../pages/api/get-token';

// Mock the jsonwebtoken module
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}));

// Mock crypto
jest.mock('crypto', () => {
  // Create a mock digest object that allows method chaining
  const mockDigest = {
    substring: jest.fn().mockReturnValue('wordpress-token'),
  };

  // Create a mock update object
  const mockUpdate = {
    digest: jest.fn().mockReturnValue(mockDigest),
  };

  // Return the main createHash mock
  return {
    createHash: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue(mockUpdate),
    }),
  };
});

describe('Get Token API', () => {
  const originalEnv = process.env;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    // Silence console logs in tests
    console.log = jest.fn();
    console.error = jest.fn();

    // Setup environment variables
    process.env = { ...originalEnv };
    process.env.SECURE_TOKEN = 'test-secure-token';
    process.env.SECURE_TOKEN_HASH = 'test-secure-token-hash';

    // Reset mock return values if needed
    jest.mocked(crypto.createHash).mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res._getJSONData()).toEqual({ error: 'Method Not Allowed' });
  });

  it('should return 403 when no secret is provided', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: {},
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: 'No secret provided' });
  });

  it('should return 500 when environment variables are missing', async () => {
    delete process.env.SECURE_TOKEN;

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { secret: 'any-secret' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Server configuration error' });
  });

  it('should generate a token for web frontend with correct secret in header', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: {
        'x-shared-secret': 'test-secure-token',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({ token: 'mock-jwt-token' });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'web' }),
      'test-secure-token',
      expect.objectContaining({ expiresIn: '15m' }),
    );
  });

  it('should generate a token for web frontend with correct secret in body', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { secret: 'test-secure-token' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({ token: 'mock-jwt-token' });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'web' }),
      'test-secure-token',
      expect.objectContaining({ expiresIn: '15m' }),
    );
  });

  it('should generate a token for WordPress with derived token', async () => {
    // Test will now use the mocked crypto functions from the jest.mock setup

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { secret: 'wordpress-token' },
    });

    await handler(req, res);

    expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({ token: 'mock-jwt-token' });
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ client: 'wordpress' }),
      'test-secure-token',
      expect.objectContaining({ expiresIn: '15m' }),
    );
  });

  it('should return 403 for invalid secret', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { secret: 'invalid-secret' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: 'Invalid secret' });
  });

  it('should handle errors during token generation', async () => {
    (jwt.sign as jest.Mock).mockImplementationOnce(() => {
      throw new Error('JWT error');
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      body: { secret: 'test-secure-token' },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'Internal Server Error' });
    expect(console.error).toHaveBeenCalled();
  });
});
