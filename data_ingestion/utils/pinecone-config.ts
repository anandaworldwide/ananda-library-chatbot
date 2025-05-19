import { loadEnv } from './loadEnv.js';

// This function is now only used internally in this file
// and ensures environment variables are available
function validatePineconeEnv() {
  if (!process.env.PINECONE_INDEX_NAME) {
    throw new Error('Missing Pinecone index name in environment variables');
  }

  if (
    process.env.NODE_ENV === 'development' &&
    !process.env.PINECONE_INGEST_INDEX_NAME
  ) {
    throw new Error(
      'Missing Pinecone ingest index name in environment variables',
    );
  }
}

// Initialize once at module load, but only if not in test environment
loadEnv();
if (process.env.NODE_ENV !== 'test') {
  validatePineconeEnv();
}

export function getPineconeIndexName() {
  return process.env.PINECONE_INDEX_NAME ?? '';
}

export function getPineconeIngestIndexName() {
  return process.env.PINECONE_INGEST_INDEX_NAME ?? '';
}

// Export for tests only
export const __test__ = {
  validatePineconeEnv,
};
