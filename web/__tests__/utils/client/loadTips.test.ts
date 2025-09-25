/**
 * Tests for loadTips utility functions
 */

import { loadSiteTips, areTipsAvailable } from "@/utils/client/loadTips";
import { SiteConfig } from "@/types/siteConfig";

// Mock fetch globally
global.fetch = jest.fn();

describe("loadTips", () => {
  const mockSiteConfig: SiteConfig = {
    siteId: "ananda",
    shortname: "Luca",
    name: "Luca, The Ananda Devotee Chatbot",
    tagline: "Test tagline",
    greeting: "Test greeting",
    parent_site_url: "https://example.com",
    parent_site_name: "Example",
    help_url: "",
    help_text: "",
    collectionConfig: {},
    libraryMappings: {},
    enableSuggestedQueries: true,
    enableMediaTypeSelection: true,
    enableAuthorSelection: true,
    welcome_popup_heading: "Welcome",
    other_visitors_reference: "visitors",
    loginImage: null,
    header: { logo: "logo.png", navItems: [] },
    footer: { links: [] },
    requireLogin: true,
    allowTemporarySessions: true,
    allowAllAnswersPage: true,
    npsSurveyFrequencyDays: 90,
    queriesPerUserPerDay: 200,
    showSourceContent: true,
    showVoting: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadSiteTips", () => {
    it("should load tips content successfully", async () => {
      const mockTipsContent = "Getting Better Answers\n\nTurn off audio sources for clearer answers.";

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockTipsContent),
      });

      const result = await loadSiteTips(mockSiteConfig);

      expect(fetch).toHaveBeenCalledWith("/data/ananda/tips.txt");
      expect(result).toBe(mockTipsContent);
    });

    it("should return null when tips file doesn't exist", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await loadSiteTips(mockSiteConfig);

      expect(fetch).toHaveBeenCalledWith("/data/ananda/tips.txt");
      expect(result).toBeNull();
    });

    it("should return null when siteConfig is null", async () => {
      const result = await loadSiteTips(null);

      expect(fetch).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("should return null when siteId is missing", async () => {
      const configWithoutSiteId = { ...mockSiteConfig, siteId: "" };
      const result = await loadSiteTips(configWithoutSiteId);

      expect(fetch).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("should handle fetch errors gracefully", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      (fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      const result = await loadSiteTips(mockSiteConfig);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to load tips for site ananda:", expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it("should trim whitespace from tips content", async () => {
      const mockTipsContent = "  \n  Tips content with whitespace  \n  ";

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockTipsContent),
      });

      const result = await loadSiteTips(mockSiteConfig);

      expect(result).toBe("Tips content with whitespace");
    });
  });

  describe("areTipsAvailable", () => {
    it("should return true when tips file exists", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
      });

      const result = await areTipsAvailable(mockSiteConfig);

      expect(fetch).toHaveBeenCalledWith("/data/ananda/tips.txt", { method: "HEAD" });
      expect(result).toBe(true);
    });

    it("should return false when tips file doesn't exist", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await areTipsAvailable(mockSiteConfig);

      expect(fetch).toHaveBeenCalledWith("/data/ananda/tips.txt", { method: "HEAD" });
      expect(result).toBe(false);
    });

    it("should return false when siteConfig is null", async () => {
      const result = await areTipsAvailable(null);

      expect(fetch).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should return false when siteId is missing", async () => {
      const configWithoutSiteId = { ...mockSiteConfig, siteId: "" };
      const result = await areTipsAvailable(configWithoutSiteId);

      expect(fetch).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should return false on fetch errors", async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      const result = await areTipsAvailable(mockSiteConfig);

      expect(result).toBe(false);
    });
  });
});
