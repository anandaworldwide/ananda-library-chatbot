// Utility functions for determining authentication requirements based on site config
import { SiteConfig } from "@/types/siteConfig";
import { PUBLIC_PATHS } from "@/config/publicPaths";

/**
 * Returns whether a specific page is public (doesn't require authentication)
 * based on the site configuration and path.
 *
 * @param path The current path/route
 * @param siteConfig The site configuration object
 * @returns True if the page is public, false if it requires authentication
 */
export const isPublicPage = (path: string, siteConfig: SiteConfig | null): boolean => {
  // Check against centralized public paths
  const isInPublicList = PUBLIC_PATHS.alwaysPublicPages.some((publicPath) => {
    // Handle trailing slash patterns (e.g., "/answers/")
    if (publicPath.endsWith("/")) {
      return path.startsWith(publicPath) && path !== publicPath.slice(0, -1);
    }
    return path === publicPath;
  });

  if (isInPublicList) {
    return true;
  }

  // Request submitted page is always public (shown after access request)
  if (path === "/request-submitted") return true;

  // If no site config is available, default to requiring authentication
  if (!siteConfig) return false;

  // For all other pages, use the site config to determine if login is required
  return !siteConfig.requireLogin;
};

/**
 * Returns whether the API endpoint requires authentication based on
 * the site configuration, endpoint path, and HTTP method.
 *
 * @param url The API endpoint URL
 * @param method The HTTP method (GET, POST, etc.)
 * @param siteConfig The site configuration object
 * @returns True if the endpoint is public, false if it requires authentication
 */
export const isPublicEndpoint = (url: string, method: string): boolean => {
  // Check against centralized public API paths
  if (PUBLIC_PATHS.alwaysPublicApis.some((apiPath) => url.includes(apiPath))) {
    return true;
  }

  // Sudo status check is authenticated
  if (url.includes("/api/sudoCookie")) {
    return false;
  }

  // Answers GET requests are public
  if (url.includes("/api/answers") && method === "GET") {
    return true;
  }

  // Document endpoints are public
  if (url.includes("/api/document")) {
    return true;
  }

  if (url.includes("/api/getAudioSignedUrl") || url.includes("/api/getPdfSignedUrl")) {
    return true;
  }

  // By default, require authentication for all other endpoints
  return false;
};
