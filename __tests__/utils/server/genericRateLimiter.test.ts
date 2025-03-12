import {
  genericRateLimiter,
  deleteRateLimitCounter,
} from '../../../utils/server/genericRateLimiter';
import { NextApiRequest, NextApiResponse } from 'next';
import * as ipUtils from '../../../utils/server/ipUtils';
import * as envModule from '../../../utils/env';

// Mock the firebase service
jest.mock('@/services/firebase', () => {
  const mockCollection = jest.fn();
  const mockDoc = jest.fn();
  const mockGet = jest.fn();
  const mockSet = jest.fn();
  const mockUpdate = jest.fn();
  const mockDelete = jest.fn();

  const mockDocRef = {
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
    delete: mockDelete,
  };

  mockDoc.mockReturnValue(mockDocRef);
  mockCollection.mockReturnValue({ doc: mockDoc });

  return {
    db: {
      collection: mockCollection,
    },
    mockCollection,
    mockDoc,
    mockGet,
    mockSet,
    mockUpdate,
    mockDelete,
  };
});

// Mock the ipUtils module
jest.mock('../../../utils/server/ipUtils', () => ({
  getClientIp: jest.fn(),
}));

// Mock the env module
jest.mock('../../../utils/env', () => ({
  isDevelopment: jest.fn(),
}));

// Skip importing NextRequest/NextResponse to avoid issues
jest.mock('next/server', () => ({}));

describe('genericRateLimiter', () => {
  const mockReq = {} as NextApiRequest;
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as NextApiResponse;

  const firebase = jest.requireMock('@/services/firebase');
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Default mocks
    jest.spyOn(ipUtils, 'getClientIp').mockReturnValue('127.0.0.1');
    jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

    // Default Firebase mocks
    firebase.mockGet.mockResolvedValue({ exists: false });
    firebase.mockSet.mockResolvedValue(undefined);
    firebase.mockUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('should skip rate limiting if db is not available', async () => {
    // Temporarily remove db
    const originalDb = firebase.db;
    firebase.db = null;

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: 'test',
    });

    expect(result).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Firestore database not initialized, skipping rate limiting',
    );

    // Restore db
    firebase.db = originalDb;
  });

  it('should create a new rate limit entry if none exists', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({ exists: false });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: 'test',
      collectionPrefix: 'test',
    });

    expect(result).toBe(true);
    expect(firebase.mockCollection).toHaveBeenCalledWith(
      'test_test_rateLimits',
    );
    expect(firebase.mockDoc).toHaveBeenCalledWith('127_0_0_1');
    expect(firebase.mockSet).toHaveBeenCalledWith({
      count: 1,
      firstRequestTime: now,
    });
  });

  it('should increment count if within window and under limit', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 5,
        firstRequestTime: now - 30000, // 30 seconds ago
      }),
    });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: 'test',
    });

    expect(result).toBe(true);
    expect(firebase.mockUpdate).toHaveBeenCalledWith({
      count: 6,
    });
  });

  it('should reset count if outside window', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 5,
        firstRequestTime: now - 70000, // 70 seconds ago (outside 60s window)
      }),
    });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: 'test',
    });

    expect(result).toBe(true);
    expect(firebase.mockSet).toHaveBeenCalledWith({
      count: 1,
      firstRequestTime: now,
    });
  });

  it('should block request if rate limit exceeded with NextApiResponse', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    firebase.mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        count: 10,
        firstRequestTime: now - 30000, // 30 seconds ago
      }),
    });

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: 'test',
    });

    expect(result).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Too many test requests, please try again later.',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Rate limit exceeded for IP 127.0.0.1',
    );
  });

  it('should handle errors gracefully', async () => {
    firebase.mockGet.mockRejectedValue(new Error('Database error'));

    const result = await genericRateLimiter(mockReq, mockRes, {
      windowMs: 60000,
      max: 10,
      name: 'test',
    });

    expect(result).toBe(true); // Allow request on error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'RateLimiterError:',
      expect.any(Error),
    );
  });

  it('should use custom IP if provided', async () => {
    const customIp = '192.168.1.1';

    await genericRateLimiter(
      mockReq,
      mockRes,
      {
        windowMs: 60000,
        max: 10,
        name: 'test',
      },
      customIp,
    );

    expect(firebase.mockDoc).toHaveBeenCalledWith('192_168_1_1');
    expect(ipUtils.getClientIp).not.toHaveBeenCalled();
  });
});

describe('deleteRateLimitCounter', () => {
  const mockReq = {} as NextApiRequest;
  const firebase = jest.requireMock('@/services/firebase');
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Default mocks
    jest.spyOn(ipUtils, 'getClientIp').mockReturnValue('127.0.0.1');
    jest.spyOn(envModule, 'isDevelopment').mockReturnValue(false);

    // Default Firebase mocks
    firebase.mockGet.mockResolvedValue({ exists: true });
    firebase.mockDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should skip deletion if db is not available', async () => {
    // Temporarily remove db
    const originalDb = firebase.db;
    firebase.db = null;

    await deleteRateLimitCounter(mockReq, 'test');

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Firestore database not initialized, skipping rate limit counter deletion',
    );

    // Restore db
    firebase.db = originalDb;
  });

  it('should delete rate limit counter if it exists', async () => {
    firebase.mockGet.mockResolvedValue({ exists: true });

    await deleteRateLimitCounter(mockReq, 'test');

    expect(firebase.mockCollection).toHaveBeenCalledWith(
      'prod_test_rateLimits',
    );
    expect(firebase.mockDoc).toHaveBeenCalledWith('127.0.0.1');
    expect(firebase.mockDelete).toHaveBeenCalled();
  });

  it('should warn if rate limit counter does not exist', async () => {
    firebase.mockGet.mockResolvedValue({ exists: false });

    await deleteRateLimitCounter(mockReq, 'test');

    expect(firebase.mockDelete).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'No rate limit counter found for 127.0.0.1. Nothing to delete.',
    );
  });

  it('should handle errors gracefully', async () => {
    firebase.mockGet.mockRejectedValue(new Error('Database error'));

    await deleteRateLimitCounter(mockReq, 'test');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error deleting rate limit counter for 127.0.0.1:',
      expect.any(Error),
    );
  });
});
