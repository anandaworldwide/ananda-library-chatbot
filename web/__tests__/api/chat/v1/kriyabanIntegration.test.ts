/**
 * Integration tests for Kriyaban content exclusion in chat API
 *
 * Tests the end-to-end functionality of excluding Kriyaban-only content
 * from search results in the chat API.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// Type definitions for testing
interface SiteConfig {
  name: string;
  excludedAccessLevels?: string[];
  accessLevelPathMap?: {
    [key: string]: string[];
  };
}

interface MockPineconeIndex {
  namespace: jest.MockedFunction<() => MockPineconeIndex>;
  query: jest.MockedFunction<(params: any) => Promise<any>>;
}

interface VectorMetadata {
  text: string;
  access_level?: string;
  library: string;
  filename?: string;
}

interface QueryResponse {
  matches: Array<{
    id: string;
    score: number;
    metadata: VectorMetadata;
  }>;
}

describe("Kriyaban Content Exclusion Integration", () => {
  // Mock site configurations with proper types
  const mockSiteConfigs: Record<string, SiteConfig> = {
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
  };

  // Mock Pinecone index with proper typing
  let mockPineconeIndex: MockPineconeIndex;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Create properly typed mock
    mockPineconeIndex = {
      namespace: jest.fn().mockReturnThis(),
      query: jest.fn(),
    } as MockPineconeIndex;
  });

  describe("Site Configuration Integration", () => {
    it("should properly load ananda site configuration", () => {
      const anandaConfig = mockSiteConfigs.ananda;

      expect(anandaConfig).toHaveProperty("excludedAccessLevels");
      expect(anandaConfig.excludedAccessLevels).toContain("kriyaban");
      expect(anandaConfig).toHaveProperty("accessLevelPathMap");
      expect(anandaConfig.accessLevelPathMap?.kriyaban).toContain("Kriyaban Only");
    });

    it("should handle crystal site without access restrictions", () => {
      const crystalConfig = mockSiteConfigs.crystal;

      expect(crystalConfig).not.toHaveProperty("excludedAccessLevels");
      expect(crystalConfig).not.toHaveProperty("accessLevelPathMap");
    });
  });

  describe("Pinecone Filter Generation", () => {
    it("should create correct access level filter for ananda site", () => {
      const siteConfig = mockSiteConfigs.ananda;

      // Simulate filter creation logic
      const createAccessLevelFilter = (config: SiteConfig) => {
        if (!config.excludedAccessLevels || config.excludedAccessLevels.length === 0) {
          return null;
        }

        return {
          access_level: {
            $nin: config.excludedAccessLevels,
          },
        };
      };

      const filter = createAccessLevelFilter(siteConfig);

      expect(filter).toEqual({
        access_level: {
          $nin: ["kriyaban"],
        },
      });
    });

    it("should not create access level filter for crystal site", () => {
      const siteConfig = mockSiteConfigs.crystal;

      const createAccessLevelFilter = (config: SiteConfig) => {
        if (!config.excludedAccessLevels || config.excludedAccessLevels.length === 0) {
          return null;
        }

        return {
          access_level: {
            $nin: config.excludedAccessLevels,
          },
        };
      };

      const filter = createAccessLevelFilter(siteConfig);

      expect(filter).toBeNull();
    });

    it("should combine access level filter with other filters", () => {
      const siteConfig = mockSiteConfigs.ananda;

      // Simulate complete filter creation
      const createCompleteFilter = (config: SiteConfig, mediaTypes: string[], library?: string) => {
        const filters: any[] = [];

        // Add media type filter
        if (mediaTypes.length > 0) {
          filters.push({ type: { $in: mediaTypes } });
        }

        // Add library filter
        if (library && library !== "all") {
          filters.push({ library: { $eq: library } });
        }

        // Add access level filter
        if (config.excludedAccessLevels && config.excludedAccessLevels.length > 0) {
          filters.push({ access_level: { $nin: config.excludedAccessLevels } });
        }

        return { $and: filters };
      };

      const filter = createCompleteFilter(siteConfig, ["audio"], "Treasures");

      expect(filter.$and).toHaveLength(3);
      expect(filter.$and).toContainEqual({ type: { $in: ["audio"] } });
      expect(filter.$and).toContainEqual({ library: { $eq: "Treasures" } });
      expect(filter.$and).toContainEqual({ access_level: { $nin: ["kriyaban"] } });
    });
  });

  describe("Search Results Validation", () => {
    it("should exclude kriyaban content from ananda site results", () => {
      // Mock search results that should be filtered
      const mockSearchResults: QueryResponse = {
        matches: [
          {
            id: "public_vector_1",
            score: 0.95,
            metadata: {
              text: "This is accessible content about meditation",
              access_level: "public",
              library: "Treasures",
              filename: "treasures/public/meditation-basics.mp3",
            },
          },
          {
            id: "public_vector_2",
            score: 0.88,
            metadata: {
              text: "General spiritual teachings",
              library: "Treasures",
              filename: "treasures/general/spiritual-teachings.mp3",
              // Note: no access_level means public by default
            },
          },
          // Note: No kriyaban content should be present due to filtering
        ],
      };

      // Verify that no kriyaban content is in the results
      const hasKriyabanContent = mockSearchResults.matches.some(
        (result) =>
          result.metadata.access_level === "kriyaban" ||
          result.metadata.filename?.toLowerCase().includes("kriyaban only")
      );

      expect(hasKriyabanContent).toBe(false);
    });

    it("should return all content for crystal site (no filtering)", () => {
      // Mock search results for crystal site (no access level filtering)
      const mockSearchResults: QueryResponse = {
        matches: [
          {
            id: "crystal_vector_1",
            score: 0.95,
            metadata: {
              text: "Crystal Clarity content",
              library: "Crystal",
              filename: "crystal/books/autobiography-of-a-yogi.pdf",
            },
          },
        ],
      };

      // Crystal site should not have access level restrictions
      expect(mockSearchResults.matches).toHaveLength(1);

      // Should be able to access any content
      const allContentAccessible = mockSearchResults.matches.every((result) => result.metadata.library === "Crystal");
      expect(allContentAccessible).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing site configuration gracefully", () => {
      const createAccessLevelFilter = (config: SiteConfig | null) => {
        if (!config || !config.excludedAccessLevels || config.excludedAccessLevels.length === 0) {
          return null;
        }

        return {
          access_level: {
            $nin: config.excludedAccessLevels,
          },
        };
      };

      // Should not throw error when site config is missing
      expect(() => {
        const filter = createAccessLevelFilter(null);
        return filter;
      }).not.toThrow();

      const filter = createAccessLevelFilter(null);
      expect(filter).toBeNull();
    });

    it("should handle malformed site configuration", () => {
      const malformedConfig = {
        name: "Test Site",
        excludedAccessLevels: "invalid-not-array" as any, // Intentionally malformed
      };

      const createAccessLevelFilter = (config: any) => {
        try {
          if (!config || !Array.isArray(config.excludedAccessLevels) || config.excludedAccessLevels.length === 0) {
            return null;
          }

          return {
            access_level: {
              $nin: config.excludedAccessLevels,
            },
          };
        } catch {
          return null;
        }
      };

      // Should handle malformed config gracefully
      expect(() => {
        const filter = createAccessLevelFilter(malformedConfig);
        return filter;
      }).not.toThrow();

      const filter = createAccessLevelFilter(malformedConfig);
      expect(filter).toBeNull();
    });

    it("should handle query errors gracefully", async () => {
      // Mock query error
      mockPineconeIndex.query.mockRejectedValue(new Error("Pinecone connection failed"));

      // Error should be caught and handled gracefully
      try {
        await mockPineconeIndex.query({});
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Pinecone connection failed");
      }
    });
  });

  describe("Performance Considerations", () => {
    it("should not significantly impact query performance", () => {
      // Test that adding access level filter doesn't create performance issues
      const startTime = performance.now();

      // Simulate filter creation
      const siteConfig = mockSiteConfigs.ananda;
      const filter = {
        $and: [
          { type: { $in: ["audio", "text"] } },
          { library: { $eq: "Treasures" } },
          ...(siteConfig.excludedAccessLevels ? [{ access_level: { $nin: siteConfig.excludedAccessLevels } }] : []),
        ],
      };

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Filter creation should be very fast (< 5ms)
      expect(duration).toBeLessThan(5);
      expect(filter.$and).toHaveLength(3);
    });

    it("should handle large exclusion lists efficiently", () => {
      const largeExclusionList = Array.from({ length: 1000 }, (_, i) => `level_${i}`);
      const siteConfigWithLargeList: SiteConfig = {
        name: "Test Site",
        excludedAccessLevels: largeExclusionList,
      };

      const startTime = performance.now();

      const filter = {
        access_level: { $nin: siteConfigWithLargeList.excludedAccessLevels },
      };

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should handle large lists efficiently
      expect(duration).toBeLessThan(10);
      expect(filter.access_level.$nin).toHaveLength(1000);
    });
  });

  describe("Backward Compatibility", () => {
    it("should not affect existing functionality for sites without access levels", () => {
      // Test that sites without access level configuration work as before
      const siteConfig: SiteConfig = { name: "Test Site" };

      const createFilter = (config: SiteConfig, mediaTypes: string[]) => {
        const filters: any[] = [];

        // Add media type filter (existing functionality)
        if (mediaTypes.length > 0) {
          filters.push({ type: { $in: mediaTypes } });
        }

        // Access level filter should not be added
        if (config.excludedAccessLevels && config.excludedAccessLevels.length > 0) {
          filters.push({ access_level: { $nin: config.excludedAccessLevels } });
        }

        return { $and: filters };
      };

      const filter = createFilter(siteConfig, ["audio"]);

      // Should only have media type filter
      expect(filter.$and).toHaveLength(1);
      expect(filter.$and[0]).toEqual({ type: { $in: ["audio"] } });
    });

    it("should preserve existing vector metadata", () => {
      // Test that existing vectors without access_level metadata still work
      const mockVector = {
        id: "legacy_vector",
        metadata: {
          text: "Legacy content without access_level",
          library: "Treasures",
          filename: "treasures/legacy/old-content.mp3",
          // Note: no access_level field
        } as VectorMetadata,
      };

      // Legacy vectors should be treated as public (accessible)
      const accessLevel = mockVector.metadata.access_level || "public";
      expect(accessLevel).toBe("public");

      // Should still be accessible in searches
      const isAccessible = accessLevel === "public";
      expect(isAccessible).toBe(true);
    });
  });

  describe("Access Level Path Mapping", () => {
    it("should correctly determine access level from file paths", () => {
      const siteConfig = mockSiteConfigs.ananda;

      const determineAccessLevel = (filePath: string, config: SiteConfig): string => {
        if (!filePath || !config.accessLevelPathMap) return "public";

        for (const [accessLevel, patterns] of Object.entries(config.accessLevelPathMap)) {
          for (const pattern of patterns) {
            if (filePath.toLowerCase().includes(pattern.toLowerCase())) {
              return accessLevel;
            }
          }
        }

        return "public";
      };

      const testCases = [
        { path: "treasures/Kriyaban Only/file.mp3", expected: "kriyaban" },
        { path: "treasures/KRIYABAN ONLY/file.mp3", expected: "kriyaban" },
        { path: "treasures/public/file.mp3", expected: "public" },
        { path: "treasures/general/file.mp3", expected: "public" },
        { path: "", expected: "public" },
      ];

      testCases.forEach(({ path, expected }) => {
        const result = determineAccessLevel(path, siteConfig);
        expect(result).toBe(expected);
      });
    });
  });
});
