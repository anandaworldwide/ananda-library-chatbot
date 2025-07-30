import { getToken } from "./tokenManager";

interface AudioUrlResponse {
  signedUrl: string;
  contentType: string;
  expiresIn: number;
}

interface AudioUrlError {
  message: string;
  validExtensions?: string[];
  actualType?: string;
}

/**
 * Securely fetches a signed URL for an audio file through the API
 * This replaces the direct S3 URL construction with proper server-side validation
 *
 * @param filename - The audio filename (e.g., "meditation.mp3")
 * @param library - Optional library/collection name for path resolution
 * @returns Promise<string> - The secure signed URL for the audio file
 * @throws Error if the audio file cannot be accessed or is invalid
 */
export async function getSecureAudioUrl(filename: string, library?: string): Promise<string> {
  try {
    // Get JWT token for authentication
    const token = await getToken();

    if (!token) {
      throw new Error("Authentication required for audio access");
    }

    // Make request to secure audio endpoint
    const response = await fetch("/api/getAudioSignedUrl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        audioS3Key: filename,
        library: library,
      }),
    });

    if (!response.ok) {
      // Handle different error types
      const errorData: AudioUrlError = await response.json();

      switch (response.status) {
        case 400:
          throw new Error(`Invalid audio file: ${errorData.message}`);
        case 401:
          throw new Error("Authentication required for audio access");
        case 403:
          throw new Error("Access denied to audio file");
        case 404:
          throw new Error("Audio file not found");
        case 429:
          throw new Error("Too many requests - please wait before trying again");
        default:
          throw new Error(`Failed to access audio file: ${errorData.message}`);
      }
    }

    const data: AudioUrlResponse = await response.json();
    return data.signedUrl;
  } catch (error) {
    console.error("Error fetching secure audio URL:", error);

    // Re-throw with more context
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Failed to access audio file");
    }
  }
}

/**
 * Cache for storing audio URLs to avoid repeated API calls
 * URLs are cached with expiration time to respect signed URL validity
 */
interface CachedAudioUrl {
  url: string;
  expiresAt: number;
}

const audioUrlCache = new Map<string, CachedAudioUrl>();

/**
 * Gets a secure audio URL with caching to improve performance
 *
 * @param filename - The audio filename
 * @param library - Optional library name
 * @returns Promise<string> - The secure signed URL
 */
export async function getCachedSecureAudioUrl(filename: string, library?: string): Promise<string> {
  const cacheKey = `${library || "default"}:${filename}`;
  const cached = audioUrlCache.get(cacheKey);

  // Check if we have a valid cached URL (with 30 minute buffer before expiration)
  if (cached && cached.expiresAt > Date.now() + 30 * 60 * 1000) {
    return cached.url;
  }

  // Fetch new URL and cache it
  const url = await getSecureAudioUrl(filename, library);

  // Cache for 3.5 hours (30 minutes before the 4-hour expiration)
  audioUrlCache.set(cacheKey, {
    url,
    expiresAt: Date.now() + 3.5 * 60 * 60 * 1000,
  });

  return url;
}

/**
 * Clears the audio URL cache (useful for logout or cache invalidation)
 */
export function clearAudioUrlCache(): void {
  audioUrlCache.clear();
}
