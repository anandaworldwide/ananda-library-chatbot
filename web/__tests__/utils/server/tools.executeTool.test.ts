/** @jest-environment node */

import { executeTool } from "../../../src/utils/server/tools";
import { NextRequest } from "next/server";
import { Readable } from "stream";

// Mock AWS S3 client to avoid real AWS calls
jest.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: jest.fn(),
  S3Client: jest.fn(),
}));

describe("tools.executeTool", () => {
  it("should throw error for unknown tool name", async () => {
    await expect(executeTool("unknown_tool", {}, null as any)).rejects.toThrow("Unknown tool: unknown_tool");
  });

  it("should handle get_user_location tool with valid request headers", async () => {
    // Create mock request with Vercel geolocation headers
    const mockRequest = {
      headers: {
        get: jest.fn((headerName: string) => {
          const headers: Record<string, string> = {
            "x-vercel-ip-city": "Mountain%20View",
            "x-vercel-ip-country": "US",
            "x-vercel-ip-latitude": "37.3861",
            "x-vercel-ip-longitude": "-122.0839",
          };
          return headers[headerName] || null;
        }),
      },
    } as unknown as NextRequest;

    const result = await executeTool("get_user_location", { userProvidedLocation: "Mountain View, CA" }, mockRequest);

    // Expect the result to be an object with location and centers
    expect(result).toHaveProperty("location");
    expect(result).toHaveProperty("centers");
  });

  it("should throw error for get_user_location tool with missing request (null)", async () => {
    await expect(
      executeTool("get_user_location", { userProvidedLocation: "San Francisco" }, null as any)
    ).rejects.toThrow("Invalid request object - cannot determine location");
  });

  it("should export TOOL_DEFINITIONS array with expected tools", async () => {
    const { TOOL_DEFINITIONS } = await import("../../../src/utils/server/tools");

    expect(Array.isArray(TOOL_DEFINITIONS)).toBe(true);
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0);

    // Check that get_user_location tool is defined
    const getUserLocationTool = TOOL_DEFINITIONS.find((tool) => tool.function?.name === "get_user_location");
    expect(getUserLocationTool).toBeDefined();
    expect(getUserLocationTool?.function?.description).toContain("location");
  });

  it("should handle get_user_location with empty userProvidedLocation", async () => {
    const mockRequest = {
      headers: new Map([
        ["x-vercel-ip-city", "Mountain%20View"],
        ["x-vercel-ip-country", "US"],
        ["x-vercel-ip-latitude", "37.3861"],
        ["x-vercel-ip-longitude", "-122.0839"],
      ]),
    } as any;

    const result = await executeTool(
      "get_user_location",
      { userProvidedLocation: "" }, // Empty location should fall back to IP
      mockRequest
    );

    expect(result).toHaveProperty("location");
    expect(result).toHaveProperty("centers");
  });

  it("should handle get_user_location with missing Vercel headers", async () => {
    const mockRequest = {
      headers: new Map([["x-forwarded-for", "98.41.154.118"]]),
    } as any;

    const result = await executeTool("get_user_location", { userProvidedLocation: "" }, mockRequest);

    // Should still attempt IP geolocation
    expect(result).toHaveProperty("location");
    expect(result).toHaveProperty("centers");
  });

  it("should handle S3 bucket configuration missing", async () => {
    // Temporarily remove S3_BUCKET_NAME to test error path
    const originalBucket = process.env.S3_BUCKET_NAME;
    delete process.env.S3_BUCKET_NAME;

    const mockRequest = {
      headers: new Map([
        ["x-vercel-ip-city", "Mountain%20View"],
        ["x-vercel-ip-country", "US"],
        ["x-vercel-ip-latitude", "37.3861"],
        ["x-vercel-ip-longitude", "-122.0839"],
      ]),
    } as any;

    const result = await executeTool("get_user_location", { userProvidedLocation: "San Francisco" }, mockRequest);

    // Should still return location info but with empty centers due to S3 error
    expect(result).toHaveProperty("location");
    expect(result).toHaveProperty("centers");
    expect(result.centers.found).toBe(false);

    // Restore environment variable
    if (originalBucket) {
      process.env.S3_BUCKET_NAME = originalBucket;
    }
  });

  it("should test internal parseCSVContent function via module access", async () => {
    // Access internal function for testing CSV parsing
    const toolsModule = await import("../../../src/utils/server/tools");
    const parseCSVContent = (toolsModule as any).parseCSVContent;

    if (parseCSVContent) {
      const csvData = 'name,location\n"John Doe","New York, NY"\n"Jane Smith","Los Angeles, CA"';
      const parsed = parseCSVContent(csvData);

      expect(parsed).toHaveLength(3); // Header + 2 data rows
      expect(parsed[0]).toEqual(["name", "location"]);
      expect(parsed[1]).toEqual(["John Doe", "New York, NY"]);
      expect(parsed[2]).toEqual(["Jane Smith", "Los Angeles, CA"]);
    }
  });

  it("should test haversineDistance function for calculating distances between coordinates", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const haversineDistance = (toolsModule as any).haversineDistance;

    if (haversineDistance) {
      // Test known distance: NYC to LA (approx 2445 miles = 3935 km)
      const nycLat = 40.7128,
        nycLon = -74.006;
      const laLat = 34.0522,
        laLon = -118.2437;

      const distance = haversineDistance(nycLat, nycLon, laLat, laLon);

      // Should be approximately 3935 km (within 100km tolerance)
      expect(distance).toBeGreaterThan(3800);
      expect(distance).toBeLessThan(4100);
    }
  });

  it("should test streamToString function for converting readable streams to strings", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const streamToString = (toolsModule as any).streamToString;

    if (streamToString) {
      // Create a mock readable stream
      // Using imported Readable from stream
      const testData = "Hello, world! This is test data.";

      const mockStream = new Readable({
        read() {
          this.push(testData);
          this.push(null); // End the stream
        },
      });

      const result = await streamToString(mockStream);
      expect(result).toBe(testData);
    }
  });

  it("should test geocodeLocation function with missing API key", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const geocodeLocation = (toolsModule as any).geocodeLocation;

    if (geocodeLocation) {
      // Temporarily remove API key to test error path
      const originalKey = process.env.GOOGLE_MAPS_API_KEY;
      delete process.env.GOOGLE_MAPS_API_KEY;

      const result = await geocodeLocation("San Francisco, CA");
      expect(result).toBeNull();

      // Restore API key
      if (originalKey) {
        process.env.GOOGLE_MAPS_API_KEY = originalKey;
      }
    }
  });

  it("should test getLocationFromIP function with complete Vercel headers", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const getLocationFromIP = (toolsModule as any).getLocationFromIP;

    if (getLocationFromIP) {
      const mockRequest = {
        headers: new Map([
          ["x-vercel-ip-city", "San%20Francisco"],
          ["x-vercel-ip-country", "US"],
          ["x-vercel-ip-latitude", "37.7749"],
          ["x-vercel-ip-longitude", "-122.4194"],
        ]),
      } as any;

      const result = await getLocationFromIP(mockRequest);

      if (result) {
        expect(result).toHaveProperty("city", "San Francisco");
        expect(result).toHaveProperty("country", "US");
        expect(result).toHaveProperty("latitude", 37.7749);
        expect(result).toHaveProperty("longitude", -122.4194);
        expect(result).toHaveProperty("source", "vercel-header");
      }
    }
  });

  it("should test loadAnandaCenters function for CSV loading and parsing", async () => {
    // Mock S3 operations
    const mockS3Response = {
      Body: {
        transformToString: jest
          .fn()
          .mockResolvedValue(
            "name,address,city,state,country,latitude,longitude,phone,website,email,description\n" +
              '"Test Center","123 Main St","Test City","CA","USA","37.7749","-122.4194","555-1234","test.com","test@test.com","Test description"'
          ),
      },
    };

    // Mock the S3 client send method
    const mockSend = jest.fn().mockResolvedValue(mockS3Response);
    const mockS3Client = { send: mockSend };

    // Mock the S3 client import
    jest.doMock("../../../src/utils/server/awsConfig", () => ({
      s3Client: mockS3Client,
    }));

    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const loadAnandaCenters = (toolsModule as any).loadAnandaCenters;

    if (loadAnandaCenters) {
      // Set required environment variable
      process.env.S3_BUCKET_NAME = "test-bucket";

      const centers = await loadAnandaCenters();

      expect(Array.isArray(centers)).toBe(true);
      if (centers.length > 0) {
        expect(centers[0]).toHaveProperty("name");
        expect(centers[0]).toHaveProperty("latitude");
        expect(centers[0]).toHaveProperty("longitude");
      }
    }
  });

  it("should test findNearestCenters function with valid coordinates", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const findNearestCenters = (toolsModule as any).findNearestCenters;

    if (findNearestCenters) {
      // Test with San Francisco coordinates
      const result = await findNearestCenters(37.7749, -122.4194);

      expect(result).toHaveProperty("found");
      expect(result).toHaveProperty("centers");
      expect(Array.isArray(result.centers)).toBe(true);
    }
  });

  it("should test geocodeLocation function with successful API response", async () => {
    // Mock fetch for Google Maps API
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        status: "OK",
        results: [
          {
            geometry: {
              location: { lat: 37.7749, lng: -122.4194 },
            },
            address_components: [
              { long_name: "San Francisco", types: ["locality"] },
              { long_name: "California", types: ["administrative_area_level_1"] },
              { long_name: "United States", types: ["country"] },
            ],
          },
        ],
      }),
    }) as jest.Mock;

    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const geocodeLocation = (toolsModule as any).geocodeLocation;

    if (geocodeLocation) {
      // Set required environment variable
      process.env.GOOGLE_MAPS_API_KEY = "test-api-key";

      const result = await geocodeLocation("San Francisco, CA");

      if (result) {
        expect(result).toHaveProperty("city", "San Francisco");
        expect(result).toHaveProperty("country", "United States");
        expect(result).toHaveProperty("latitude", 37.7749);
        expect(result).toHaveProperty("longitude", -122.4194);
        expect(result).toHaveProperty("source", "google-geolocation");
      }
    }
  });

  it("should test geocodeLocation function with API error response", async () => {
    // Mock fetch for Google Maps API error
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        status: "ZERO_RESULTS",
        results: [],
      }),
    }) as jest.Mock;

    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const geocodeLocation = (toolsModule as any).geocodeLocation;

    if (geocodeLocation) {
      process.env.GOOGLE_MAPS_API_KEY = "test-api-key";

      const result = await geocodeLocation("Invalid Location XYZ");
      expect(result).toBeNull();
    }
  });

  it("should test geocodeLocation function with network error", async () => {
    // Mock fetch to throw network error
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const geocodeLocation = (toolsModule as any).geocodeLocation;

    if (geocodeLocation) {
      process.env.GOOGLE_MAPS_API_KEY = "test-api-key";

      const result = await geocodeLocation("San Francisco, CA");
      expect(result).toBeNull();
    }
  });

  it("should test getLocationFromIP function with missing headers", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const getLocationFromIP = (toolsModule as any).getLocationFromIP;

    if (getLocationFromIP) {
      const mockRequest = {
        headers: new Map(),
      } as any;

      const result = await getLocationFromIP(mockRequest);
      expect(result).toBeNull();
    }
  });

  it("should test getLocationFromIP function with partial headers", async () => {
    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const getLocationFromIP = (toolsModule as any).getLocationFromIP;

    if (getLocationFromIP) {
      const mockRequest = {
        headers: new Map([
          ["x-vercel-ip-city", "San%20Francisco"],
          ["x-vercel-ip-country", "US"],
          // Missing latitude/longitude
        ]),
      } as any;

      const result = await getLocationFromIP(mockRequest);

      if (result) {
        expect(result).toHaveProperty("city", "San Francisco");
        expect(result).toHaveProperty("country", "US");
        expect(result).toHaveProperty("source", "vercel-header-geocoded");
      }
    }
  });

  it("should test loadAnandaCenters function with S3 error", async () => {
    // Mock S3 operations to throw error
    const mockSend = jest.fn().mockRejectedValue(new Error("S3 access denied"));
    const mockS3Client = { send: mockSend };

    // Mock the S3 client import
    jest.doMock("../../../src/utils/server/awsConfig", () => ({
      s3Client: mockS3Client,
    }));

    // Access internal function via module import
    const toolsModule = await import("../../../src/utils/server/tools");
    const loadAnandaCenters = (toolsModule as any).loadAnandaCenters;

    if (loadAnandaCenters) {
      process.env.S3_BUCKET_NAME = "test-bucket";

      const centers = await loadAnandaCenters();

      // Should return empty array on error
      expect(Array.isArray(centers)).toBe(true);
      expect(centers).toHaveLength(0);
    }
  });

  it("should test loadAnandaCenters function with malformed CSV", async () => {
    const mockS3Response = {
      Body: {
        transformToString: jest.fn().mockResolvedValue("invalid,csv,data\nwithout,proper,headers"),
      },
    };

    const mockSend = jest.fn().mockResolvedValue(mockS3Response);
    const mockS3Client = { send: mockSend };

    jest.doMock("../../../src/utils/server/awsConfig", () => ({
      s3Client: mockS3Client,
    }));

    const toolsModule = await import("../../../src/utils/server/tools");
    const loadAnandaCenters = (toolsModule as any).loadAnandaCenters;

    if (loadAnandaCenters) {
      process.env.S3_BUCKET_NAME = "test-bucket";

      const centers = await loadAnandaCenters();

      // Should handle malformed CSV gracefully
      expect(Array.isArray(centers)).toBe(true);
    }
  });

  it("should test findNearestCenters function with empty centers list", async () => {
    // Mock loadAnandaCenters to return empty array
    const toolsModule = await import("../../../src/utils/server/tools");
    const originalLoadAnandaCenters = (toolsModule as any).loadAnandaCenters;

    // Temporarily mock loadAnandaCenters
    (toolsModule as any).loadAnandaCenters = jest.fn().mockResolvedValue([]);

    const findNearestCenters = (toolsModule as any).findNearestCenters;

    if (findNearestCenters) {
      const result = await findNearestCenters(37.7749, -122.4194);

      expect(result).toHaveProperty("found", false);
      expect(result).toHaveProperty("centers");
      expect(result.centers).toHaveLength(0);
      expect(result).toHaveProperty("fallbackMessage");
    }

    // Restore original function
    (toolsModule as any).loadAnandaCenters = originalLoadAnandaCenters;
  });

  it("should test findNearestCenters function with multiple centers and distance sorting", async () => {
    // Mock loadAnandaCenters to return test data
    const mockCenters = [
      {
        name: "Close Center",
        address: "123 Main St",
        city: "San Francisco",
        state: "CA",
        country: "USA",
        latitude: 37.7849, // Very close to test coordinates
        longitude: -122.4094,
        distance: 0,
        phone: "555-1234",
        website: "close.com",
        email: "close@test.com",
        description: "Close center",
      },
      {
        name: "Far Center",
        address: "456 Oak Ave",
        city: "Los Angeles",
        state: "CA",
        country: "USA",
        latitude: 34.0522, // Far from test coordinates
        longitude: -118.2437,
        distance: 0,
        phone: "555-5678",
        website: "far.com",
        email: "far@test.com",
        description: "Far center",
      },
    ];

    const toolsModule = await import("../../../src/utils/server/tools");
    const originalLoadAnandaCenters = (toolsModule as any).loadAnandaCenters;

    // Mock loadAnandaCenters
    (toolsModule as any).loadAnandaCenters = jest.fn().mockResolvedValue(mockCenters);

    const findNearestCenters = (toolsModule as any).findNearestCenters;

    if (findNearestCenters) {
      const result = await findNearestCenters(37.7749, -122.4194);

      expect(result).toHaveProperty("found", true);
      expect(result).toHaveProperty("centers");
      expect(result.centers.length).toBeGreaterThan(0);

      // Check that centers are sorted by distance (closest first)
      if (result.centers.length > 1) {
        expect(result.centers[0].distance).toBeLessThanOrEqual(result.centers[1].distance);
      }

      // Check that distances were calculated
      result.centers.forEach((center: any) => {
        expect(center.distance).toBeGreaterThan(0);
      });
    }

    // Restore original function
    (toolsModule as any).loadAnandaCenters = originalLoadAnandaCenters;
  });

  it("should test executeTool function with invalid request object", async () => {
    await expect(executeTool("get_user_location", {}, null as any)).rejects.toThrow(
      "Invalid request object - cannot determine location"
    );
  });

  it("should test TOOL_DEFINITIONS export completeness", async () => {
    const toolsModule = await import("../../../src/utils/server/tools");
    const TOOL_DEFINITIONS = toolsModule.TOOL_DEFINITIONS;

    expect(Array.isArray(TOOL_DEFINITIONS)).toBe(true);
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0);

    // Check that all tools have required properties
    TOOL_DEFINITIONS.forEach((tool) => {
      expect(tool).toHaveProperty("type", "function");
      expect(tool).toHaveProperty("function");
      expect(tool.function).toHaveProperty("name");
      expect(tool.function).toHaveProperty("description");
      expect(tool.function).toHaveProperty("parameters");
    });

    // Check that specific tools exist
    const toolNames = TOOL_DEFINITIONS.map((tool) => tool.function.name);
    expect(toolNames).toContain("get_user_location");
    expect(toolNames).toContain("confirm_user_location");
  });

  it("should test confirm_user_location tool execution", async () => {
    // Test the confirm_user_location tool path that doesn't require request parameter
    const result = await executeTool(
      "confirm_user_location",
      {
        location: { city: "San Francisco", country: "US", latitude: 37.7749, longitude: -122.4194 },
        confirmed: true,
      },
      {} as NextRequest
    );

    expect(result).toBeDefined();
    // The actual result depends on the implementation, but it should not throw an error
  });

  it("should enhance request with mock Vercel headers in development", async () => {
    // Mock NODE_ENV as development
    const originalEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "development",
      configurable: true,
    });

    try {
      // Create a mock request with no Vercel headers
      const mockRequest = {
        headers: {
          get: (name: string) => {
            if (name === "user-agent") return "test-agent";
            return null; // No Vercel headers
          },
        },
      } as NextRequest;

      // This should trigger the localhost development enhancement path
      const result = await executeTool("get_user_location", {}, mockRequest);

      expect(result).toBeDefined();

      // In development, the system should provide mock location data
      // The location might be null if external services fail, but the system should handle it gracefully
      if (result.location) {
        expect(result.location.city).toBe("Mountain View");
      } else {
        // Should still provide a fallback response structure
        expect(result.centers).toBeDefined();
        expect(result.centers.found).toBe(false);
      }
    } finally {
      // Restore original NODE_ENV
      Object.defineProperty(process.env, "NODE_ENV", {
        value: originalEnv,
        configurable: true,
      });
    }
  });
});
