import {
  generateEmailChangeToken,
  hashEmailChangeToken,
  getEmailChangeExpiryDate,
  sendEmailChangeVerificationEmail,
  sendEmailChangeConfirmationEmails,
} from "@/utils/server/userEmailChangeUtils";
import bcrypt from "bcryptjs";

// Mock AWS SES
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ MessageId: "mock-message-id" }),
  })),
  SendEmailCommand: jest.fn().mockImplementation((params) => params),
}));

// Mock site config
jest.mock("@/utils/server/loadSiteConfig", () => ({
  loadSiteConfigSync: jest.fn().mockReturnValue({
    name: "Test Site",
    shortname: "test",
  }),
}));

describe("userEmailChangeUtils", () => {
  describe("generateEmailChangeToken", () => {
    it("should generate a 32-character hex token", () => {
      const token = generateEmailChangeToken();
      expect(token).toMatch(/^[a-f0-9]{32}$/);
      expect(token).toHaveLength(32);
    });

    it("should generate unique tokens", () => {
      const token1 = generateEmailChangeToken();
      const token2 = generateEmailChangeToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("hashEmailChangeToken", () => {
    it("should hash a token using bcrypt", async () => {
      const token = "test-token-123";
      const hash = await hashEmailChangeToken(token);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(token);
      expect(hash.startsWith("$2")).toBe(true); // bcrypt hash format
    });

    it("should produce verifiable hashes", async () => {
      const token = "test-token-456";
      const hash = await hashEmailChangeToken(token);

      const isValid = await bcrypt.compare(token, hash);
      expect(isValid).toBe(true);

      const isInvalid = await bcrypt.compare("wrong-token", hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe("getEmailChangeExpiryDate", () => {
    it("should default to 24 hours from now", () => {
      const before = Date.now();
      const expiry = getEmailChangeExpiryDate();
      const after = Date.now();

      const expectedMin = before + 24 * 60 * 60 * 1000;
      const expectedMax = after + 24 * 60 * 60 * 1000;

      expect(expiry.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiry.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it("should accept custom hours", () => {
      const before = Date.now();
      const expiry = getEmailChangeExpiryDate(48);
      const after = Date.now();

      const expectedMin = before + 48 * 60 * 60 * 1000;
      const expectedMax = after + 48 * 60 * 60 * 1000;

      expect(expiry.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiry.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it("should handle fractional hours", () => {
      const before = Date.now();
      const expiry = getEmailChangeExpiryDate(0.5); // 30 minutes
      const after = Date.now();

      const expectedMin = before + 0.5 * 60 * 60 * 1000;
      const expectedMax = after + 0.5 * 60 * 60 * 1000;

      expect(expiry.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiry.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe("sendEmailChangeVerificationEmail", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should throw error when NEXT_PUBLIC_BASE_URL is not configured", async () => {
      delete process.env.NEXT_PUBLIC_BASE_URL;
      process.env.CONTACT_EMAIL = "test@example.com";

      await expect(sendEmailChangeVerificationEmail("new@example.com", "token123", "old@example.com")).rejects.toThrow(
        "Base URL not configured"
      );
    });

    it("should throw error when CONTACT_EMAIL is not configured", async () => {
      process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
      delete process.env.CONTACT_EMAIL;

      await expect(sendEmailChangeVerificationEmail("new@example.com", "token123", "old@example.com")).rejects.toThrow(
        "Contact email not configured"
      );
    });

    it("should send email successfully when both env vars are configured", async () => {
      process.env.NEXT_PUBLIC_BASE_URL = "https://example.com";
      process.env.CONTACT_EMAIL = "noreply@example.com";

      await expect(
        sendEmailChangeVerificationEmail("new@example.com", "token123", "old@example.com")
      ).resolves.not.toThrow();
    });
  });

  describe("sendEmailChangeConfirmationEmails", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should throw error when CONTACT_EMAIL is not configured", async () => {
      delete process.env.CONTACT_EMAIL;

      await expect(sendEmailChangeConfirmationEmails("old@example.com", "new@example.com")).rejects.toThrow(
        "Contact email not configured"
      );
    });

    it("should send confirmation emails successfully when CONTACT_EMAIL is configured", async () => {
      process.env.CONTACT_EMAIL = "noreply@example.com";

      await expect(sendEmailChangeConfirmationEmails("old@example.com", "new@example.com")).resolves.not.toThrow();
    });
  });
});
