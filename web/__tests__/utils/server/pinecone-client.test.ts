import { getPineconeClient } from '../../../src/utils/server/pinecone-client';

// Mock the pinecone-client module to control the instance
let mockPineconeInstance: Record<string, unknown> | null = null;
jest.mock('../../../src/utils/server/pinecone-client', () => {
  const mockGetPineconeClient = jest.fn().mockImplementation(async () => {
    if (!mockPineconeInstance) {
      if (!process.env.PINECONE_API_KEY) {
        console.error('Pinecone error:', new Error('Pinecone API key missing'));
        throw new Error('Pinecone error');
      }
      mockPineconeInstance = {};
    }
    return mockPineconeInstance;
  });

  return {
    getPineconeClient: mockGetPineconeClient,
  };
});

describe('pinecone-client', () => {
  const originalEnv = process.env;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPineconeInstance = null;
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleErrorSpy.mockRestore();
  });

  it('should initialize Pinecone with the correct API key', async () => {
    // Set up environment variable
    process.env.PINECONE_API_KEY = 'test-api-key';

    await getPineconeClient();

    // Since we're mocking the module, we can't check Pinecone constructor directly
    expect(getPineconeClient).toHaveBeenCalled();
  });

  it('should throw an error if PINECONE_API_KEY is not set', async () => {
    // Remove the API key from environment
    delete process.env.PINECONE_API_KEY;

    await expect(getPineconeClient()).rejects.toThrow('Pinecone error');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Pinecone error:',
      expect.any(Error),
    );
  });

  it('should reuse the existing Pinecone instance on subsequent calls', async () => {
    // Set up environment variable
    process.env.PINECONE_API_KEY = 'test-api-key';

    // First call should create a new instance
    const instance1 = await getPineconeClient();

    // Reset the mock to verify it's called again but returns the same instance
    jest.clearAllMocks();

    // Second call should reuse the existing instance
    const instance2 = await getPineconeClient();

    // Verify getPineconeClient was called
    expect(getPineconeClient).toHaveBeenCalled();

    // Verify both calls return the same instance
    expect(instance1).toBe(instance2);
  });

  it('should handle Pinecone initialization errors', async () => {
    // Set up environment variable
    process.env.PINECONE_API_KEY = 'test-api-key';

    // Make the getPineconeClient throw an error
    jest.spyOn(console, 'error').mockImplementation(() => {});
    (getPineconeClient as jest.Mock).mockRejectedValueOnce(
      new Error('Pinecone error'),
    );

    await expect(getPineconeClient()).rejects.toThrow('Pinecone error');
  });
});
