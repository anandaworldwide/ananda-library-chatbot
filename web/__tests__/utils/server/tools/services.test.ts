/**
 * @jest-environment node
 */

import {
  HaversineDistanceCalculator,
  ConsoleLogger,
  LocationService,
} from "../../../../src/utils/server/tools/services";
import { IGeocodingService, IIPGeolocationService, ILogger } from "../../../../src/utils/server/tools/interfaces";
import { LocationResult } from "../../../../src/utils/server/tools";

// Mock the external dependencies
jest.mock("../../../../src/utils/server/awsConfig", () => ({
  s3Client: {
    send: jest.fn(),
  },
}));

describe("Services - Dependency Injection Architecture", () => {
  describe("HaversineDistanceCalculator", () => {
    let calculator: HaversineDistanceCalculator;

    beforeEach(() => {
      calculator = new HaversineDistanceCalculator();
    });

    it("should calculate distance between NYC and LA correctly", () => {
      // NYC coordinates
      const nycLat = 40.7128;
      const nycLon = -74.006;

      // LA coordinates
      const laLat = 34.0522;
      const laLon = -118.2437;

      const distance = calculator.calculateDistance(nycLat, nycLon, laLat, laLon);

      // Distance should be approximately 2445 miles
      expect(distance).toBeGreaterThan(2400);
      expect(distance).toBeLessThan(2500);
    });

    it("should return zero distance for same coordinates", () => {
      const lat = 37.7749;
      const lon = -122.4194;

      const distance = calculator.calculateDistance(lat, lon, lat, lon);

      expect(distance).toBe(0);
    });

    it("should handle negative coordinates correctly", () => {
      // Test with coordinates in different hemispheres
      const distance = calculator.calculateDistance(
        -33.8688,
        151.2093, // Sydney
        51.5074,
        -0.1278 // London
      );

      // Distance should be approximately 10,500 miles
      expect(distance).toBeGreaterThan(10000);
      expect(distance).toBeLessThan(11000);
    });
  });

  describe("ConsoleLogger", () => {
    let logger: ConsoleLogger;
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      logger = new ConsoleLogger();
      consoleSpy = jest.spyOn(console, "log").mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("should log tool start with correct format", () => {
      const toolName = "get_user_location";
      const args = { userProvidedLocation: "San Francisco" };
      const requestHeaders = { "x-vercel-ip-city": "Mountain%20View" };

      logger.logToolStart(toolName, args, requestHeaders);

      expect(consoleSpy).toHaveBeenCalledWith(
        "🔧 TOOL EXECUTION START:",
        expect.objectContaining({
          toolName,
          args,
          timestamp: expect.any(String),
          requestHeaders,
        })
      );
    });

    it("should log successful geocoding result", () => {
      const input = "San Francisco, CA";
      const result: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      };
      const latency = 150;

      logger.logGeocodingResult(true, input, result, latency);

      expect(consoleSpy).toHaveBeenCalledWith(
        "✅ GEOCODING SUCCESS:",
        expect.objectContaining({
          input,
          result: "San Francisco, United States",
          coordinates: "37.7749, -122.4194",
          latency: "150ms",
        })
      );
    });

    it("should log failed geocoding result", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      const input = "Invalid Location XYZ";
      const latency = 200;

      logger.logGeocodingResult(false, input, undefined, latency);

      expect(warnSpy).toHaveBeenCalledWith(
        "❌ GEOCODING FAILED:",
        expect.objectContaining({
          input,
          latency: "200ms",
        })
      );

      warnSpy.mockRestore();
    });
  });

  describe("LocationService - Dependency Injection", () => {
    let locationService: LocationService;
    let mockGeocodingService: jest.Mocked<IGeocodingService>;
    let mockIPGeolocationService: jest.Mocked<IIPGeolocationService>;
    let mockLogger: jest.Mocked<ILogger>;

    beforeEach(() => {
      // Create mock services
      mockGeocodingService = {
        geocode: jest.fn(),
      };

      mockIPGeolocationService = {
        getLocationFromIP: jest.fn(),
      };

      mockLogger = {
        logToolStart: jest.fn(),
        logGeocodingResult: jest.fn(),
        logIPGeolocationResult: jest.fn(),
        logToolComplete: jest.fn(),
      };

      // Inject dependencies
      locationService = new LocationService(mockGeocodingService, mockIPGeolocationService, mockLogger);
    });

    it("should use geocoding service for user-provided location", async () => {
      const userLocation = "San Francisco, CA";
      const mockResult: LocationResult = {
        city: "San Francisco",
        country: "United States",
        latitude: 37.7749,
        longitude: -122.4194,
        confidence: "high",
        source: "google-geolocation",
      };

      mockGeocodingService.geocode.mockResolvedValue(mockResult);

      const headers = new Map();
      const result = await locationService.resolveLocation(userLocation, headers as any);

      expect(mockGeocodingService.geocode).toHaveBeenCalledWith(userLocation);
      expect(mockLogger.logGeocodingResult).toHaveBeenCalledWith(true, userLocation, mockResult, expect.any(Number));
      expect(result).toEqual(mockResult);
    });

    it("should fallback to IP geolocation when geocoding fails", async () => {
      const userLocation = "Invalid Location";
      const mockIPResult: LocationResult = {
        city: "Mountain View",
        country: "United States",
        latitude: 37.3861,
        longitude: -122.0839,
        confidence: "medium",
        source: "vercel-header",
      };

      mockGeocodingService.geocode.mockResolvedValue(null);
      mockIPGeolocationService.getLocationFromIP.mockResolvedValue(mockIPResult);

      const headers = new Map();
      const result = await locationService.resolveLocation(userLocation, headers as any);

      expect(mockGeocodingService.geocode).toHaveBeenCalledWith(userLocation);
      expect(mockIPGeolocationService.getLocationFromIP).toHaveBeenCalledWith(headers);
      expect(mockLogger.logGeocodingResult).toHaveBeenCalledWith(false, userLocation, undefined, expect.any(Number));
      expect(mockLogger.logIPGeolocationResult).toHaveBeenCalledWith(true, mockIPResult, expect.any(Number));
      expect(result).toEqual(mockIPResult);
    });

    it("should use IP geolocation when no user location provided", async () => {
      const mockIPResult: LocationResult = {
        city: "Seattle",
        country: "United States",
        latitude: 47.6062,
        longitude: -122.3321,
        confidence: "medium",
        source: "vercel-header-geocoded",
      };

      mockIPGeolocationService.getLocationFromIP.mockResolvedValue(mockIPResult);

      const headers = new Map();
      const result = await locationService.resolveLocation(undefined, headers as any);

      expect(mockGeocodingService.geocode).not.toHaveBeenCalled();
      expect(mockIPGeolocationService.getLocationFromIP).toHaveBeenCalledWith(headers);
      expect(result).toEqual(mockIPResult);
    });

    it("should return null when both geocoding and IP geolocation fail", async () => {
      const userLocation = "Invalid Location";

      mockGeocodingService.geocode.mockResolvedValue(null);
      mockIPGeolocationService.getLocationFromIP.mockResolvedValue(null);

      const headers = new Map();
      const result = await locationService.resolveLocation(userLocation, headers as any);

      expect(result).toBeNull();
      expect(mockLogger.logGeocodingResult).toHaveBeenCalledWith(false, userLocation, undefined, expect.any(Number));
      expect(mockLogger.logIPGeolocationResult).toHaveBeenCalledWith(false, undefined, expect.any(Number));
    });

    it("should handle empty user location string", async () => {
      const mockIPResult: LocationResult = {
        city: "Portland",
        country: "United States",
        latitude: 45.5152,
        longitude: -122.6784,
        confidence: "medium",
        source: "vercel-header",
      };

      mockIPGeolocationService.getLocationFromIP.mockResolvedValue(mockIPResult);

      const headers = new Map();
      const result = await locationService.resolveLocation("   ", headers as any);

      // Should skip geocoding for empty/whitespace string
      expect(mockGeocodingService.geocode).not.toHaveBeenCalled();
      expect(mockIPGeolocationService.getLocationFromIP).toHaveBeenCalledWith(headers);
      expect(result).toEqual(mockIPResult);
    });
  });

  describe("Service Integration - Testability Benefits", () => {
    it("should demonstrate easy mocking of external dependencies", () => {
      // This test demonstrates how the new architecture makes testing much easier
      const mockGeocodingService: IGeocodingService = {
        geocode: jest.fn().mockResolvedValue({
          city: "Test City",
          country: "Test Country",
          latitude: 0,
          longitude: 0,
          confidence: "high",
          source: "google-geolocation",
        }),
      };

      const mockLogger: ILogger = {
        logToolStart: jest.fn(),
        logGeocodingResult: jest.fn(),
        logIPGeolocationResult: jest.fn(),
        logToolComplete: jest.fn(),
      };

      // Easy to inject mocks and test business logic in isolation
      const service = new LocationService(
        mockGeocodingService,
        {} as IIPGeolocationService, // Not needed for this test
        mockLogger
      );

      expect(service).toBeInstanceOf(LocationService);
      expect(mockGeocodingService.geocode).toBeDefined();
      expect(mockLogger.logToolStart).toBeDefined();
    });

    it("should show how pure functions have 100% testable logic", () => {
      const calculator = new HaversineDistanceCalculator();

      // Pure function - completely predictable and testable
      const distance1 = calculator.calculateDistance(0, 0, 0, 1);
      const distance2 = calculator.calculateDistance(0, 0, 0, 1);

      // Always returns the same result for the same inputs
      expect(distance1).toBe(distance2);
      expect(typeof distance1).toBe("number");
      expect(distance1).toBeGreaterThan(0);
    });
  });
});
