// Setup file for server tests
// This file is loaded before tests run

// Set mock Firebase credentials
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

// Mock TextEncoder/TextDecoder which are required by dependencies
// @ts-expect-error Mock for Node.js environment
global.TextEncoder = class {
  encode(text: string): Uint8Array {
    return new Uint8Array(Buffer.from(text));
  }
};

// @ts-expect-error Mock for Node.js environment
global.TextDecoder = class {
  decode(buf: Uint8Array): string {
    return Buffer.from(buf).toString();
  }
};
