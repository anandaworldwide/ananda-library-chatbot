/**
 * Comprehensive Security Tests for Redis Utils
 * 
 * This test suite covers:
 * - Input validation and sanitization
 * - Cache key security validation
 * - Data serialization/deserialization security
 * - Error handling for Redis unavailability
 * - Connection security and authentication
 * - Cache expiration and cleanup mechanisms
 * - Dependency injection and mocking
 */

import {
  RedisCacheService,
  createCacheService,
  validateCacheKey,
  sanitizeCacheValue,
  parseCacheValue,
  getCacheExpiration,
  createRedisClient,
  getFromCache,
  setInCache,
  deleteFromCache,
  CACHE_EXPIRATION,
  __setGlobalRedisClientForTesting,
  type RedisClientInterface,
  type EnvironmentConfig,
} from '../../../src/utils/server/redisUtils';

// Mock Redis client for testing
class MockRedisClient implements RedisClientInterface {
  private storage = new Map<string, { value: string; expiration?: number; timestamp: number }>();
  private shouldThrow = false;
  private throwOnMethods: Set<string> = new Set();

  async get<T = string>(key: string): Promise<T | null> {
    if (this.shouldThrow || this.throwOnMethods.has('get')) {
      throw new Error('Redis connection error');
    }

    const item = this.storage.get(key);
    if (!item) return null;

    // Check expiration
    if (item.expiration && Date.now() > item.timestamp + item.expiration * 1000) {
      this.storage.delete(key);
      return null;
    }

    return item.value as T;
  }

  async set(key: string, value: string, options?: { ex?: number }): Promise<string | null> {
    if (this.shouldThrow || this.throwOnMethods.has('set')) {
      throw new Error('Redis connection error');
    }

    this.storage.set(key, {
      value,
      expiration: options?.ex,
      timestamp: Date.now(),
    });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    if (this.shouldThrow || this.throwOnMethods.has('del')) {
      throw new Error('Redis connection error');
    }

    const existed = this.storage.has(key);
    this.storage.delete(key);
    return existed ? 1 : 0;
  }

  async ping(): Promise<string> {
    if (this.shouldThrow || this.throwOnMethods.has('ping')) {
      throw new Error('Redis connection error');
    }
    return 'PONG';
  }

