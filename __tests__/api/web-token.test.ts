/**
 * Web Token API Tests
 *
 * These tests verify that the web token endpoint correctly issues JWT tokens
 * for the web frontend client. The endpoint should:
 *
 * 1. Only respond to GET requests
 * 2. Require the SECURE_TOKEN environment variable
 * 3. Generate valid JWT tokens with proper client identification
 * 4. Handle errors gracefully
 */

import { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/web-token';
import jwt from 'jsonwebtoken';
import { Socket } from 'net';

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
    };

    res = {
      status: statusMock,
      json: jsonMock,
    };

    // Set up environment variables
    process.env.SECURE_TOKEN = 'test-secure-token';
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
});
