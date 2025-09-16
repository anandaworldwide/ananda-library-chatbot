import { sendWelcomeEmail } from "@/utils/server/userInviteUtils";

// Mock AWS SES
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  SendEmailCommand: jest.fn().mockImplementation((params) => params),
}));

// Mock site config
jest.mock("@/utils/server/loadSiteConfig", () => ({
  loadSiteConfigSync: jest.fn(() => ({
    name: "Test Chatbot",
    shortname: "TestBot",
    emailGreeting: "Hi there!",
  })),
}));

// Mock email templates
jest.mock("@/utils/server/emailTemplates", () => ({
  createEmailParams: jest.fn((from, to, subject, options) => ({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: {
        Html: { Data: `<html>${options.message}</html>` },
        Text: { Data: options.message },
      },
    },
  })),
}));

describe("sendWelcomeEmail", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_BASE_URL: "https://test.example.com",
      CONTACT_EMAIL: "test@example.com",
      SITE_ID: "test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should send welcome email with correct parameters", async () => {
    const { createEmailParams } = await import("@/utils/server/emailTemplates");

    await sendWelcomeEmail("user@example.com");

    expect(createEmailParams).toHaveBeenCalledWith(
      "test@example.com",
      "user@example.com",
      "Welcome to Test Chatbot!",
      expect.objectContaining({
        message: expect.stringContaining("Welcome to Test Chatbot!"),
        baseUrl: "https://test.example.com",
        siteId: "test",
        actionUrl: "https://test.example.com",
        actionText: "Go to Test Chatbot",
      })
    );
  });

  it("should use request domain when provided", async () => {
    const { createEmailParams } = await import("@/utils/server/emailTemplates");

    const mockReq = {
      headers: {
        host: "preview.example.com",
        "x-forwarded-proto": "https",
      },
    };

    await sendWelcomeEmail("user@example.com", mockReq);

    expect(createEmailParams).toHaveBeenCalledWith(
      "test@example.com",
      "user@example.com",
      "Welcome to Test Chatbot!",
      expect.objectContaining({
        actionUrl: "https://preview.example.com",
        baseUrl: "https://preview.example.com",
      })
    );
  });

  it("should throw error when NEXT_PUBLIC_BASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;

    await expect(sendWelcomeEmail("user@example.com")).rejects.toThrow(
      "NEXT_PUBLIC_BASE_URL environment variable is required for email generation"
    );
  });

  it("should include site-specific branding in welcome message", async () => {
    const { createEmailParams } = await import("@/utils/server/emailTemplates");

    await sendWelcomeEmail("user@example.com");

    const callArgs = (createEmailParams as jest.MockedFunction<any>).mock.calls[0];
    const messageOptions = callArgs[3];

    expect(messageOptions.message).toContain("Welcome to Test Chatbot!");
    expect(messageOptions.message).toContain(
      "You can now start exploring our spiritual teachings and resources by chatting with Test Chatbot"
    );
    expect(messageOptions.message).toContain("Go to Test Chatbot");
    expect(messageOptions.message).toContain("We're excited to have you join our community!");
  });

  it("should handle localhost request correctly", async () => {
    const { createEmailParams } = await import("@/utils/server/emailTemplates");

    const mockReq = {
      headers: {
        host: "localhost:3000",
      },
    };

    await sendWelcomeEmail("user@example.com", mockReq);

    expect(createEmailParams).toHaveBeenCalledWith(
      "test@example.com",
      "user@example.com",
      "Welcome to Test Chatbot!",
      expect.objectContaining({
        actionUrl: "http://localhost:3000",
        baseUrl: "http://localhost:3000",
      })
    );
  });
});
