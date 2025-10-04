import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "@/pages/api/admin/approvers";

// Mock dependencies
jest.mock("@/utils/server/awsConfig", () => ({
  s3Client: {
    send: jest.fn(),
  },
}));

jest.mock("@/utils/server/redisUtils", () => ({
  getFromCache: jest.fn(),
  setInCache: jest.fn(),
}));

jest.mock("@/utils/server/genericRateLimiter", () => ({
  genericRateLimiter: jest.fn(),
}));

jest.mock("@/utils/server/apiMiddleware", () => ({
  withApiMiddleware: jest.fn((handler) => handler),
}));

jest.mock("@/utils/server/loadSiteConfig", () => ({
  loadSiteConfig: jest.fn(),
}));

jest.mock("@/utils/env", () => ({
  isDevelopment: jest.fn(),
  isProduction: jest.fn(),
  getEnvName: jest.fn(),
}));

// Mock Readable stream for S3 response
const mockReadableStream: any = {
  on: jest.fn((event: string, callback: (...args: any[]) => void) => {
    if (event === "data") {
      callback(Buffer.from(JSON.stringify({ lastUpdated: "2025-10-03", regions: [] })));
    } else if (event === "end") {
      callback();
    }
    return mockReadableStream;
  }),
};

describe("/api/admin/approvers", () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { s3Client } = require("@/utils/server/awsConfig");
  const redisUtils = require("@/utils/server/redisUtils");
  const { genericRateLimiter } = require("@/utils/server/genericRateLimiter");
  const loadSiteConfig = require("@/utils/server/loadSiteConfig");
  const { isDevelopment } = require("@/utils/env");
  /* eslint-enable @typescript-eslint/no-var-requires */

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 405 for non-GET requests", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it("should apply rate limiting", async () => {
    genericRateLimiter.mockResolvedValue(false);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(genericRateLimiter).toHaveBeenCalled();
    // Rate limiter returns early, no further processing
  });

  it("should return cached data when available", async () => {
    const mockData = { lastUpdated: "2025-10-03", regions: [{ name: "Americas", admins: [] }] };

    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(mockData);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual(mockData);
    expect(s3Client.send).not.toHaveBeenCalled();
  });

  it("should fetch from S3 when cache is empty", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockResolvedValue({
      Body: mockReadableStream,
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(redisUtils.setInCache).toHaveBeenCalledWith(
      "admin_approvers_ananda",
      expect.objectContaining({ lastUpdated: "2025-10-03" }),
      300
    );
  });

  it("should use dev- prefix for development environments", async () => {
    isDevelopment.mockReturnValue(true);

    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockResolvedValue({
      Body: mockReadableStream,
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(isDevelopment).toHaveBeenCalled();
    expect(s3Client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: "site-config/admin-approvers/dev-ananda-admin-approvers.json",
        }),
      })
    );
  });

  it("should use no prefix for production environment", async () => {
    isDevelopment.mockReturnValue(false);

    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockResolvedValue({
      Body: mockReadableStream,
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(isDevelopment).toHaveBeenCalled();
    expect(s3Client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: "site-config/admin-approvers/ananda-admin-approvers.json",
        }),
      })
    );
  });

  it("should return 500 when site config is unavailable", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue(null);

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({ error: "Site configuration not available" });
  });

  it("should return fallback admin approver when S3 file does not exist and CONTACT_EMAIL is set", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockRejectedValue({ name: "NoSuchKey" });

    // Mock CONTACT_EMAIL environment variable
    const originalContactEmail = process.env.CONTACT_EMAIL;
    process.env.CONTACT_EMAIL = "support@ananda.org";

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data).toHaveProperty("lastUpdated");
    expect(data).toHaveProperty("regions");
    expect(data.regions).toHaveLength(1);
    expect(data.regions[0].name).toBe("General");
    expect(data.regions[0].admins).toHaveLength(1);
    expect(data.regions[0].admins[0]).toEqual({
      name: "Support",
      email: "support@ananda.org",
      location: "Global Support Team",
    });

    // Restore original env var
    process.env.CONTACT_EMAIL = originalContactEmail;
  });

  it("should return fallback admin approver when S3 bucket does not exist and CONTACT_EMAIL is set", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "photo" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockRejectedValue({ name: "NoSuchBucket" });

    // Mock CONTACT_EMAIL environment variable
    const originalContactEmail = process.env.CONTACT_EMAIL;
    process.env.CONTACT_EMAIL = "support@ananda.org";

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data).toHaveProperty("lastUpdated");
    expect(data).toHaveProperty("regions");
    expect(data.regions).toHaveLength(1);
    expect(data.regions[0].name).toBe("General");
    expect(data.regions[0].admins).toHaveLength(1);
    expect(data.regions[0].admins[0]).toEqual({
      name: "Support",
      email: "support@ananda.org",
      location: "Global Support Team",
    });

    // Restore original env var
    process.env.CONTACT_EMAIL = originalContactEmail;
  });

  it("should return 404 when S3 file does not exist and CONTACT_EMAIL is not set", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockRejectedValue({ name: "NoSuchKey" });

    // Mock CONTACT_EMAIL not set
    const originalContactEmail = process.env.CONTACT_EMAIL;
    delete process.env.CONTACT_EMAIL;

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._getJSONData()).toEqual({
      error: "Admin approvers configuration not found for this site and CONTACT_EMAIL not configured",
    });

    // Restore original env var
    process.env.CONTACT_EMAIL = originalContactEmail;
  });

  it("should return 403 for access denied errors", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);
    s3Client.send.mockRejectedValue({ name: "AccessDenied" });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res._getJSONData()).toEqual({ error: "Access denied to admin approvers configuration" });
  });

  it("should validate data structure", async () => {
    genericRateLimiter.mockResolvedValue(true);
    loadSiteConfig.loadSiteConfig.mockResolvedValue({ siteId: "ananda" });
    redisUtils.getFromCache.mockResolvedValue(null);

    // Mock invalid data structure
    const invalidStream: any = {
      on: jest.fn((event: string, callback: (...args: any[]) => void) => {
        if (event === "data") {
          callback(Buffer.from(JSON.stringify({ invalid: "structure" })));
        } else if (event === "end") {
          callback();
        }
        return invalidStream;
      }),
    };

    s3Client.send.mockResolvedValue({
      Body: invalidStream,
    });

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "GET",
    });

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData()).toEqual({ error: "Invalid admin approvers data structure" });
  });
});