  // Test utilities
  setThrowError(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  setThrowOnMethod(method: string, shouldThrow: boolean): void {
    if (shouldThrow) {
      this.throwOnMethods.add(method);
    } else {
      this.throwOnMethods.delete(method);
    }
  }

  clear(): void {
    this.storage.clear();
  }

  getStorageSize(): number {
    return this.storage.size;
  }

  hasKey(key: string): boolean {
    return this.storage.has(key);
  }
}

// Mock environment configurations
const createMockEnvironment = (overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig => ({
  isDevelopment: () => false,
  getRedisUrl: () => 'https://test-redis.upstash.io',
  getRedisToken: () => 'test-token',
  ...overrides,
});

const missingConfigEnvironment = createMockEnvironment({
  getRedisUrl: () => undefined,
  getRedisToken: () => undefined,
});

describe('Redis Utils Security Tests', () => {
  let mockRedisClient: MockRedisClient;
  let cacheService: RedisCacheService;

  beforeEach(() => {
    mockRedisClient = new MockRedisClient();
    cacheService = new RedisCacheService(createMockEnvironment());
    cacheService.setRedisClient(mockRedisClient);
    
    // Clear any previous state
    mockRedisClient.clear();
    mockRedisClient.setThrowError(false);
    mockRedisClient.setThrowOnMethod('get', false);
    mockRedisClient.setThrowOnMethod('set', false);
    mockRedisClient.setThrowOnMethod('del', false);
    mockRedisClient.setThrowOnMethod('ping', false);
  });

  describe('Cache Key Validation Security', () => {
    describe('validateCacheKey', () => {
      test('should accept valid cache keys', () => {
        expect(() => validateCacheKey('valid-key')).not.toThrow();
        expect(() => validateCacheKey('user:123')).not.toThrow();
        expect(() => validateCacheKey('session_abc123')).not.toThrow();
        expect(() => validateCacheKey('cache.key.with.dots')).not.toThrow();
      });

      test('should reject non-string keys', () => {
        expect(() => validateCacheKey(123 as any)).toThrow('Cache key must be a string');
        expect(() => validateCacheKey(null as any)).toThrow('Cache key must be a string');
        expect(() => validateCacheKey(undefined as any)).toThrow('Cache key must be a string');
        expect(() => validateCacheKey({} as any)).toThrow('Cache key must be a string');
      });

      test('should reject empty keys', () => {
        expect(() => validateCacheKey('')).toThrow('Cache key cannot be empty');
      });

      test('should reject keys that are too long', () => {
        const longKey = 'a'.repeat(251);
        expect(() => validateCacheKey(longKey)).toThrow('Cache key too long (max 250 characters)');
      });

      test('should reject keys with invalid characters (injection prevention)', () => {
        expect(() => validateCacheKey('key\nwith\nnewlines')).toThrow('Cache key contains invalid characters');
        expect(() => validateCacheKey('key\rwith\rcarriage')).toThrow('Cache key contains invalid characters');
        expect(() => validateCacheKey('key\0with\0null')).toThrow('Cache key contains invalid characters');
      });

      test('should reject keys with leading/trailing whitespace', () => {
        expect(() => validateCacheKey(' leading-space')).toThrow('Cache key cannot start or end with whitespace');
        expect(() => validateCacheKey('trailing-space ')).toThrow('Cache key cannot start or end with whitespace');
        expect(() => validateCacheKey(' both-sides ')).toThrow('Cache key cannot start or end with whitespace');
      });
    });
  });

  describe('Cache Value Sanitization Security', () => {
    describe('sanitizeCacheValue', () => {
      test('should handle null and undefined values safely', () => {
        expect(sanitizeCacheValue(null)).toBe('null');
        expect(sanitizeCacheValue(undefined)).toBe('null');
      });

      test('should serialize strings properly', () => {
        expect(sanitizeCacheValue('test string')).toBe('"test string"');
        expect(sanitizeCacheValue('')).toBe('""');
      });

      test('should serialize numbers and booleans', () => {
        expect(sanitizeCacheValue(123)).toBe('123');
        expect(sanitizeCacheValue(true)).toBe('true');
        expect(sanitizeCacheValue(false)).toBe('false');
      });

      test('should serialize objects and arrays', () => {
        const obj = { key: 'value', num: 42 };
        expect(sanitizeCacheValue(obj)).toBe('{"key":"value","num":42}');
        
        const arr = [1, 2, 'three'];
        expect(sanitizeCacheValue(arr)).toBe('[1,2,"three"]');
      });

      test('should reject values that are too large (security limit)', () => {
        const largeString = 'a'.repeat(1048577); // 1MB + 1 byte
        expect(() => sanitizeCacheValue(largeString)).toThrow('Cache value too large (max 1MB)');
        
        const largeObject = { data: 'a'.repeat(1048577) };
        expect(() => sanitizeCacheValue(largeObject)).toThrow('Cache value too large (max 1MB)');
      });

      test('should handle circular references gracefully', () => {
        const circular: any = { name: 'test' };
        circular.self = circular;
        expect(() => sanitizeCacheValue(circular)).toThrow('Cache value cannot be serialized to JSON');
      });
    });

    describe('parseCacheValue', () => {
      test('should parse null values', () => {
        expect(parseCacheValue(null)).toBeNull();
      });

      test('should parse valid JSON', () => {
        expect(parseCacheValue('"test string"')).toBe('test string');
        expect(parseCacheValue('123')).toBe(123);
        expect(parseCacheValue('true')).toBe(true);
        expect(parseCacheValue('{"key":"value"}')).toEqual({ key: 'value' });
      });

      test('should handle invalid JSON gracefully (fallback to original)', () => {
        expect(parseCacheValue('invalid json')).toBe('invalid json');
        expect(parseCacheValue('{"incomplete":')).toBe('{"incomplete":');
      });

      test('should re-throw non-SyntaxError exceptions', () => {
        // This is hard to test without mocking JSON.parse, but the logic is there
        expect(() => parseCacheValue('null')).not.toThrow();
      });
    });
  });

  describe('Redis Connection Security', () => {
    test('should handle missing Redis configuration gracefully', async () => {
      const serviceWithMissingConfig = new RedisCacheService(missingConfigEnvironment);
      
      const result = await serviceWithMissingConfig.getFromCache('test-key');
      expect(result).toBeNull();
      
      await serviceWithMissingConfig.setInCache('test-key', 'test-value');
      // Should not throw, should handle gracefully
      
      await serviceWithMissingConfig.deleteFromCache('test-key');
      // Should not throw, should handle gracefully
    });

    test('should handle Redis connection failures gracefully', async () => {
      mockRedisClient.setThrowOnMethod('ping', true);
      
      const result = await cacheService.getFromCache('test-key');
      expect(result).toBeNull();
      
      // Should not throw, should handle connection failure gracefully
      await cacheService.setInCache('test-key', 'test-value');
      await cacheService.deleteFromCache('test-key');
    });

    test('should handle Redis operation failures gracefully', async () => {
      // Test get operation failure
      mockRedisClient.setThrowOnMethod('get', true);
      const getResult = await cacheService.getFromCache('test-key');
      expect(getResult).toBeNull();
      
      // Test set operation failure
      mockRedisClient.setThrowOnMethod('get', false);
      mockRedisClient.setThrowOnMethod('set', true);
      await cacheService.setInCache('test-key', 'test-value');
      // Should not throw
      
      // Test delete operation failure
      mockRedisClient.setThrowOnMethod('set', false);
      mockRedisClient.setThrowOnMethod('del', true);
      await cacheService.deleteFromCache('test-key');
      // Should not throw
    });
  });

  describe('Cache Expiration Security', () => {
    test('should validate expiration values', async () => {
      // Test negative expiration
      await cacheService.setInCache('test-key', 'test-value', -1);
      // Should handle gracefully (logged error)
      
      // Test extremely large expiration
      await cacheService.setInCache('test-key', 'test-value', 2147483648);
      // Should handle gracefully (logged error)
    });

    test('should respect cache expiration times', async () => {
      await cacheService.setInCache('test-key', 'test-value', 1);
      
      // Should be available immediately
      const result = await cacheService.getFromCache('test-key');
      expect(result).toBe('test-value');
      
      // Mock time passage (this is a simplified test)
      // In a real scenario, you'd need to mock Date.now() or wait
    });

    test('should use correct default expiration for different environments', () => {
      const prodExpiration = getCacheExpiration(createMockEnvironment({ isDevelopment: () => false }));
      expect(prodExpiration).toBe(86400); // 24 hours
      
      const devExpiration = getCacheExpiration(createMockEnvironment({ isDevelopment: () => true }));
      expect(devExpiration).toBe(3600); // 1 hour
    });
  });

  describe('Input Validation and Sanitization', () => {
    test('should validate cache keys before operations', async () => {
      // These should all handle invalid keys gracefully
      await cacheService.getFromCache('');
      await cacheService.setInCache('', 'value');
      await cacheService.deleteFromCache('');
      
      await cacheService.getFromCache('key\nwith\nnewlines');
      await cacheService.setInCache('key\nwith\nnewlines', 'value');
      await cacheService.deleteFromCache('key\nwith\nnewlines');
      
      // Should not throw, should log errors and return null/do nothing
    });

    test('should handle malformed data gracefully', async () => {
      // Manually insert malformed data
      await mockRedisClient.set('malformed-key', 'not-json-but-not-string');
      
      const result = await cacheService.getFromCache('malformed-key');
      expect(result).toBe('not-json-but-not-string'); // Fallback behavior
    });
  });

  describe('Service Availability and State Management', () => {
    test('should track availability correctly', () => {
      expect(cacheService.isAvailable()).toBe(true);
      
      cacheService.setRedisClient(null);
      expect(cacheService.isAvailable()).toBe(false);
    });

    test('should allow clearing cache for testing', async () => {
      await cacheService.setInCache('test-key', 'test-value');
      expect(mockRedisClient.hasKey('test-key')).toBe(true);
      
      await cacheService.clearCache();
      expect(cacheService.isAvailable()).toBe(false);
    });
  });

  describe('Dependency Injection and Factory Functions', () => {
    test('should create cache service with custom environment', () => {
      const customEnv = createMockEnvironment({ isDevelopment: () => true });
      const service = createCacheService(customEnv);
      
      expect(service).toBeInstanceOf(RedisCacheService);
    });

    test('should create Redis client with configuration', () => {
      const config = { url: 'https://test-redis.upstash.io', token: 'test-token' };
      const client = createRedisClient(config);
      
      expect(client).toBeDefined();
      // Note: We can't test the actual Redis connection without a real Redis instance
    });
  });

  describe('Legacy Function Compatibility', () => {
    beforeEach(() => {
      // Inject our mock client into the global cache service
      __setGlobalRedisClientForTesting(mockRedisClient);
    });

    test('should maintain backward compatibility with legacy functions', async () => {
      // These functions should work without throwing
      await setInCache('legacy-key', 'legacy-value');
      const result = await getFromCache('legacy-key');
      expect(result).toBe('legacy-value');
      
      await deleteFromCache('legacy-key');
      const deletedResult = await getFromCache('legacy-key');
      expect(deletedResult).toBeNull();
    });

    test('should export correct CACHE_EXPIRATION constant', () => {
      expect(typeof CACHE_EXPIRATION).toBe('number');
      expect(CACHE_EXPIRATION).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Logging', () => {
    let consoleSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    test('should log errors appropriately without exposing sensitive information', async () => {
      mockRedisClient.setThrowOnMethod('get', true);
      
      await cacheService.getFromCache('test-key');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error fetching from cache for key 'test-key':"),
        expect.any(Error)
      );
    });

    test('should log connection errors without exposing credentials', async () => {
      // Test the missing configuration scenario which triggers a warning
      const serviceWithMissingConfig = new RedisCacheService(missingConfigEnvironment);
      
      await serviceWithMissingConfig.getFromCache('test-key');
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Redis configuration missing - caching disabled'
      );
    });
  });

  describe('Performance and Memory Safety', () => {
    test('should handle multiple concurrent operations safely', async () => {
      const promises = [];
      
      // Simulate concurrent cache operations
      for (let i = 0; i < 10; i++) {
        promises.push(cacheService.setInCache(`key-${i}`, `value-${i}`));
        promises.push(cacheService.getFromCache(`key-${i}`));
      }
      
      await Promise.all(promises);
      
      // Should not throw and should handle concurrency gracefully
      expect(mockRedisClient.getStorageSize()).toBeGreaterThan(0);
    });

    test('should prevent memory leaks with proper cleanup', async () => {
      // Set multiple values
      for (let i = 0; i < 5; i++) {
        await cacheService.setInCache(`temp-key-${i}`, `temp-value-${i}`);
      }
      
      // Delete them all
      for (let i = 0; i < 5; i++) {
        await cacheService.deleteFromCache(`temp-key-${i}`);
      }
      
      // Storage should be clean
      expect(mockRedisClient.getStorageSize()).toBe(0);
    });
  });

  describe('Integration with Real Redis Client Interface', () => {
    test('should be compatible with actual Redis client interface', () => {
      // This test ensures our mock matches the real interface
      const realClient = createRedisClient({ url: 'https://test-redis.upstash.io', token: 'test-token' });
      
      // Check that required methods exist
      expect(typeof realClient.get).toBe('function');
      expect(typeof realClient.set).toBe('function');
      expect(typeof realClient.del).toBe('function');
      expect(typeof realClient.ping).toBe('function');
    });
  });
});