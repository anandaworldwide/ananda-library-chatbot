/**
 * @jest-environment node
 */

import {
  determineLocationStrategy,
  validateLocationResult,
  selectBestCenters,
  createLocationResponse,
  extractIPGeolocationData,
  shouldSearchCenters,
  createPerformanceMetrics,
} from "../../../../src/utils/server/tools/locationLogic";
import { LocationResult, CenterResult } from "../../../../src/utils/server/tools";

describe("LocationLogic - Pure Business Logic Functions", () => {
  describe("determineLocationStrategy", () => {
    it("should prioritize user-provided location when available", () => {
      const result = determineLocationStrategy({
        userProvidedLocation: "San Francisco, CA",
        ipCity: "Mountain View",
        ipCountry: "US",
      });

      expect(result.strategy).toBe("user-provided");
      expect(result.shouldTryGeocoding).toBe(true);
      expect(result.shouldTryIPGeolocation).toBe(true);
      expect(result.fallbackMessage).toBeUndefined();
    });

    it("should use IP geolocation when no user input provided", () => {
      const result = determineLocationStrategy({
        ipCity: "Mountain View",
        ipCountry: "US",
        ipLatitude: "37.7749",
        ipLongitude: "-122.4194",
      });

      expect(result.strategy).toBe("ip-geolocation");
      expect(result.shouldTryGeocoding).toBe(false);
      expect(result.shouldTryIPGeolocation).toBe(true);
    });

    it("should return none strategy when no location data available", () => {
      const result = determineLocationStrategy({});

      expect(result.strategy).toBe("none");
      expect(result.shouldTryGeocoding).toBe(false);
      expect(result.shouldTryIPGeolocation).toBe(false);
      expect(result.fallbackMessage).toContain("Unable to determine your location");
    });

    it("should handle empty user-provided location", () => {
      const result = determineLocationStrategy({
        userProvidedLocation: "   ",
        ipCity: "San Francisco",
      });

      expect(result.strategy).toBe("ip-geolocation");
      expect(result.shouldTryGeocoding).toBe(false);
      expect(result.shouldTryIPGeolocation).toBe(true);
    });
  });

  describe("validateLocationResult", () => {
    it("should validate a complete location result", () => {
      const location: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      };

      expect(validateLocationResult(location)).toBe(true);
    });

    it("should reject null location", () => {
      expect(validateLocationResult(null)).toBe(false);
    });

    it("should reject location with missing city", () => {
      const location = {
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      } as LocationResult;

      expect(validateLocationResult(location)).toBe(false);
    });

    it("should reject location with invalid coordinates", () => {
      const location: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 91, // Invalid latitude > 90
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      };

      expect(validateLocationResult(location)).toBe(false);
    });

    it("should reject location with NaN coordinates", () => {
      const location: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: NaN,
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      };

      expect(validateLocationResult(location)).toBe(false);
    });

    it("should validate location with boundary coordinates", () => {
      const location: LocationResult = {
        city: "North Pole",
        country: "Arctic",
        latitude: 90,
        longitude: 180,
        confidence: "medium",
        source: "vercel-header",
      };

      expect(validateLocationResult(location)).toBe(true);
    });
  });

  describe("selectBestCenters", () => {
    const mockCenters: CenterResult[] = [
      {
        name: "Close Center",
        address: "123 Main St",
        city: "San Francisco",
        state: "CA",
        country: "USA",
        latitude: 37.7749,
        longitude: -122.4194,
        distance: 5,
      },
      {
        name: "Medium Center",
        address: "456 Oak Ave",
        city: "Oakland",
        state: "CA",
        country: "USA",
        latitude: 37.8044,
        longitude: -122.2711,
        distance: 25,
      },
      {
        name: "Far Center",
        address: "789 Pine St",
        city: "Los Angeles",
        state: "CA",
        country: "USA",
        latitude: 34.0522,
        longitude: -118.2437,
        distance: 400,
      },
      {
        name: "Very Far Center",
        address: "101 Elm St",
        city: "New York",
        state: "NY",
        country: "USA",
        latitude: 40.7128,
        longitude: -74.006,
        distance: 2900,
      },
    ];

    it("should filter centers by max distance", () => {
      const result = selectBestCenters(mockCenters, 100);

      expect(result).toHaveLength(2); // Only centers with distance <= 100
      expect(result.every((center) => center.distance <= 100)).toBe(true);
    });

    it("should sort centers by distance", () => {
      const result = selectBestCenters(mockCenters, 500);

      expect(result).toHaveLength(3);
      expect(result[0].distance).toBe(5);
      expect(result[1].distance).toBe(25);
      expect(result[2].distance).toBe(400);
    });

    it("should limit results to maxResults", () => {
      const result = selectBestCenters(mockCenters, 500, 2);

      expect(result).toHaveLength(2);
      expect(result[0].distance).toBe(5);
      expect(result[1].distance).toBe(25);
    });

    it("should handle empty centers array", () => {
      const result = selectBestCenters([], 500);

      expect(result).toHaveLength(0);
    });

    it("should use default parameters", () => {
      const result = selectBestCenters(mockCenters);

      // Should use default maxDistance=500, maxResults=10
      expect(result).toHaveLength(3); // 3 centers within 500 miles
    });
  });

  describe("createLocationResponse", () => {
    const mockLocation: LocationResult = {
      city: "San Francisco",
      country: "United States",
      latitude: 37.7749,
      longitude: -122.4194,
      confidence: "high",
      source: "google-geolocation",
    };

    const mockCenters = {
      found: true,
      centers: [
        {
          name: "Test Center",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          country: "USA",
          latitude: 37.7749,
          longitude: -122.4194,
          distance: 5,
        },
      ],
    };

    it("should create successful response with location and centers", () => {
      const result = createLocationResponse(mockLocation, mockCenters);

      expect(result.location).toEqual(mockLocation);
      expect(result.centers).toEqual(mockCenters);
    });

    it("should create failure response with null location", () => {
      const result = createLocationResponse(null, { found: false, centers: [] });

      expect(result.location).toBeNull();
      expect(result.centers.found).toBe(false);
      expect(result.centers.centers).toHaveLength(0);
      expect(result.centers.fallbackMessage).toContain("Unable to determine your location");
    });

    it("should use custom fallback message", () => {
      const customMessage = "Custom error message";
      const result = createLocationResponse(null, { found: false, centers: [] }, customMessage);

      expect(result.centers.fallbackMessage).toBe(customMessage);
    });
  });

  describe("extractIPGeolocationData", () => {
    it("should extract complete IP geolocation data", () => {
      const headers = new Map([
        ["x-vercel-ip-city", "San%20Francisco"],
        ["x-vercel-ip-country", "US"],
        ["x-vercel-ip-latitude", "37.7749"],
        ["x-vercel-ip-longitude", "-122.4194"],
      ]);

      const result = extractIPGeolocationData(headers as any);

      expect(result.ipCity).toBe("San Francisco");
      expect(result.ipCountry).toBe("US");
      expect(result.ipLatitude).toBe("37.7749");
      expect(result.ipLongitude).toBe("-122.4194");
    });

    it("should handle missing headers gracefully", () => {
      const headers = new Map();

      const result = extractIPGeolocationData(headers as any);

      expect(result.ipCity).toBeUndefined();
      expect(result.ipCountry).toBeUndefined();
      expect(result.ipLatitude).toBeUndefined();
      expect(result.ipLongitude).toBeUndefined();
    });

    it("should decode URL-encoded city names", () => {
      const headers = new Map([["x-vercel-ip-city", "New%20York"]]);

      const result = extractIPGeolocationData(headers as any);

      expect(result.ipCity).toBe("New York");
    });
  });

  describe("shouldSearchCenters", () => {
    it("should allow search for high confidence location", () => {
      const location: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      };

      expect(shouldSearchCenters(location)).toBe(true);
    });

    it("should allow search for medium confidence location", () => {
      const location: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "medium",
        source: "vercel-header",
      };

      expect(shouldSearchCenters(location)).toBe(true);
    });

    it("should reject search for low confidence location", () => {
      const location: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "low",
        source: "vercel-header",
      };

      expect(shouldSearchCenters(location)).toBe(false);
    });

    it("should reject search for null location", () => {
      expect(shouldSearchCenters(null)).toBe(false);
    });

    it("should reject search for invalid location", () => {
      const location = {
        city: "San Francisco",
        // Missing required fields
      } as LocationResult;

      expect(shouldSearchCenters(location)).toBe(false);
    });
  });

  describe("createPerformanceMetrics", () => {
    it("should format performance metrics correctly", () => {
      const result = createPerformanceMetrics(100, 200, 300, 600);

      expect(result).toEqual({
        geocodingLatency: "100ms",
        ipGeolocationLatency: "200ms",
        centerSearchLatency: "300ms",
        totalLatency: "600ms",
      });
    });

    it("should handle zero latencies", () => {
      const result = createPerformanceMetrics(0, 0, 0, 50);

      expect(result).toEqual({
        geocodingLatency: "0ms",
        ipGeolocationLatency: "0ms",
        centerSearchLatency: "0ms",
        totalLatency: "50ms",
      });
    });
  });
});
