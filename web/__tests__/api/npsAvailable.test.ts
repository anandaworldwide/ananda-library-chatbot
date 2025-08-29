import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/npsAvailable";

// Mock console.error to capture error logs
const mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});

describe("/api/npsAvailable", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.NPS_SURVEY_GOOGLE_SHEET_ID;
  });

  afterEach(() => {
    mockConsoleError.mockClear();
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  it("should return available: true when both environment variables are set", async () => {
    // Set both required environment variables
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '{"type": "service_account"}';
    process.env.NPS_SURVEY_GOOGLE_SHEET_ID = "test-sheet-id";

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      available: true,
      message: "NPS survey is available",
    });

    // Should not log any errors when properly configured
    expect(mockConsoleError).not.toHaveBeenCalled();
  });

  it("should return available: false when GOOGLE_APPLICATION_CREDENTIALS is missing", async () => {
    // Only set sheet ID, missing credentials
    process.env.NPS_SURVEY_GOOGLE_SHEET_ID = "test-sheet-id";

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      available: false,
      message: "NPS survey is not configured",
    });

    // Should log configuration error
    expect(mockConsoleError).toHaveBeenCalledWith(
      "NPS Survey configuration missing:",
      expect.objectContaining({
        hasGoogleCredentials: false,
        hasSheetId: true,
        timestamp: expect.any(String),
      })
    );
  });

  it("should return available: false when NPS_SURVEY_GOOGLE_SHEET_ID is missing", async () => {
    // Only set credentials, missing sheet ID
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '{"type": "service_account"}';

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      available: false,
      message: "NPS survey is not configured",
    });

    // Should log configuration error
    expect(mockConsoleError).toHaveBeenCalledWith(
      "NPS Survey configuration missing:",
      expect.objectContaining({
        hasGoogleCredentials: true,
        hasSheetId: false,
        timestamp: expect.any(String),
      })
    );
  });

  it("should return available: false when both environment variables are missing", async () => {
    // Neither environment variable is set

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      available: false,
      message: "NPS survey is not configured",
    });

    // Should log configuration error
    expect(mockConsoleError).toHaveBeenCalledWith(
      "NPS Survey configuration missing:",
      expect.objectContaining({
        hasGoogleCredentials: false,
        hasSheetId: false,
        timestamp: expect.any(String),
      })
    );
  });

  it("should return available: false when NPS_SURVEY_GOOGLE_SHEET_ID is empty string", async () => {
    // Set credentials but sheet ID is empty string
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '{"type": "service_account"}';
    process.env.NPS_SURVEY_GOOGLE_SHEET_ID = "";

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      available: false,
      message: "NPS survey is not configured",
    });

    // Should log configuration error
    expect(mockConsoleError).toHaveBeenCalledWith(
      "NPS Survey configuration missing:",
      expect.objectContaining({
        hasGoogleCredentials: true,
        hasSheetId: false,
        timestamp: expect.any(String),
      })
    );
  });

  it("should return 405 for non-GET requests", async () => {
    const { req, res } = createMocks({
      method: "POST",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(405);
    const data = JSON.parse(res._getData());
    expect(data).toEqual({
      message: "Method Not Allowed",
    });
  });
});
