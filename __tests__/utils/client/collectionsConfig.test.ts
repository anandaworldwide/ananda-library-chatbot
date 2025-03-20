import {
  collectionsConfig,
  CollectionKey,
} from '@/utils/client/collectionsConfig';

describe('collectionsConfig', () => {
  it('should export the collections configuration object', () => {
    expect(collectionsConfig).toBeDefined();
    expect(typeof collectionsConfig).toBe('object');
  });

  it('should contain predefined collection keys', () => {
    expect(collectionsConfig).toHaveProperty('master_swami');
    expect(collectionsConfig).toHaveProperty('whole_library');
  });

  it('should have the correct values for each collection', () => {
    expect(collectionsConfig.master_swami).toBe('Master and Swami');
    expect(collectionsConfig.whole_library).toBe('All authors');
  });

  it('should define CollectionKey type', () => {
    // TypeScript type test - this is just to ensure compile-time type safety
    // This doesn't actually run any assertions at runtime
    const testKey: CollectionKey = 'master_swami';
    expect(collectionsConfig[testKey]).toBe('Master and Swami');
  });
});
