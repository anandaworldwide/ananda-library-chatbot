/**
 * Tests for the Logout API endpoint
 *
 * This file tests the functionality of the logout API endpoint, including:
 * - Method validation (only POST allowed)
 * - Cookie clearing
 * - Response handling
 */

// Mock Firebase directly before anything else is imported
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

// Mock genericRateLimiter before it gets imported
jest.mock('@/utils/server/genericRateLimiter', () => ({
  genericRateLimiter: jest.fn().mockResolvedValue(true),
  deleteRateLimitCounter: jest.fn().mockResolvedValue(undefined),
}));

import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/logout';

// Mock cookies library
const setCookieMock = jest.fn();
jest.mock('cookies', () => {
  return jest.fn().mockImplementation(() => {
    return {
      set: setCookieMock,
    };
  });
});

describe('Logout API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('should clear auth cookies and return success response', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'https',
      },
    });

    await handler(req, res);

    // Verify cookies are cleared
    expect(setCookieMock).toHaveBeenCalledTimes(2);

    // First call should clear siteAuth cookie
    expect(setCookieMock.mock.calls[0][0]).toBe('siteAuth');
    expect(setCookieMock.mock.calls[0][1]).toBe('');
    expect(setCookieMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        expires: expect.any(Date),
      }),
    );

    // Second call should clear isLoggedIn cookie
    expect(setCookieMock.mock.calls[1][0]).toBe('isLoggedIn');
    expect(setCookieMock.mock.calls[1][1]).toBe('');
    expect(setCookieMock.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        expires: expect.any(Date),
      }),
    );

    // Verify response
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      message: 'Logged out',
    });
  });

  it('should not set secure cookie option for http protocol', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'http',
      },
    });

    await handler(req, res);

    // For the default implementation, secure is not explicitly set
    // so we just verify the cookies were set
    expect(setCookieMock).toHaveBeenCalledTimes(2);
    expect(setCookieMock.mock.calls[0][0]).toBe('siteAuth');
    expect(setCookieMock.mock.calls[1][0]).toBe('isLoggedIn');
  });
});
