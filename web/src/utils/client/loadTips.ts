/**
 * Utility function to load site-specific tips content
 *
 * This function loads tips content from site-specific files in the public directory
 * following the pattern: /data/[siteId]/tips.txt
 */

import { SiteConfig } from "@/types/siteConfig";

/**
 * Loads tips content for a specific site
 * @param siteConfig - The site configuration object
 * @returns Promise that resolves to the tips content as a string, or null if not available
 */
export async function loadSiteTips(siteConfig: SiteConfig | null): Promise<string | null> {
  if (!siteConfig?.siteId) {
    return null;
  }

  try {
    const response = await fetch(`/data/${siteConfig.siteId}/tips.txt`);

    if (!response.ok) {
      // Tips file doesn't exist for this site
      return null;
    }

    const content = await response.text();
    return content.trim();
  } catch (error) {
    console.error(`Failed to load tips for site ${siteConfig.siteId}:`, error);
    return null;
  }
}

/**
 * Checks if tips are available for a specific site
 * @param siteConfig - The site configuration object
 * @returns Promise that resolves to true if tips are available, false otherwise
 */
export async function areTipsAvailable(siteConfig: SiteConfig | null): Promise<boolean> {
  if (!siteConfig?.siteId) {
    return false;
  }

  try {
    const response = await fetch(`/data/${siteConfig.siteId}/tips.txt`, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    return false;
  }
}
