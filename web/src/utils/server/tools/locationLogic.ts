/**
 * Pure business logic for location resolution
 * Extracted from tools.ts to be independently testable
 */

import { LocationResult, CenterResult, NearestCenterResult } from "../tools";

// Location resolution strategy types
export type LocationStrategy = "user-provided" | "ip-geolocation" | "none";

export interface LocationResolutionInput {
  userProvidedLocation?: string;
  ipCity?: string;
  ipCountry?: string;
  ipLatitude?: string;
  ipLongitude?: string;
}

export interface LocationResolutionResult {
  strategy: LocationStrategy;
  shouldTryGeocoding: boolean;
  shouldTryIPGeolocation: boolean;
  fallbackMessage?: string;
}

/**
 * Determines the location resolution strategy based on available inputs
 * Pure function - easily testable
 */
export function determineLocationStrategy(input: LocationResolutionInput): LocationResolutionResult {
  // If user provided a location, try geocoding first
  if (input.userProvidedLocation && input.userProvidedLocation.trim().length > 0) {
    return {
      strategy: "user-provided",
      shouldTryGeocoding: true,
      shouldTryIPGeolocation: true, // Fallback if geocoding fails
    };
  }

  // If we have IP geolocation data, use it
  if (input.ipCity || input.ipLatitude) {
    return {
      strategy: "ip-geolocation",
      shouldTryGeocoding: false,
      shouldTryIPGeolocation: true,
    };
  }

  // No location data available
  return {
    strategy: "none",
    shouldTryGeocoding: false,
    shouldTryIPGeolocation: false,
    fallbackMessage:
      "Unable to determine your location. Please specify a city or location to find nearby Ananda centers.",
  };
}

/**
 * Validates a location result to ensure it has required fields
 * Pure function - easily testable
 */
export function validateLocationResult(location: LocationResult | null): location is LocationResult {
  if (!location) return false;

  return !!(
    location.city &&
    location.country &&
    typeof location.latitude === "number" &&
    typeof location.longitude === "number" &&
    !isNaN(location.latitude) &&
    !isNaN(location.longitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

/**
 * Filters and sorts centers by distance and relevance
 * Pure function - easily testable
 */
export function selectBestCenters(
  centers: CenterResult[],
  maxDistance: number = 500, // 500 miles default
  maxResults: number = 10
): CenterResult[] {
  return centers
    .filter((center) => center.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults);
}

/**
 * Creates a standardized response for location + centers
 * Pure function - easily testable
 */
export function createLocationResponse(
  location: LocationResult | null,
  centers: NearestCenterResult,
  fallbackMessage?: string
): { location: LocationResult | null; centers: NearestCenterResult } {
  if (!location) {
    return {
      location: null,
      centers: {
        found: false,
        centers: [],
        fallbackMessage:
          fallbackMessage ||
          "Unable to determine your location. Please specify a city or location to find nearby Ananda centers.",
      },
    };
  }

  return {
    location,
    centers,
  };
}

/**
 * Extracts IP geolocation data from request headers
 * Pure function - easily testable
 */
export function extractIPGeolocationData(headers: Headers): LocationResolutionInput {
  const ipCity = headers.get("x-vercel-ip-city");
  const ipCountry = headers.get("x-vercel-ip-country");
  const ipLatitude = headers.get("x-vercel-ip-latitude");
  const ipLongitude = headers.get("x-vercel-ip-longitude");

  return {
    ipCity: ipCity ? decodeURIComponent(ipCity) : undefined,
    ipCountry: ipCountry || undefined,
    ipLatitude: ipLatitude || undefined,
    ipLongitude: ipLongitude || undefined,
  };
}

/**
 * Determines if we should perform center search based on location quality
 * Pure function - easily testable
 */
export function shouldSearchCenters(location: LocationResult | null): boolean {
  if (!validateLocationResult(location)) return false;

  // Only search if we have high or medium confidence location
  return location.confidence === "high" || location.confidence === "medium";
}

/**
 * Creates performance metrics object
 * Pure function - easily testable
 */
export function createPerformanceMetrics(
  geocodingLatency: number,
  ipGeolocationLatency: number,
  centerSearchLatency: number,
  totalLatency: number
) {
  return {
    geocodingLatency: `${geocodingLatency}ms`,
    ipGeolocationLatency: `${ipGeolocationLatency}ms`,
    centerSearchLatency: `${centerSearchLatency}ms`,
    totalLatency: `${totalLatency}ms`,
  };
}
