/**
 * Generic tools for OpenAI function calls
 *
 * This file contains reusable tool implementations that can be called by OpenAI's
 * function calling feature. Each tool is designed to be stateless and handle
 * specific tasks like geolocation, data lookup, etc.
 */

import { NextRequest } from "next/server";
import { s3Client } from "./awsConfig";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

// Types for tool responses
interface LocationResult {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  confidence: "high" | "medium" | "low";
  source: "vercel-header" | "vercel-header-geocoded" | "ip-api" | "user-provided";
}

interface CenterResult {
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  distance: number;
  phone?: string;
  website?: string;
}

interface NearestCenterResult {
  found: boolean;
  centers: CenterResult[];
  fallbackMessage?: string;
}

// Using existing S3 client from awsConfig.ts

/**
 * Converts S3 readable stream to string
 */
async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/**
 * Parses CSV content handling multi-line quoted fields properly
 * @param csvContent - Raw CSV content
 * @returns Array of parsed rows
 */
function parseCSVContent(csvContent: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < csvContent.length) {
    const char = csvContent[i];

    if (char === '"') {
      if (inQuotes && i + 1 < csvContent.length && csvContent[i + 1] === '"') {
        // Handle escaped quotes ("" within quoted field)
        currentField += '"';
        i += 2;
        continue;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // End of field
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      // End of row (only if not in quotes)
      if (char === "\r" && i + 1 < csvContent.length && csvContent[i + 1] === "\n") {
        i++; // Skip the \n in \r\n
      }
      currentRow.push(currentField);
      if (currentRow.length > 0 && currentRow.some((field) => field.trim())) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
    } else {
      // Regular character
      currentField += char;
    }

    i++;
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.length > 0 && currentRow.some((field) => field.trim())) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// Add new tool definition for location confirmation
export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_user_location",
      description:
        "Get user's location and find nearby Ananda centers. This tool does both location detection AND center search in one call.",
      parameters: {
        type: "object",
        properties: {
          userProvidedLocation: {
            type: "string",
            description:
              "Specific location provided by the user (e.g., 'Tokyo, Japan' or 'New York'). Only extract if user explicitly mentions a location.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "confirm_user_location",
      description: "Confirm or correct user location if initial detection seems wrong or user corrects it",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The location to confirm or correct",
          },
          confirmed: {
            type: "boolean",
            description: "Whether the user has confirmed this location is correct",
          },
        },
        required: ["location"],
      },
    },
  },
];

/**
 * Calculates the distance between two points using the Haversine formula
 * @param lat1 - Latitude of first point
 * @param lon1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lon2 - Longitude of second point
 * @returns Distance in miles
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geocodes a location string using Google Maps API
 * @param location - Location string to geocode
 * @returns Promise<LocationResult | null>
 */
