import { createMocks } from "node-mocks-http";
import { getSecureUUID } from "@/utils/server/uuidUtils";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import { JwtPayload } from "@/utils/server/jwtUtils";

// Mock dependencies
jest.mock("@/utils/server/loadSiteConfig");
const mockLoadSiteConfigSync = loadSiteConfigSync as jest.MockedFunction<typeof loadSiteConfigSync>;

describe("uuidUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getSecureUUID", () => {
    describe("for authenticated sites (requireLogin: true)", () => {
      beforeEach(() => {
        mockLoadSiteConfigSync.mockReturnValue({
          requireLogin: true,
          siteId: "ananda",
        } as any);
      });

      it("should return UUID from JWT payload when available", () => {
        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const userPayload: JwtPayload = {
          client: "web",
          email: "test@example.com",
          role: "user",
          uuid: "jwt-uuid",
          iat: Date.now(),
          exp: Date.now() + 3600000,
        };

        const result = getSecureUUID(req as any, userPayload);

        expect(result).toEqual({
          success: true,
          uuid: "jwt-uuid",
        });
      });

      it("should return error when JWT UUID is missing", () => {
        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const userPayload: JwtPayload = {
          client: "web",
          email: "test@example.com",
          role: "user",
          // uuid missing
          iat: Date.now(),
          exp: Date.now() + 3600000,
        };

        const result = getSecureUUID(req as any, userPayload);

        expect(result).toEqual({
          success: false,
          error: "UUID not found in authentication token",
          statusCode: 400,
        });
      });

      it("should return error when userPayload is undefined", () => {
        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const result = getSecureUUID(req as any, undefined);

        expect(result).toEqual({
          success: false,
          error: "UUID not found in authentication token",
          statusCode: 400,
        });
      });
    });

    describe("for anonymous sites (requireLogin: false)", () => {
      beforeEach(() => {
        mockLoadSiteConfigSync.mockReturnValue({
          requireLogin: false,
          siteId: "ananda-public",
        } as any);
      });

      it("should return UUID from cookies when available", () => {
        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const result = getSecureUUID(req as any);

        expect(result).toEqual({
          success: true,
          uuid: "cookie-uuid",
        });
      });

      it("should return error when cookie UUID is missing", () => {
        const { req } = createMocks({
          method: "POST",
          // no cookies
        });

        const result = getSecureUUID(req as any);

        expect(result).toEqual({
          success: false,
          error: "UUID not found in cookies",
          statusCode: 400,
        });
      });

      it("should return error when cookie UUID is undefined", () => {
        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "" }, // Empty string simulates undefined/missing UUID
        });

        const result = getSecureUUID(req as any);

        expect(result).toEqual({
          success: false,
          error: "UUID not found in cookies",
          statusCode: 400,
        });
      });

      it("should ignore JWT payload and use cookies for anonymous sites", () => {
        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const userPayload: JwtPayload = {
          client: "web",
          email: "test@example.com",
          role: "user",
          uuid: "jwt-uuid",
          iat: Date.now(),
          exp: Date.now() + 3600000,
        };

        const result = getSecureUUID(req as any, userPayload);

        expect(result).toEqual({
          success: true,
          uuid: "cookie-uuid", // Should use cookie, not JWT
        });
      });
    });

    describe("edge cases", () => {
      it("should handle missing site config", () => {
        mockLoadSiteConfigSync.mockReturnValue(null as any);

        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const result = getSecureUUID(req as any);

        expect(result).toEqual({
          success: true,
          uuid: "cookie-uuid", // Should default to cookie behavior
        });
      });

      it("should handle site config without requireLogin property", () => {
        mockLoadSiteConfigSync.mockReturnValue({
          siteId: "crystal",
          // requireLogin property missing
        } as any);

        const { req } = createMocks({
          method: "POST",
          cookies: { uuid: "cookie-uuid" },
        });

        const result = getSecureUUID(req as any);

        expect(result).toEqual({
          success: true,
          uuid: "cookie-uuid", // Should default to cookie behavior
        });
      });
    });
  });
});
