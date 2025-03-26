/**
 * Web Token API Tests
 *
 * These tests verify that the web token endpoint correctly issues JWT tokens
 * for the web frontend client.  The endpoint should:
 *
 * 1. Only respond to GET requests
 * 2. Require the SECURE_TOKEN environment variable
 * 3. Generate valid JWT tokens with proper client identification
 * 4. Handle errors gracefully
 * 5. Validate authentication cookies when login is required
 * 6. Skip authentication validation when login is not required
 */

import { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/web-token';
import jwt from 'jsonwebtoken';
import { Socket } from 'net';
import { loadSiteConfigSync } from '../../utils/server/loadSiteConfig';
import * as passwordUtils from '../../utils/server/passwordUtils';
import CryptoJS from 'crypto-js';

// Mock modules
jest.mock('../../utils/server/loadSiteConfig');
jest.mock('../../utils/server/passwordUtils');
jest.mock('crypto-js');

describe('/api/web-token', () => {
  // Mock request and response objects
  let req: Partial<NextApiRequest>;
  let res: Partial<NextApiResponse>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // Reset mocks before each test
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    // Set up request and response objects
    req = {
      method: 'GET',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' } as unknown as Socket,
      url: '/api/web-token',
      cookies: {},
    };

    res = {
      status: statusMock,
      json: jsonMock,
    };

    // Set up environment variables
    process.env.SECURE_TOKEN = 'test-secure-token';
    process.env.SECURE_TOKEN_HASH = 'hashed-secure-token';

    // Set up loadSiteConfigSync mock to return non-login required by default
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
    });

    // Set up isTokenValid mock to return true by default
    (passwordUtils.isTokenValid as jest.Mock).mockReturnValue(true);

    // Set up CryptoJS.SHA256 mock
    (CryptoJS.SHA256 as jest.Mock).mockReturnValue({
      toString: () => 'hashed-secure-token',
    });

    jest.clearAllMocks();
  });

  it('should return 405 for non-GET requests', async () => {
    req.method = 'POST';
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(statusMock).toHaveBeenCalledWith(405);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Method Not Allowed' });
  });

  it('should require SECURE_TOKEN environment variable', async () => {
    delete process.env.SECURE_TOKEN;
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Server configuration error',
    });
  });

  it('should create and return a valid JWT token', async () => {
    const verifyMock = jest.spyOn(jwt, 'sign');
    verifyMock.mockImplementation(() => 'test-jwt-token');

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ token: 'test-jwt-token' });
    expect(verifyMock).toHaveBeenCalledWith(
      {
        client: 'web',
        iat: expect.any(Number),
      },
      'test-secure-token',
      { expiresIn: '15m' },
    );

    verifyMock.mockRestore();
  });

  it('should handle JWT signing errors', async () => {
    const verifyMock = jest.spyOn(jwt, 'sign');
    verifyMock.mockImplementation(() => {
      throw new Error('JWT signing failed');
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Failed to create token' });

    verifyMock.mockRestore();
  });

  // New tests for authentication validation

  it('should not validate authentication when login is not required', async () => {
    // Set site config to not require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: false,
    });

    // Make request with no cookies
    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should succeed without checking authentication
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(passwordUtils.isTokenValid).not.toHaveBeenCalled();
    expect(CryptoJS.SHA256).not.toHaveBeenCalled();
  });

  it('should require siteAuth cookie when login is required', async () => {
    // Set site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Make request with no cookies
    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should fail with authentication required
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('should validate siteAuth cookie format when login is required', async () => {
    // Set site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Set invalid cookie format (no colon)
    req.cookies = { siteAuth: 'invalid-cookie-format' };

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should fail with invalid format
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Invalid authentication format',
    });
  });

  it('should validate siteAuth cookie hash when login is required', async () => {
    // Set site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Set valid cookie format but hash won't match
    req.cookies = { siteAuth: 'token-value:12345678' };

    // Make hash validation fail
    (CryptoJS.SHA256 as jest.Mock).mockReturnValue({
      toString: () => 'wrong-hash',
    });

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should fail with invalid authentication
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid authentication' });
    expect(CryptoJS.SHA256).toHaveBeenCalledWith('token-value');
  });

  it('should validate siteAuth cookie timestamp when login is required', async () => {
    // Set site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Set valid cookie format with matching hash
    req.cookies = { siteAuth: 'token-value:12345678' };

    // Make hash validation pass but timestamp validation fail
    (CryptoJS.SHA256 as jest.Mock).mockReturnValue({
      toString: () => 'hashed-secure-token',
    });
    (passwordUtils.isTokenValid as jest.Mock).mockReturnValue(false);

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should fail with expired authentication
    expect(statusMock).toHaveBeenCalledWith(401);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Expired authentication' });
    expect(passwordUtils.isTokenValid).toHaveBeenCalledWith(
      'token-value:12345678',
    );
  });

  it('should allow request with valid authentication when login is required', async () => {
    // Set site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Set valid cookie format with matching hash
    req.cookies = { siteAuth: 'token-value:12345678' };

    // Make both hash and timestamp validation pass
    (CryptoJS.SHA256 as jest.Mock).mockReturnValue({
      toString: () => 'hashed-secure-token',
    });
    (passwordUtils.isTokenValid as jest.Mock).mockReturnValue(true);

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should succeed with 200 status
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(CryptoJS.SHA256).toHaveBeenCalledWith('token-value');
    expect(passwordUtils.isTokenValid).toHaveBeenCalledWith(
      'token-value:12345678',
    );
  });

  it('should fail if SECURE_TOKEN_HASH is missing when login is required', async () => {
    // Set site config to require login
    (loadSiteConfigSync as jest.Mock).mockReturnValue({
      requireLogin: true,
    });

    // Set valid cookie
    req.cookies = { siteAuth: 'token-value:12345678' };

    // Delete SECURE_TOKEN_HASH
    delete process.env.SECURE_TOKEN_HASH;

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should fail with server configuration error
    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: 'Server configuration error',
    });
  });
});
