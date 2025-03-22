/**
 * Token Manager
 *
 * This utility manages JWT tokens for secure API access:
 * - Fetches tokens from the web-token endpoint
 * - Caches tokens in memory to avoid unnecessary requests
 * - Handles token expiration and refresh
 * - Provides a standard way to include tokens in API requests
 *
 * Implementation uses in-memory storage instead of localStorage for better security.
 */

// Store token and its expiration time in memory
interface TokenData {
  token: string;
  expiresAt: number; // Timestamp when the token expires
}

// We keep the token in memory to avoid exposing it in localStorage
let tokenData: TokenData | null = null;

// Time buffer before expiration to refresh token (30 seconds)
const EXPIRATION_BUFFER = 30 * 1000;

/**
 * Parse JWT token to get expiration time
 */
function parseJwtExpiration(token: string): number {
  try {
    // Extract payload from JWT (second part between dots)
    const payload = token.split('.')[1];
    // Decode base64
    const decoded = JSON.parse(atob(payload));
    // Get expiration timestamp in milliseconds
    return decoded.exp * 1000;
  } catch (error) {
    console.error('Error parsing JWT token:', error);
    // Default to 15 minutes from now if parsing fails
    return Date.now() + 15 * 60 * 1000;
  }
}

/**
 * Check if the current token is valid and not near expiration
 */
function isTokenValid(): boolean {
  if (!tokenData) return false;

  // Consider token invalid if it's within the buffer period of expiration
  return tokenData.expiresAt > Date.now() + EXPIRATION_BUFFER;
}

/**
 * Fetch a new token from the server
 */
async function fetchNewToken(): Promise<string> {
  const response = await fetch('/api/web-token');

  if (!response.ok) {
    throw new Error('Failed to fetch token');
  }

  const data = await response.json();
  const token = data.token;

  // Store token with expiration time
  tokenData = {
    token,
    expiresAt: parseJwtExpiration(token),
  };

  return token;
}

/**
 * Get a valid token, fetching a new one if necessary
 */
export async function getToken(): Promise<string> {
  if (isTokenValid()) {
    return tokenData!.token;
  }

  return fetchNewToken();
}

/**
 * Add authorization header with Bearer token to fetch options
 *
 * @param options Optional fetch options to extend
 * @returns Fetch options with Authorization header
 */
export async function withAuth(options?: RequestInit): Promise<RequestInit> {
  const token = await getToken();

  return {
    ...options,
    headers: {
      ...(options?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

/**
 * Fetch wrapper that automatically adds authentication
 *
 * @param url The URL to fetch
 * @param options Fetch options
 * @returns Fetch response
 */
export async function fetchWithAuth(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const authOptions = await withAuth(options);
  return fetch(url, authOptions);
}
