import { jest } from '@jest/globals';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';

// Mock the module without using spread
jest.mock('@/utils/env', () => ({
  isDevelopment: jest
    .fn()
    .mockImplementation(() => process.env.NODE_ENV === 'development'),
  isProduction: jest
    .fn()
    .mockImplementation(() => process.env.NODE_ENV === 'production'),
  getEnvName: jest
    .fn()
    .mockImplementation(() =>
      process.env.NODE_ENV === 'development' ? 'dev' : 'prod',
    ),
}));

describe('Firestore Utilities', () => {
  const originalEnv = process.env.NODE_ENV;

  afterAll(() => {
    // Restore the original environment
    jest.replaceProperty(process.env, 'NODE_ENV', originalEnv);
  });

  test('getAnswersCollectionName returns dev_chatLogs in development environment', () => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'development');
    expect(getAnswersCollectionName()).toBe('dev_chatLogs');
  });

  test('getAnswersCollectionName returns prod_chatLogs in production environment', () => {
    jest.replaceProperty(process.env, 'NODE_ENV', 'production');
    expect(getAnswersCollectionName()).toBe('prod_chatLogs');
  });
});
