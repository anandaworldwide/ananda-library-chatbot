import { Pinecone } from '@pinecone-database/pinecone';

/**
 * Global Pinecone instance that persists across requests
 * This significantly reduces setup time by reusing the same connection
 */
let pineconeInstance: Pinecone | null = null;

// Also cache the Index instances to avoid repeated lookups.
// Note: It's not clear how much this helps with a Vercel serverless app.
const indexCache: Record<string, any> = {};

async function initPinecone() {
  if (!process.env.PINECONE_API_KEY) {
    throw new Error('Pinecone API key missing');
  }
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });

    return pinecone;
  } catch (error) {
    console.error('Error initializing Pinecone:', error);
    throw new Error('Failed to initialize Pinecone Client');
  }
}

export const getPineconeClient = async () => {
  if (!pineconeInstance) {
    const startTime = Date.now();
    try {
      pineconeInstance = await initPinecone();
      const setupTime = Date.now() - startTime;
      if (setupTime > 200) {
        console.log(`Initial Pinecone connection took ${setupTime}ms`);
      }
    } catch (error) {
      console.error('Pinecone error:', error);
      throw new Error('Pinecone error');
    }
  }
  return pineconeInstance;
};

/**
 * Get a cached Pinecone index instance to avoid repeated lookups
 * @param indexName The name of the Pinecone index
 * @returns The Pinecone index instance
 */
export const getCachedPineconeIndex = async (indexName: string) => {
  if (!indexName) {
    throw new Error('Index name is required');
  }

  // Return from cache if available
  if (indexCache[indexName]) {
    console.log(`Returning cached Pinecone index: ${indexName}`);
    return indexCache[indexName];
  }

  // Otherwise, get the client and create the index
  const pinecone = await getPineconeClient();
  const index = pinecone.Index(indexName);

  // Cache for future use
  indexCache[indexName] = index;

  return index;
};
