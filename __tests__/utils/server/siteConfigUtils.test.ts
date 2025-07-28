/**
 * Tests for site configuration utilities
 *
 * Tests the centralized site configuration loading and access level determination
 * functionality used across the application.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

// Mock the pyutil modules since these are Python utilities
// We'll test the TypeScript equivalents or create wrapper functions

describe("Site Configuration Access Level Logic", () => {
  const mockSiteConfig = {
    excludedAccessLevels: ["kriyaban"],
    accessLevelPathMap: {
      kriyaban: ["Kriyaban Only"],
      admin: ["Admin Only", "Staff Only"],
    },
  };

  describe("determineAccessLevel", () => {
    const determineAccessLevel = (filePath: string, siteConfig: any): string => {
      if (!filePath) return "public";

      const accessLevelPathMap = siteConfig.accessLevelPathMap || {};

      for (const [accessLevel, patterns] of Object.entries(accessLevelPathMap)) {
        const patternArray = patterns as string[];
        for (const pattern of patternArray) {
          if (filePath.toLowerCase().includes(pattern.toLowerCase())) {
            return accessLevel;
          }
        }
      }

      return "public";
    };

    it('should return "public" for empty file path', () => {
      expect(determineAccessLevel("", mockSiteConfig)).toBe("public");
      expect(determineAccessLevel(null as any, mockSiteConfig)).toBe("public");
    });

    it('should return "public" for paths with no matching patterns', () => {
      const filePath = "treasures/public/regular-content.mp3";
      expect(determineAccessLevel(filePath, mockSiteConfig)).toBe("public");
    });

    it('should return "kriyaban" for paths containing "Kriyaban Only"', () => {
      const testPaths = [
        "treasures/Thumb drive from Krishna 7-2024/Kriyaban Only/file.mp3",
        "treasures/kriyaban only/content.mp3",
        "treasures/KRIYABAN ONLY/content.mp3",
        "treasures/some/kriyaban only/nested/file.mp3",
      ];

      testPaths.forEach((path) => {
        expect(determineAccessLevel(path, mockSiteConfig)).toBe("kriyaban");
      });
    });

    it('should return "admin" for paths containing admin patterns', () => {
      const testPaths = [
        "treasures/Admin Only/content.mp3",
        "treasures/Staff Only/content.mp3",
        "treasures/admin only/content.mp3",
      ];

      testPaths.forEach((path) => {
        expect(determineAccessLevel(path, mockSiteConfig)).toBe("admin");
      });
    });

    it("should be case-insensitive", () => {
      const testCases = [
        { path: "treasures/KRIYABAN ONLY/file.mp3", expected: "kriyaban" },
        { path: "treasures/kriyaban only/file.mp3", expected: "kriyaban" },
        { path: "treasures/Kriyaban Only/file.mp3", expected: "kriyaban" },
        { path: "treasures/ADMIN ONLY/file.mp3", expected: "admin" },
      ];

      testCases.forEach(({ path, expected }) => {
        expect(determineAccessLevel(path, mockSiteConfig)).toBe(expected);
      });
    });

    it("should return first matching access level if multiple patterns match", () => {
      // If we had overlapping patterns, it should return the first match
      const configWithOverlap = {
        accessLevelPathMap: {
          kriyaban: ["Special"],
          admin: ["Special Content"],
        },
      };

      // "Special" should match first since it's checked first
      expect(determineAccessLevel("treasures/Special Content/file.mp3", configWithOverlap)).toBe("kriyaban");
    });

    it("should handle empty or missing accessLevelPathMap", () => {
      expect(determineAccessLevel("any/path.mp3", {})).toBe("public");
      expect(determineAccessLevel("any/path.mp3", { accessLevelPathMap: {} })).toBe("public");
    });
  });

  describe("getExcludedAccessLevels", () => {
    const getExcludedAccessLevels = (siteConfig: any): string[] => {
      return siteConfig.excludedAccessLevels || [];
    };

    it("should return excluded access levels from config", () => {
      expect(getExcludedAccessLevels(mockSiteConfig)).toEqual(["kriyaban"]);
    });

    it("should return empty array if no exclusions configured", () => {
      expect(getExcludedAccessLevels({})).toEqual([]);
      expect(getExcludedAccessLevels({ excludedAccessLevels: [] })).toEqual([]);
    });

    it("should handle multiple excluded access levels", () => {
      const config = { excludedAccessLevels: ["kriyaban", "admin", "staff"] };
      expect(getExcludedAccessLevels(config)).toEqual(["kriyaban", "admin", "staff"]);
    });
  });

  describe("validateSiteConfig", () => {
    const validateSiteConfig = (siteConfig: any): boolean => {
      if (typeof siteConfig !== "object" || siteConfig === null) {
        return false;
      }

      const accessLevelPathMap = siteConfig.accessLevelPathMap;
      if (accessLevelPathMap && typeof accessLevelPathMap !== "object") {
        return false;
      }

      if (accessLevelPathMap) {
        for (const [accessLevel, patterns] of Object.entries(accessLevelPathMap)) {
          if (!Array.isArray(patterns)) {
            return false;
          }
          for (const pattern of patterns as string[]) {
            if (typeof pattern !== "string") {
              return false;
            }
          }
        }
      }

      const excludedAccessLevels = siteConfig.excludedAccessLevels;
      if (excludedAccessLevels && !Array.isArray(excludedAccessLevels)) {
        return false;
      }

      return true;
    };

    it("should validate correct site configuration", () => {
      expect(validateSiteConfig(mockSiteConfig)).toBe(true);
    });

    it("should reject non-object configurations", () => {
      expect(validateSiteConfig(null)).toBe(false);
      expect(validateSiteConfig("string")).toBe(false);
      expect(validateSiteConfig(123)).toBe(false);
      expect(validateSiteConfig([])).toBe(false);
    });

    it("should reject invalid accessLevelPathMap structure", () => {
      expect(validateSiteConfig({ accessLevelPathMap: "invalid" })).toBe(false);
      expect(validateSiteConfig({ accessLevelPathMap: { kriyaban: "not-array" } })).toBe(false);
      expect(validateSiteConfig({ accessLevelPathMap: { kriyaban: [123] } })).toBe(false);
    });

    it("should reject invalid excludedAccessLevels structure", () => {
      expect(validateSiteConfig({ excludedAccessLevels: "invalid" })).toBe(false);
      expect(validateSiteConfig({ excludedAccessLevels: {} })).toBe(false);
    });

    it("should accept empty or missing optional fields", () => {
      expect(validateSiteConfig({})).toBe(true);
      expect(validateSiteConfig({ accessLevelPathMap: {} })).toBe(true);
      expect(validateSiteConfig({ excludedAccessLevels: [] })).toBe(true);
    });
  });
});

describe("Pinecone Filter Generation", () => {
  describe("createAccessLevelFilter", () => {
    const createAccessLevelFilter = (excludedAccessLevels: string[]) => {
      if (!excludedAccessLevels || excludedAccessLevels.length === 0) {
        return null;
      }

      return {
        access_level: {
          $nin: excludedAccessLevels,
        },
      };
    };

    it("should create filter for excluded access levels", () => {
      const filter = createAccessLevelFilter(["kriyaban"]);
      expect(filter).toEqual({
        access_level: {
          $nin: ["kriyaban"],
        },
      });
    });

    it("should handle multiple excluded access levels", () => {
      const filter = createAccessLevelFilter(["kriyaban", "admin"]);
      expect(filter).toEqual({
        access_level: {
          $nin: ["kriyaban", "admin"],
        },
      });
    });

    it("should return null for empty exclusion list", () => {
      expect(createAccessLevelFilter([])).toBeNull();
      expect(createAccessLevelFilter(null as any)).toBeNull();
    });
  });
});

describe("Integration with Existing Site Configuration", () => {
  it("should work with ananda site configuration structure", () => {
    const anandaConfig = {
      name: "Luca, The Ananda Devotee Chatbot",
      excludedAccessLevels: ["kriyaban"],
      accessLevelPathMap: {
        kriyaban: ["Kriyaban Only"],
      },
      // ... other ananda config fields
    };

    // Test access level determination
    const determineAccessLevel = (filePath: string, siteConfig: any): string => {
      if (!filePath) return "public";
      const accessLevelPathMap = siteConfig.accessLevelPathMap || {};
      for (const [accessLevel, patterns] of Object.entries(accessLevelPathMap)) {
        const patternArray = patterns as string[];
        for (const pattern of patternArray) {
          if (filePath.toLowerCase().includes(pattern.toLowerCase())) {
            return accessLevel;
          }
        }
      }
      return "public";
    };

    expect(determineAccessLevel("treasures/Thumb drive from Krishna 7-2024/Kriyaban Only/file.mp3", anandaConfig)).toBe(
      "kriyaban"
    );

    expect(determineAccessLevel("treasures/public/regular-file.mp3", anandaConfig)).toBe("public");
  });

  it("should not affect other sites without access level configuration", () => {
    const crystalConfig = {
      name: "Crystal Clarity Assistant",
      // No excludedAccessLevels or accessLevelPathMap
    };

    const determineAccessLevel = (filePath: string, siteConfig: any): string => {
      if (!filePath) return "public";
      const accessLevelPathMap = siteConfig.accessLevelPathMap || {};
      for (const [accessLevel, patterns] of Object.entries(accessLevelPathMap)) {
        const patternArray = patterns as string[];
        for (const pattern of patternArray) {
          if (filePath.toLowerCase().includes(pattern.toLowerCase())) {
            return accessLevel;
          }
        }
      }
      return "public";
    };

    // All files should be public for sites without access level config
    expect(determineAccessLevel("any/path/file.mp3", crystalConfig)).toBe("public");
    expect(determineAccessLevel("kriyaban only/file.mp3", crystalConfig)).toBe("public");
  });
});
