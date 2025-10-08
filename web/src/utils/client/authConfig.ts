// Utility functions for determining authentication requirements based on site config
import { SiteConfig } from "@/types/siteConfig";

/**
 * Returns whether a specific page is public (doesn't require authentication)
 * based on the site configuration and path.
 *
 * @param path The current path/route
 * @param siteConfig The site configuration object
 * @returns True if the page is public, false if it requires authentication
 */
export const isPublicPage = (path: string, siteConfig: SiteConfig | null): boolean => {
  // Login page is always public
  if (path === "/login") return true;
  // Magic login page must be public to avoid redirect loops when consuming sign-in links
  if (path === "/magic-login") return true;

  // Password reset pages must be public (users can't authenticate if they forgot their password)
  if (path === "/forgot-password") return true;
  if (path === "/reset-password") return true;

  // Account activation and setup pages must be public
  if (path === "/verify") return true;
  if (path === "/choose-auth-method") return true;

  // Contact page is always public
  if (path === "/contact") return true;

  // Request submitted page is always public (shown after access request)
  if (path === "/request-submitted") return true;

  // Individual answer pages (with ID) are public
  if (path.startsWith("/answers/") && path.length > 9) return true;

  // Shared conversation pages are public (/share/<docId>)
  if (path.startsWith("/share/") && path.length > 7) return true;

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
  // Authentication endpoints are always public
  if (url.includes("/api/web-token") || url.includes("/api/get-token") || url.includes("/api/login")) {
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

  // Contact form submissions are public
  if (url.includes("/api/contact")) {
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
