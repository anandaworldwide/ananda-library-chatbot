import { getToken } from "./tokenManager";

interface PublicAudioUrlResponse {
  publicUrl: string;
  contentType: string;
  expiresIn: null; // null indicates no expiration
  message: string;
}

interface PublicAudioUrlError {
  message: string;
  validExtensions?: string[];
  actualType?: string;
}

/**
 * Fetches a public (non-expiring) URL for an audio file intended for copying/sharing
 * This function generates URLs that will remain valid indefinitely, perfect for
 * clipboard copying and sharing scenarios.
 *
 * @param filename - The audio filename (e.g., "meditation.mp3")
 * @param library - Optional library/collection name for path resolution
 * @returns Promise<string> - The public URL for the audio file (never expires)
 * @throws Error if the audio file cannot be accessed or is invalid
 */
export async function getPublicAudioUrl(filename: string, library?: string): Promise<string> {
  try {
    // Get JWT token for authentication
    const token = await getToken();
    if (!token) {
      throw new Error("Authentication required to access audio files");
    }

    // Prepare request payload
    const payload = {
      audioS3Key: filename,
      ...(library && { library }),
    };

    // Make API request to get public URL
    const response = await fetch("/api/getPublicAudioUrl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData: PublicAudioUrlError = await response.json();

      if (response.status === 400) {
        throw new Error(`Invalid audio file: ${errorData.message}`);
      } else if (response.status === 404) {
        throw new Error("Audio file not found");
      } else if (response.status === 403) {
        throw new Error("Access denied to audio file");
      } else if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      } else {
        throw new Error(`Failed to generate public audio URL: ${errorData.message || "Unknown error"}`);
      }
    }

    const data: PublicAudioUrlResponse = await response.json();

    // Verify we got a valid public URL
    if (!data.publicUrl || typeof data.publicUrl !== "string") {
      throw new Error("Invalid response: missing public URL");
    }

    return data.publicUrl;
  } catch (error) {
    console.error("Error generating public audio URL:", error);

    // Re-throw with more context
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Failed to generate public audio URL");
    }
  }
}

/**
 * Cached version of getPublicAudioUrl with in-memory caching
 * This prevents repeated API calls for the same audio file during a session
 */
const publicAudioUrlCache = new Map<string, string>();

export async function getCachedPublicAudioUrl(filename: string, library?: string): Promise<string> {
  const cacheKey = `${library || "default"}:${filename}`;

  // Check cache first
  if (publicAudioUrlCache.has(cacheKey)) {
    return publicAudioUrlCache.get(cacheKey)!;
  }

  // Generate new URL
  const publicUrl = await getPublicAudioUrl(filename, library);

  // Cache the result
  publicAudioUrlCache.set(cacheKey, publicUrl);

  return publicUrl;
}
