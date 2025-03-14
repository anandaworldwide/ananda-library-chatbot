/**
 * Jest setup file for Ananda Library Chatbot
 * This file sets up mocks for Firebase and other services before tests run
 */

// Set mock Firebase credentials to bypass initialization checks
process.env.GOOGLE_APPLICATION_CREDENTIALS = JSON.stringify({
  type: 'service_account',
  project_id: 'mock-project',
  private_key_id: 'mock-key-id',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nXXXMOCK_PRIVATE_KEYXXX\n-----END PRIVATE KEY-----\n',
  client_email: 'mock@example.com',
  client_id: 'mock-client-id',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url:
    'https://www.googleapis.com/robot/v1/metadata/x509/mock%40example.com',
});

// Mock other environment variables
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.NODE_ENV = 'test';

// Increase the timeout for async operations
jest.setTimeout(30000);

// Mock console methods to reduce noise in test output
global.console = {
  ...console,
  // Uncomment to suppress specific console methods
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
};

// Use a fixed "now" for tests that rely on timing
global.Date.now = jest.fn(() => 1613753920000); // Fix date to a specific timestamp

// Ensure TextEncoder/TextDecoder are available
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class {
    encode(text) {
      return Buffer.from(text);
    }
  };
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class {
    decode(buf) {
      return Buffer.from(buf).toString();
    }
  };
}

// Setup mock for firebase-admin before any imports
jest.mock('firebase-admin', () => {
  return {
    credential: {
      cert: jest.fn().mockReturnValue({}),
    },
    initializeApp: jest.fn().mockReturnValue({}),
    firestore: jest.fn().mockReturnValue({}),
    apps: ['mockApp'], // Mock that Firebase is already initialized
  };
});
