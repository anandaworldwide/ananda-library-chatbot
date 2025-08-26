/**
 * @jest-environment jsdom
 */

import { GetServerSidePropsContext } from "next";
import { getServerSideProps } from "../../src/pages/settings";
import { loadSiteConfig } from "../../src/utils/server/loadSiteConfig";

// Mock the loadSiteConfig function
jest.mock("../../src/utils/server/loadSiteConfig");
const mockLoadSiteConfig = loadSiteConfig as jest.MockedFunction<typeof loadSiteConfig>;

describe("/settings - Server-Side Rendering", () => {
  const mockContext = {
    req: {},
    res: {},
    query: {},
    params: {},
    resolvedUrl: "/settings",
  } as GetServerSidePropsContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Login-required sites", () => {
    it("should allow access when requireLogin is true", async () => {
      // Mock site config for login-required site (like ananda, jairam)
      mockLoadSiteConfig.mockResolvedValue({
        name: "Test Site",
        requireLogin: true,
        allowTemporarySessions: true,
      } as any);

      const result = await getServerSideProps(mockContext);

      expect(result).toEqual({
        props: {
          siteConfig: {
            name: "Test Site",
            requireLogin: true,
            allowTemporarySessions: true,
          },
        },
      });
    });
  });

  describe("No-login sites", () => {
    it("should return 404 when requireLogin is false", async () => {
      // Mock site config for no-login site (like ananda-public, crystal)
      mockLoadSiteConfig.mockResolvedValue({
        name: "Public Site",
        requireLogin: false,
        allowTemporarySessions: false,
      } as any);

      const result = await getServerSideProps(mockContext);

      expect(result).toEqual({
        notFound: true,
      });
    });

    it("should return 404 when requireLogin is undefined", async () => {
      // Mock site config without requireLogin field
      mockLoadSiteConfig.mockResolvedValue({
        name: "Legacy Site",
        // requireLogin not specified (falsy)
      } as any);

      const result = await getServerSideProps(mockContext);

      expect(result).toEqual({
        notFound: true,
      });
    });
  });

  describe("Error handling", () => {
    it("should handle site config loading errors gracefully", async () => {
      // Mock site config loading failure
      mockLoadSiteConfig.mockRejectedValue(new Error("Site config loading failed"));

      const result = await getServerSideProps(mockContext);

      // Should default to notFound when site config can't be loaded
      expect(result).toEqual({
        notFound: true,
      });
    });

    it("should handle null site config", async () => {
      // Mock null site config
      mockLoadSiteConfig.mockResolvedValue(null);

      const result = await getServerSideProps(mockContext);

      expect(result).toEqual({
        notFound: true,
      });
    });
  });
});
