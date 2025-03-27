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
import { loadSiteConfigSync } from '@/utils/server/loadSiteConfig';

// Mock the JWT auth middleware to bypass token validation in tests
jest.mock('@/utils/server/jwtUtils', () => {
  return {
    withJwtAuth: jest.fn().mockImplementation((handler) => {
      return handler; // Simply return the handler without token validation
    }),
  };
});

// Mock site config loading
jest.mock('@/utils/server/loadSiteConfig', () => ({
  loadSiteConfigSync: jest.fn().mockImplementation(() => ({
    requireLogin: false, // Default to no login required
  })),
}));

// Mock the CORS middleware to bypass the timeout issue
jest.mock('@/utils/server/corsMiddleware', () => ({
  runMiddleware: jest.fn().mockImplementation(() => {
    // Just resolve immediately without actually running the middleware
    return Promise.resolve();
  }),
}));

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
    // Default to not requiring login
    (loadSiteConfigSync as jest.Mock).mockImplementation(() => ({
      requireLogin: false,
    }));
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
  }, 10000);

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
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/treasures/test-audio.mp3?signed=true',
      filename: 'test-audio.mp3',
      path: 'treasures/test-audio.mp3',
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
      filename: 'bhaktan/special-audio.mp3',
      path: 'bhaktan/special-audio.mp3',
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
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/treasures/test-audio.mp3?signed=true',
      filename: 'test-audio.mp3',
      path: 'treasures/test-audio.mp3',
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
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/treasures/test-audio.mp3?signed=true',
      filename: 'test-audio.mp3',
      path: 'treasures/test-audio.mp3',
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

  it('should add treasures/ prefix to filenames without a path', async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      query: {
        filename: 'simple-audio-file.mp3',
      },
      headers: {
        host: 'example.com',
      },
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const responseData = res._getJSONData();
    expect(responseData).toEqual({
      url: 'https://example-bucket.s3.amazonaws.com/public/audio/treasures/simple-audio-file.mp3?signed=true',
      filename: 'simple-audio-file.mp3',
      path: 'treasures/simple-audio-file.mp3',
    });
  });
});