async function geocodeLocation(location: string): Promise<LocationResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("Google Maps API key not configured");
    return null;
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`
    );

    const data = await response.json();

    if (data.status === "OK" && data.results.length > 0) {
      const result = data.results[0];
      const geoLocation = result.geometry.location;

      // Extract city and country from address components
      const addressComponents = result.address_components;
      const city =
        addressComponents.find((comp: any) => comp.types.includes("locality"))?.long_name ||
        addressComponents.find((comp: any) => comp.types.includes("administrative_area_level_1"))?.long_name ||
        addressComponents.find((comp: any) => comp.types.includes("sublocality"))?.long_name ||
        "";
      const country = addressComponents.find((comp: any) => comp.types.includes("country"))?.long_name || "";

      return {
        city,
        country,
        latitude: geoLocation.lat,
        longitude: geoLocation.lng,
        confidence: "high",
        source: "user-provided",
      };
    }

    // Handle various API error statuses
    if (data.status === "ZERO_RESULTS") {
      console.warn(`Geocoding found no results for location: ${location}`);
    } else if (data.status === "OVER_QUERY_LIMIT") {
      console.error("Google Maps API quota exceeded");
    } else if (data.status === "REQUEST_DENIED") {
      console.error("Google Maps API request denied - check API key");
    } else {
      console.error(`Geocoding failed with status: ${data.status}`);
    }

    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

/**
 * Gets user location from IP address
 * @param request - NextRequest object containing headers
 * @returns Promise<LocationResult | null>
 */
async function getLocationFromIP(request: NextRequest): Promise<LocationResult | null> {
  try {
    // First try Vercel's IP geolocation headers
    const city = request.headers.get("x-vercel-ip-city");
    const country = request.headers.get("x-vercel-ip-country");
    const latitude = request.headers.get("x-vercel-ip-latitude");
    const longitude = request.headers.get("x-vercel-ip-longitude");

    if (city && country && latitude && longitude) {
      return {
        city: decodeURIComponent(city),
        country: decodeURIComponent(country),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        confidence: "medium",
        source: "vercel-header",
      };
    }

    // If we have city/country but no lat/lng from Vercel, try geocoding
    if (city && country) {
      const geocodedResult = await geocodeLocation(`${decodeURIComponent(city)}, ${decodeURIComponent(country)}`);
      if (geocodedResult) {
        return {
          ...geocodedResult,
          confidence: "medium",
          source: "vercel-header-geocoded",
        };
      }
    }

    // Fallback to ip-api.com
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "127.0.0.1";

    if (ip === "127.0.0.1") {
      return null; // Can't geolocate localhost
    }

    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();

    if (data.status === "success") {
      return {
        city: data.city,
        country: data.country,
        latitude: data.lat,
        longitude: data.lon,
        confidence: "low",
        source: "ip-api",
      };
    }

    return null;
  } catch (error) {
    console.error("IP geolocation error:", error);
    return null;
  }
}

/**
 * Loads Ananda centers from S3 CSV file
 * @returns Promise<CenterResult[]>
 */
async function loadAnandaCenters(): Promise<CenterResult[]> {
  try {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
      throw new Error("S3_BUCKET_NAME environment variable not configured");
    }

    // Load from S3 with site-specific path
    const siteId = process.env.SITE_ID || "ananda";
    const s3Key = `site-config/location/${siteId}-locations.csv`;

    console.log(`Loading location data from S3: ${bucketName}/${s3Key}`);

    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      })
    );

    if (!response.Body) {
      throw new Error("Empty response body from S3");
    }

    const csvContent = await streamToString(response.Body as Readable);

    // Parse CSV with proper handling of multi-line quoted fields
    const rows = parseCSVContent(csvContent);
    console.log(`CSV has ${rows.length} rows`);

    if (rows.length < 2) {
      console.log("CSV file has insufficient data");
      return [];
    }

    // Parse the header row
    const headers = rows[0].map((h: string) => h.trim().toLowerCase());
    console.log(`CSV headers: ${headers.join(", ")}`);

    const centers: CenterResult[] = [];
    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      if (values.length >= headers.length) {
        const row: Record<string, string> = {};
        headers.forEach((header: string, index: number) => {
          row[header] = values[index]?.trim() || "";
        });

        // Map the actual CSV structure to our expected structure
        const latitude = parseFloat(row.latitude) || 0;
        const longitude = parseFloat(row.longitude) || 0;

        if (latitude !== 0 && longitude !== 0) {
          const center = {
            name: row.title || row.name || "",
            address: row.address || "",
            city: row.city || "",
            state: row["state/province"] || row.state || "",
            country: row.country || "",
            latitude,
            longitude,
            distance: 0, // Will be calculated later
            phone: row.phone || undefined,
            website: row.website || undefined,
          };
          centers.push(center);

          // Debug log specific centers mentioned by user
          if (
            center.city.toLowerCase().includes("sacramento") ||
            center.city.toLowerCase().includes("nevada city") ||
            center.name.toLowerCase().includes("sacramento") ||
            center.name.toLowerCase().includes("nevada city")
          ) {
            console.log(
              `🔍 FOUND RELEVANT CENTER: ${center.name} in ${center.city}, ${center.state} (${center.latitude}, ${center.longitude})`
            );
          }
        }
      }
    }

    console.log(`Loaded ${centers.length} centers from S3`);

    // Additional debug: Log some sample centers
    if (centers.length > 0) {
      console.log(
        `Sample centers loaded:`,
        centers.slice(0, 3).map((c) => `${c.name} (${c.city}, ${c.state})`)
      );
    }

    return centers;
  } catch (error) {
    console.error("Error loading Ananda centers from S3:", error);

    // Fallback to local file if S3 fails (for development)
    try {
      console.log("Attempting fallback to local CSV file...");
      const fs = await import("fs/promises");
      const path = await import("path");
      const csvPath = path.join(process.cwd(), "web/public/data/ananda-locations.csv");
      const csvContent = await fs.readFile(csvPath, "utf8");

      // Simple CSV parsing for fallback
      const lines = csvContent.split("\n").filter((line) => line.trim());
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

      const centers: CenterResult[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(",");
        if (values.length >= headers.length) {
          const row: Record<string, string> = {};
          headers.forEach((header, index) => {
            row[header] = values[index]?.trim() || "";
          });

          const latitude = parseFloat(row.latitude) || 0;
          const longitude = parseFloat(row.longitude) || 0;

          if (latitude !== 0 && longitude !== 0) {
            centers.push({
              name: row.name || "",
              address: row.address || "",
              city: row.city || "",
              state: row.state || "",
              country: row.country || "",
              latitude,
              longitude,
              distance: 0,
              phone: row.phone || undefined,
              website: row.website || undefined,
            });
          }
        }
      }

      console.log(`Loaded ${centers.length} centers from local fallback`);
      return centers;
    } catch (fallbackError) {
      console.error("Fallback to local file also failed:", fallbackError);
      return [];
    }
  }
}

/**
 * Helper function to find nearest centers (used internally)
 */
async function findNearestCenters(
  latitude: number,
  longitude: number,
  maxDistance: number = 150,
  maxResults: number = 5
): Promise<NearestCenterResult> {
  try {
    const centers = await loadAnandaCenters();

    // Calculate distances and filter by max distance
    const centersWithDistance = centers
      .map((center) => ({
        ...center,
        distance: haversineDistance(latitude, longitude, center.latitude, center.longitude),
      }))
      .filter((center) => center.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxResults);

    if (centersWithDistance.length > 0) {
      return {
        found: true,
        centers: centersWithDistance,
      };
    } else {
      return {
        found: false,
        centers: [],
        fallbackMessage:
          "No Ananda centers found within 150 miles of your location. You might want to check out Ananda's virtual events and online community!",
      };
    }
  } catch (error) {
    console.error("Error finding nearest centers:", error);
    return {
      found: false,
      centers: [],
      fallbackMessage:
        "Sorry, I encountered an error while searching for nearby Ananda centers. Please try again later or visit ananda.org to find center information.",
    };
  }
}

// Tool implementations
export const toolImplementations = {
  /**
   * Gets user location and finds nearby Ananda centers in one call
   */
  async get_user_location(
    args: { userProvidedLocation?: string },
    request: NextRequest
  ): Promise<{ location: LocationResult | null; centers: NearestCenterResult }> {
    let locationResult: LocationResult | null = null;

    // If user provided a location, geocode it
    if (args.userProvidedLocation) {
      const result = await geocodeLocation(args.userProvidedLocation);
      if (result) {
        locationResult = result;
      }
    }

    // Otherwise, try to get location from IP
    if (!locationResult) {
      const ipResult = await getLocationFromIP(request);
      locationResult = ipResult;
    }

    // If we have location coordinates, find nearby centers
    if (locationResult && locationResult.latitude && locationResult.longitude) {
      const centersResult = await findNearestCenters(locationResult.latitude, locationResult.longitude);

      return {
        location: locationResult,
        centers: centersResult,
      };
    }

    // If no location found, return empty result
    return {
      location: null,
      centers: {
        found: false,
        centers: [],
        fallbackMessage:
          "Unable to determine your location. Please specify a city or location to find nearby Ananda centers.",
      },
    };
  },

  /**
   * Confirms or corrects user location with geocoding support
   */
  async confirm_user_location(args: { location: string; confirmed?: boolean }): Promise<LocationResult | null> {
    console.log(`Confirming user location: ${args.location}, confirmed: ${args.confirmed}`);

    // Always try to geocode the location for accuracy
    const geocodedResult = await geocodeLocation(args.location);

    if (geocodedResult) {
      // Mark as confirmed if explicitly confirmed by user
      if (args.confirmed) {
        console.log(`User confirmed location: ${geocodedResult.city}, ${geocodedResult.country}`);
      }
      return geocodedResult;
    }

    // If geocoding fails, try to parse common location formats
    const locationParts = args.location.split(",").map((part) => part.trim());

    if (locationParts.length >= 2) {
      // Try to extract city and country/state from the input
      const city = locationParts[0];
      const country = locationParts[locationParts.length - 1];

      console.warn(`Geocoding failed for ${args.location}, using parsed values: ${city}, ${country}`);

      return {
        city,
        country,
        latitude: 0, // Will need to be handled by fallback logic
        longitude: 0,
        confidence: "low",
        source: "user-provided",
      };
    }

    console.error(`Failed to confirm location: ${args.location}`);
    return null;
  },
};

/**
 * Main function to execute a tool call
 * @param toolName - Name of the tool to execute
 * @param args - Arguments for the tool
 * @param request - NextRequest object
 * @returns Promise<any>
 */
export async function executeTool(toolName: string, args: any, request: NextRequest): Promise<any> {
  const tool = toolImplementations[toolName as keyof typeof toolImplementations];

  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Handle tools that don't need the request parameter
  if (toolName === "confirm_user_location") {
    return await (tool as any)(args);
  }

  return await (tool as any)(args, request);
}
