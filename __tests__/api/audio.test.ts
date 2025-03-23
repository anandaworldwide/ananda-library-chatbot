/**
 * Tests for the Audio API endpoint
 *
 * This file tests the functionality of the audio API endpoint, including:
 * - Method validation (only GET allowed)
 * - Filename validation
 * - S3 presigned URL generation
 * - Error handling
 */

import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/audio/[filename]';
import { getSignedUrl as mockGetSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mock the JWT auth middleware to bypass token validation in tests
jest.mock('@/utils/server/jwtUtils', () => {
  return {
    withJwtAuth: jest.fn().mockImplementation((handler) => {
      return handler; // Simply return the handler without token validation
    }),
  };
});

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: jest.fn().mockImplementation((params) => ({
    ...params,
  })),
  S3Client: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockImplementation((client, command) => {
    // Extract the filename from the command
    const key = command.Key;
    return Promise.resolve(
      `https://example-bucket.s3.amazonaws.com/${key}?signed=true`,
    );
  }),
}));

jest.mock('@/utils/server/awsConfig', () => ({
  s3Client: {},
}));

describe('Audio API', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.S3_BUCKET_NAME = 'test-bucket';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should handle OPTIONS request for CORS', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'OPTIONS',
      query: {
        filename: 'test-audio.mp3',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._isEndCalled()).toBe(true);
  });

  it('should return 400 for invalid filename', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: ['multiple', 'filenames'], // Invalid - should be a string
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData()).toEqual({
      error: 'Invalid filename',
    });
  });

  it('should generate signed URL for simple filenames', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: 'test-audio.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/test-audio.mp3?signed=true',
    });
  });

  it('should handle filenames with path prefixes', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: 'bhaktan/special-audio.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/bhaktan/special-audio.mp3?signed=true',
    });
  });

  it('should handle filenames with leading slashes', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: '/test-audio.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/test-audio.mp3?signed=true',
    });
  });

  it('should handle filenames with api prefix', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: 'api/audio/test-audio.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual({
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/test-audio.mp3?signed=true',
    });
  });

  it('should handle S3 client errors', async () => {
    // Make the getSignedUrl function throw an error
    (mockGetSignedUrl as jest.Mock).mockRejectedValueOnce(
      new Error('S3 Error'),
    );

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: 'test-audio.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({
      error: 'Error accessing file',
      details: 'S3 Error',
    });
  });

  it('should handle unknown errors', async () => {
    // Make the getSignedUrl function throw a non-Error object
    (mockGetSignedUrl as jest.Mock).mockRejectedValueOnce(
      'Not an Error object',
    );

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: 'test-audio.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({
      error: 'Error accessing file',
      details: 'Unknown error',
    });
  });
});
