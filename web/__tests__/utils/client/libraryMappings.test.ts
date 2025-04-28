/**
 * Tests for the libraryMappings utility
 */

import {
  libraryMappings,
  getMappedLibraryName,
  getLibraryUrl,
} from '@/utils/client/libraryMappings';

describe('libraryMappings', () => {
  describe('getMappedLibraryName', () => {
    it('should return the mapped display name for known libraries', () => {
      expect(getMappedLibraryName('Ananda Youtube')).toBe('Ananda YouTube');
      expect(getMappedLibraryName('Treasures')).toBe('Treasures');
      expect(getMappedLibraryName('Ananda Library')).toBe('Ananda Library');
    });

    it('should return the original name for unknown libraries', () => {
      const unknownLibrary = 'Unknown Library';
      expect(getMappedLibraryName(unknownLibrary)).toBe(unknownLibrary);
    });

    it('should handle empty strings', () => {
      expect(getMappedLibraryName('')).toBe('');
    });
  });

  describe('getLibraryUrl', () => {
    it('should return the correct URL for known libraries', () => {
      expect(getLibraryUrl('Ananda Youtube')).toBe(
        'https://www.youtube.com/user/AnandaWorldwide',
      );
      expect(getLibraryUrl('Treasures')).toBe(
        'https://www.treasuresalongthepath.com/',
      );
      expect(getLibraryUrl('Ananda Library')).toBe(
        'https://www.anandalibrary.org/',
      );
    });

    it('should return undefined for unknown libraries', () => {
      expect(getLibraryUrl('Unknown Library')).toBeUndefined();
    });

    it('should handle empty strings', () => {
      expect(getLibraryUrl('')).toBeUndefined();
    });
  });

  describe('libraryMappings object', () => {
    it('should contain all expected library mappings', () => {
      expect(Object.keys(libraryMappings)).toContain('Ananda Youtube');
      expect(Object.keys(libraryMappings)).toContain('Treasures');
      expect(Object.keys(libraryMappings)).toContain('Ananda Library');
    });

    it('should have the correct structure for each mapping', () => {
      Object.values(libraryMappings).forEach((mapping) => {
        expect(mapping).toHaveProperty('displayName');
        // URL is optional, so we don't always check for it
      });
    });

    it('should have URLs for all current mappings', () => {
      // Current implementation has URLs for all mappings, so we test that
      Object.values(libraryMappings).forEach((mapping) => {
        expect(mapping).toHaveProperty('url');
        expect(typeof mapping.url).toBe('string');
        expect(mapping.url).toMatch(/^https?:\/\//); // Should be a valid URL
      });
    });
  });
});
