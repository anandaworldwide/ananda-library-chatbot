import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/redirect/[code]";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { sendOpsAlert } from "@/utils/server/emailOps";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";

// Mock dependencies
jest.mock("@/utils/server/loadSiteConfig");
jest.mock("@/utils/server/emailOps");
jest.mock("@/utils/server/genericRateLimiter");

const mockLoadSiteConfigSync = loadSiteConfigSync as jest.MockedFunction<typeof loadSiteConfigSync>;
const mockSendOpsAlert = sendOpsAlert as jest.MockedFunction<typeof sendOpsAlert>;
const mockGenericRateLimiter = genericRateLimiter as jest.MockedFunction<typeof genericRateLimiter>;

describe("/api/redirect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendOpsAlert.mockResolvedValue(true);
    mockGenericRateLimiter.mockResolvedValue(true); // Allow requests by default
  });

  it("should reject non-GET requests", async () => {
    const { req, res } = createMocks({
      method: "POST",
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toEqual({ error: "Method not allowed" });
  });

  it("should reject requests with unknown redirect codes", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister",
        },
      },
    } as any);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "unknown" }, // Unknown code
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Redirect code not found",
    });
  });

  it("should reject requests when site config fails to load", async () => {
    mockLoadSiteConfigSync.mockReturnValue(null);

    const { req, res } = createMocks({
      method: "GET",
      query: {
        event: "Redirect Click",
        target: "https://www.ananda.org/contact-us/",
      },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Failed to load site configuration",
    });
  });

  it("should reject requests with invalid path format", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "test",
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister",
        },
      },
    } as any);

    const { req, res } = createMocks({
      method: "GET",
      query: {}, // Missing code
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Invalid redirect code",
    });
  });

  it("should reject requests when site has no redirect mappings", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      // No redirectMappings property
    } as any);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "mg" },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Redirect code not found",
    });
  });

  it("should successfully redirect and send email for valid path-based requests", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister",
        },
      },
    } as any);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "mg" },
      headers: {
        "x-forwarded-for": "192.168.1.1",
        "user-agent": "Test Browser",
      },
    });

    await handler(req as any, res as any);

    // Should redirect
    expect(res._getStatusCode()).toBe(302);
    expect(res._getRedirectUrl()).toBe("https://www.ananda.org/contact-us/");

    // Should send email alert
    expect(mockSendOpsAlert).toHaveBeenCalledWith(
      "Minister Guidance Click",
      expect.stringContaining("A tracked redirect was clicked")
    );

    const emailCall = mockSendOpsAlert.mock.calls[0];
    const emailMessage = emailCall[1];
    expect(emailMessage).toContain("Event: Minister Guidance Click");
    expect(emailMessage).toContain("Target URL: https://www.ananda.org/contact-us/");
    expect(emailMessage).toContain("Session ID:");
    expect(emailMessage).toContain("Timestamp:");
  });

  it("should still redirect even if email fails", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister",
        },
      },
    } as any);

    // Mock email failure
    mockSendOpsAlert.mockResolvedValue(false);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "mg" },
    });

    await handler(req as any, res as any);

    // Should still redirect despite email failure
    expect(res._getStatusCode()).toBe(302);
    expect(res._getRedirectUrl()).toBe("https://www.ananda.org/contact-us/");
  });

  it("should enforce rate limiting (5 requests per 5 minutes)", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister",
        },
      },
    } as any);

    // Mock rate limiter to return false (rate limit exceeded)
    mockGenericRateLimiter.mockResolvedValue(false);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "mg" },
    });

    await handler(req as any, res as any);

    // Should be rate limited - the genericRateLimiter handles the response
    // so we just need to verify it was called with correct parameters
    expect(mockGenericRateLimiter).toHaveBeenCalledWith(req, res, {
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 5, // 5 requests per 5 minutes
      name: "redirect-tracking",
    });

    // The rate limiter should have handled the response, so handler returns early
    expect(mockSendOpsAlert).not.toHaveBeenCalled();
  });

  it("should handle path-based redirects with site configuration mapping", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister for private spiritual counseling",
        },
      },
    } as any);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "mg" },
    });

    await handler(req as any, res as any);

    // Should redirect to the mapped URL
    expect(res._getStatusCode()).toBe(302);
    expect(res._getRedirectUrl()).toBe("https://www.ananda.org/contact-us/");

    // Should send email alert with mapped event name
    expect(mockSendOpsAlert).toHaveBeenCalledWith(
      "Minister Guidance Click",
      expect.stringContaining("A tracked redirect was clicked")
    );

    const emailCall = mockSendOpsAlert.mock.calls[0];
    const emailMessage = emailCall[1];
    expect(emailMessage).toContain("Event: Minister Guidance Click");
    expect(emailMessage).toContain("Target URL: https://www.ananda.org/contact-us/");
  });

  it("should return 404 for unknown redirect codes", async () => {
    mockLoadSiteConfigSync.mockReturnValue({
      siteId: "ananda",
      redirectWhitelist: ["ananda.org", "www.ananda.org"],
      redirectMappings: {
        mg: {
          url: "https://www.ananda.org/contact-us/",
          event: "Minister Guidance Click",
          description: "Connect with minister for private spiritual counseling",
        },
      },
    } as any);

    const { req, res } = createMocks({
      method: "GET",
      query: { code: "unknown" },
    });

    await handler(req as any, res as any);

    expect(res._getStatusCode()).toBe(404);
    expect(JSON.parse(res._getData())).toEqual({
      error: "Redirect code not found",
    });
  });
});
