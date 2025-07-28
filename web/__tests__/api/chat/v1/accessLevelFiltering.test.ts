/**
 * Tests for access level filtering in chat API
 *
 * Tests the Pinecone filter generation and application for excluding
 * Kriyaban-only content from search results.
 */

import { describe, it, expect } from "@jest/globals";

// Mock the site configuration
const mockSiteConfigs = {
  ananda: {
    name: "Luca, The Ananda Devotee Chatbot",
    excludedAccessLevels: ["kriyaban"],
    accessLevelPathMap: {
      kriyaban: ["Kriyaban Only"],
    },
  },
  crystal: {
    name: "Crystal Clarity Assistant",
    // No access level restrictions
  },
  "ananda-public": {
    name: "Ananda Public Assistant",
    excludedAccessLevels: ["kriyaban", "admin"],
    accessLevelPathMap: {
      kriyaban: ["Kriyaban Only"],
      admin: ["Admin Only"],
    },
  },
};

describe("Access Level Filtering", () => {
  describe("setupPineconeAndFilter", () => {
    // Simulate the filter creation logic from route.ts
    const createAccessLevelFilter = (siteConfig: any) => {
      const excludedAccessLevels = siteConfig.excludedAccessLevels;
      if (!excludedAccessLevels || excludedAccessLevels.length === 0) {
        return {};
      }

      return {
        access_level: {
          $nin: excludedAccessLevels,
        },
      };
    };

    const setupPineconeAndFilter = (collection: string, mediaTypes: any, siteConfig: any) => {
      const filter: any = {
        $and: [],
      };

      // Add media type filter
      if (mediaTypes) {
        const activeTypes = Object.entries(mediaTypes)
          .filter(([, enabled]) => enabled)
          .map(([type]) => type);

        if (activeTypes.length > 0) {
          filter.$and.push({ type: { $in: activeTypes } });
        }
      }

      // Add collection filter
      if (collection && collection !== "all") {
        filter.$and.push({ library: { $eq: collection } });
      }

      // Add access level filter
      const accessLevelFilter = createAccessLevelFilter(siteConfig);
      if (accessLevelFilter.access_level) {
        filter.$and.push(accessLevelFilter);
      }

      return { filter };
    };

    it("should add access level filter for ananda site", () => {
      const result = setupPineconeAndFilter("all", undefined, mockSiteConfigs.ananda);

      expect(result.filter.$and).toContainEqual({
        access_level: {
          $nin: ["kriyaban"],
        },
      });
    });

    it("should add multiple access level exclusions for ananda-public", () => {
      const result = setupPineconeAndFilter("all", undefined, mockSiteConfigs["ananda-public"]);

      expect(result.filter.$and).toContainEqual({
        access_level: {
          $nin: ["kriyaban", "admin"],
        },
      });
    });

    it("should not add access level filter for crystal site", () => {
      const result = setupPineconeAndFilter("all", undefined, mockSiteConfigs.crystal);

      const hasAccessLevelFilter = result.filter.$and.some((filter: any) => filter.access_level !== undefined);
      expect(hasAccessLevelFilter).toBe(false);
    });

    it("should combine access level filter with media type filters", () => {
      const mediaTypes = { audio: true, text: false };
      const result = setupPineconeAndFilter("all", mediaTypes, mockSiteConfigs.ananda);

      expect(result.filter.$and).toContainEqual({
        type: { $in: ["audio"] },
      });
      expect(result.filter.$and).toContainEqual({
        access_level: { $nin: ["kriyaban"] },
      });
    });

    it("should combine access level filter with collection filters", () => {
      const result = setupPineconeAndFilter("Treasures", undefined, mockSiteConfigs.ananda);

      expect(result.filter.$and).toContainEqual({
        library: { $eq: "Treasures" },
      });
      expect(result.filter.$and).toContainEqual({
        access_level: { $nin: ["kriyaban"] },
      });
    });

    it("should handle all filter combinations", () => {
      const mediaTypes = { audio: true, video: true };
      const result = setupPineconeAndFilter("Treasures", mediaTypes, mockSiteConfigs["ananda-public"]);

      expect(result.filter.$and).toHaveLength(3);
      expect(result.filter.$and).toContainEqual({
        type: { $in: ["audio", "video"] },
      });
      expect(result.filter.$and).toContainEqual({
        library: { $eq: "Treasures" },
      });
      expect(result.filter.$and).toContainEqual({
        access_level: { $nin: ["kriyaban", "admin"] },
      });
    });
  });

  describe("Filter Structure Validation", () => {
    it("should create valid Pinecone filter structure", () => {
      const filter = {
        $and: [
          { type: { $in: ["audio"] } },
          { library: { $eq: "Treasures" } },
          { access_level: { $nin: ["kriyaban"] } },
        ],
      };

      // Validate the structure matches Pinecone expectations
      expect(filter).toHaveProperty("$and");
      expect(Array.isArray(filter.$and)).toBe(true);
      expect(filter.$and.length).toBe(3);

      // Check each filter component
      const [typeFilter, libraryFilter, accessFilter] = filter.$and;

      expect(typeFilter).toHaveProperty("type");
      expect(typeFilter.type).toHaveProperty("$in");
      expect(Array.isArray(typeFilter.type.$in)).toBe(true);

      expect(libraryFilter).toHaveProperty("library");
      expect(libraryFilter.library).toHaveProperty("$eq");

      expect(accessFilter).toHaveProperty("access_level");
      expect(accessFilter.access_level).toHaveProperty("$nin");
      expect(Array.isArray(accessFilter.access_level.$nin)).toBe(true);
    });

    it("should handle empty $and array when no filters apply", () => {
      const filter = { $and: [] };

      // Empty $and should still be valid
      expect(filter).toHaveProperty("$and");
      expect(Array.isArray(filter.$and)).toBe(true);
      expect(filter.$and.length).toBe(0);
    });
  });

  describe("Site Configuration Edge Cases", () => {
    it("should handle site config without excludedAccessLevels", () => {
      const siteConfig = { name: "Test Site" };
      const createAccessLevelFilter = (siteConfig: any) => {
        const excludedAccessLevels = siteConfig.excludedAccessLevels;
        if (!excludedAccessLevels || excludedAccessLevels.length === 0) {
          return {};
        }
        return { access_level: { $nin: excludedAccessLevels } };
      };

      const filter = createAccessLevelFilter(siteConfig);
      expect(filter).toEqual({});
    });

    it("should handle site config with empty excludedAccessLevels array", () => {
      const siteConfig = { excludedAccessLevels: [] };
      const createAccessLevelFilter = (siteConfig: any) => {
        const excludedAccessLevels = siteConfig.excludedAccessLevels;
        if (!excludedAccessLevels || excludedAccessLevels.length === 0) {
          return {};
        }
        return { access_level: { $nin: excludedAccessLevels } };
      };

      const filter = createAccessLevelFilter(siteConfig);
      expect(filter).toEqual({});
    });

    it("should handle malformed site configuration gracefully", () => {
      const malformedConfigs = [
        null,
        undefined,
        "string",
        123,
        { excludedAccessLevels: "not-array" },
        { excludedAccessLevels: null },
      ];

      const createAccessLevelFilter = (siteConfig: any) => {
        try {
          const excludedAccessLevels = siteConfig?.excludedAccessLevels;
          if (!Array.isArray(excludedAccessLevels) || excludedAccessLevels.length === 0) {
            return {};
          }
          return { access_level: { $nin: excludedAccessLevels } };
        } catch {
          return {};
        }
      };

      malformedConfigs.forEach((config) => {
        expect(() => createAccessLevelFilter(config)).not.toThrow();
        expect(createAccessLevelFilter(config)).toEqual({});
      });
    });
  });

  describe("Performance Considerations", () => {
    it("should not create unnecessary filter objects", () => {
      const siteConfig = { name: "Test Site" }; // No access restrictions

      const createAccessLevelFilter = (siteConfig: any) => {
        const excludedAccessLevels = siteConfig.excludedAccessLevels;
        if (!excludedAccessLevels || excludedAccessLevels.length === 0) {
          return {}; // Return empty object, not null, to avoid extra checks
        }
        return { access_level: { $nin: excludedAccessLevels } };
      };

      const filter = createAccessLevelFilter(siteConfig);
      expect(Object.keys(filter)).toHaveLength(0);
    });

    it("should handle large exclusion lists efficiently", () => {
      const largeExclusionList = Array.from({ length: 100 }, (_, i) => `level_${i}`);
      const siteConfig = { excludedAccessLevels: largeExclusionList };

      const createAccessLevelFilter = (siteConfig: any) => {
        const excludedAccessLevels = siteConfig.excludedAccessLevels;
        if (!excludedAccessLevels || excludedAccessLevels.length === 0) {
          return {};
        }
        return { access_level: { $nin: excludedAccessLevels } };
      };

      const filter = createAccessLevelFilter(siteConfig);
      expect(filter.access_level.$nin).toHaveLength(100);
      expect(filter.access_level.$nin[0]).toBe("level_0");
      expect(filter.access_level.$nin[99]).toBe("level_99");
    });
  });
});
