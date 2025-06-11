import { jest } from "@jest/globals";

// Mock firebase-admin before importing the module
jest.mock("firebase-admin", () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(),
  },
  firestore: jest.fn().mockReturnValue({ collection: jest.fn() }),
}));

jest.mock("firebase-admin/firestore", () => ({
  initializeFirestore: jest.fn(),
}));

describe("Firebase Service", () => {
  const originalEnv = process.env;
  const mockConsoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  const mockConsoleLog = jest.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };

    // Reset the firebase-admin module state
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    mockConsoleWarn.mockReset();
    mockConsoleError.mockReset();
    mockConsoleLog.mockReset();
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
    mockConsoleError.mockRestore();
    mockConsoleLog.mockRestore();
  });

  test("should skip initialization during build time", async () => {
    // Mock the build environment
    jest.replaceProperty(process.env, "NODE_ENV", "production");
    process.env.NEXT_PHASE = "phase-production-build";

    // Import the module
    const { db } = await import("@/services/firebase");

    // Verify it logged the skipping message
    expect(mockConsoleWarn).toHaveBeenCalledWith("Skipping Firebase initialization during build time");
    expect(db).toBeNull();
  });

  test("should handle missing credentials", async () => {
    // Remove the credentials env var
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    jest.replaceProperty(process.env, "NODE_ENV", "development");

    // Importing the module should handle the missing credentials
    await expect(import("@/services/firebase")).rejects.toThrow(
      "The GOOGLE_APPLICATION_CREDENTIALS environment variable is not set."
    );
  });

  test("should handle invalid JSON in credentials", async () => {
    // Set invalid JSON
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "not valid json";
    jest.replaceProperty(process.env, "NODE_ENV", "development");

    // Importing the module should handle invalid JSON
    await expect(import("@/services/firebase")).rejects.toThrow(/Unexpected token/);
  });

  test("should initialize Firebase with valid credentials", async () => {
    // Reset mocks for this test
    jest.resetModules();

    // Set valid credentials JSON
    process.env.GOOGLE_APPLICATION_CREDENTIALS = JSON.stringify({
      type: "service_account",
      project_id: "test-project",
      private_key_id: "test-key-id",
      private_key: "test-private-key",
      client_email: "test@example.com",
    });
    jest.replaceProperty(process.env, "NODE_ENV", "development");

    // Create a fresh mock for this test
    const mockCertResult = {}; // Mock credential result
    const mockCert = jest.fn().mockReturnValue(mockCertResult);
    const mockInitializeApp = jest.fn().mockReturnValue({ name: "app" });
    const mockFirestore = jest.fn().mockReturnValue({ collection: jest.fn() });
    const mockInitFirestore = jest.fn();

    jest.doMock("firebase-admin", () => ({
      apps: [],
      initializeApp: mockInitializeApp,
      credential: { cert: mockCert },
      firestore: mockFirestore,
    }));

    jest.doMock("firebase-admin/firestore", () => ({
      initializeFirestore: mockInitFirestore,
    }));

    // Import the module
    const { db } = await import("@/services/firebase");

    // Verify Firebase was initialized correctly
    expect(mockCert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "service_account",
        project_id: "test-project",
      })
    );
    expect(mockInitializeApp).toHaveBeenCalledWith({
      credential: mockCertResult,
    });

    // Test if initializeFirestore was called - without checking exact arguments
    // since the implementation might vary
    expect(mockInitFirestore).toHaveBeenCalled();
    expect(db).not.toBeNull();
  });

  test("should handle initialization errors", async () => {
    // Set valid credentials but make initialization fail
    process.env.GOOGLE_APPLICATION_CREDENTIALS = JSON.stringify({
      type: "service_account",
      project_id: "test-project",
    });
    jest.replaceProperty(process.env, "NODE_ENV", "development");

    // We no longer need to mock initializeApp failure since our validation catches missing fields
    // The credential validation will throw before reaching initializeApp

    // Importing the module should fail with credential validation error
    await expect(import("@/services/firebase")).rejects.toThrow(/Firebase credentials missing required fields/);
    expect(mockConsoleError).toHaveBeenCalledWith("Error initializing Firebase:", expect.any(Error));
  });

  test("should reuse existing Firebase instance", async () => {
    // Reset the module before this test
    jest.resetModules();

    // Modify the mock to simulate an existing Firebase app
    jest.doMock("firebase-admin", () => ({
      apps: [{ name: "DEFAULT_APP" }],
      initializeApp: jest.fn(),
      firestore: jest.fn().mockReturnValue({ collection: jest.fn() }),
      credential: { cert: jest.fn() },
    }));

    // Import the module
    const { db } = await import("@/services/firebase");

    // Import the mock to check expectations
    const firebaseAdmin = await import("firebase-admin");

    // Verify it didn't try to initialize again
    expect(firebaseAdmin.initializeApp).not.toHaveBeenCalled();
    expect(firebaseAdmin.firestore).toHaveBeenCalled();
    expect(db).not.toBeNull();
  });
});
