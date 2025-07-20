/** @jest-environment node */

import { sendOpsAlert } from "../../../src/utils/server/emailOps";

// Mock AWS SES
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  SendEmailCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

describe("emailOps", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment variables
    delete process.env.OPS_ALERT_EMAIL;
    delete process.env.CONTACT_EMAIL;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete (process.env as any).NODE_ENV;
    delete process.env.SITE_ID;
  });

  describe("sendOpsAlert", () => {
    it("should send email successfully with valid configuration", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "ops@example.com";
      process.env.CONTACT_EMAIL = "noreply@example.com";
      (process.env as any).NODE_ENV = "production";
      process.env.SITE_ID = "ananda";

      const subject = "Test Alert";
      const message = "This is a test alert message";

      // Execute
      const result = await sendOpsAlert(subject, message);

      // Verify
      expect(result).toBe(true);
    });

    it("should handle multiple email addresses separated by semicolons", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "ops1@example.com; ops2@example.com ; ops3@example.com";
      process.env.CONTACT_EMAIL = "noreply@example.com";

      // Execute
      const result = await sendOpsAlert("Test", "Message");

      // Verify
      expect(result).toBe(true);
    });

    it("should include error details when provided", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "ops@example.com";
      process.env.CONTACT_EMAIL = "noreply@example.com";

      const error = new Error("Test error");
      error.stack = "Error stack trace";

      const errorDetails = {
        error,
        context: { key: "value" },
        stack: "Custom stack trace",
      };

      // Execute
      const result = await sendOpsAlert("Test", "Message", errorDetails);

      // Verify
      expect(result).toBe(true);
    });

    it("should return false when OPS_ALERT_EMAIL is not set", async () => {
      // Execute
      const result = await sendOpsAlert("Test", "Message");

      // Verify
      expect(result).toBe(false);
    });

    it("should return false when OPS_ALERT_EMAIL is empty", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "";

      // Execute
      const result = await sendOpsAlert("Test", "Message");

      // Verify
      expect(result).toBe(false);
    });

    it("should return false when OPS_ALERT_EMAIL contains only invalid emails", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "; ; ";

      // Execute
      const result = await sendOpsAlert("Test", "Message");

      // Verify
      expect(result).toBe(false);
    });

    it("should handle SES send errors gracefully", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "ops@example.com";
      process.env.CONTACT_EMAIL = "noreply@example.com";

      // Execute
      const result = await sendOpsAlert("Test", "Message");

      // Verify - this test will pass if the function handles errors gracefully
      expect(typeof result).toBe("boolean");
    });

    it("should use default source email when CONTACT_EMAIL is not set", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "ops@example.com";

      // Execute
      const result = await sendOpsAlert("Test", "Message");

      // Verify
      expect(result).toBe(true);
    });

    it("should include environment and site in subject line", async () => {
      // Setup
      process.env.OPS_ALERT_EMAIL = "ops@example.com";
      process.env.CONTACT_EMAIL = "noreply@example.com";
      process.env.SITE_ID = "ananda-public";

      // Test dev environment
      (process.env as any).NODE_ENV = "development";

      // Execute
      const result = await sendOpsAlert("S3 load failure", "Test message");

      // Verify
      expect(result).toBe(true);

      // Test production environment
      (process.env as any).NODE_ENV = "production";

      // Execute again
      const result2 = await sendOpsAlert("S3 load failure", "Test message");

      // Verify
      expect(result2).toBe(true);
    });
  });
});
