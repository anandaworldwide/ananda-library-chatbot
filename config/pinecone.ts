/**
 * Change the namespace to the namespace on Pinecone you'd like to store your embeddings.
 */

if (!process.env.PINECONE_INDEX_NAME) {
  throw new Error('Missing Pinecone index name in .env file');
}

// For now, ingestion only happens in development
if (process.env.NODE_ENV === 'development' && !process.env.PINECONE_INGEST_INDEX_NAME) {
  throw new Error('Missing Pinecone ingest index name in .env file');
}

const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME ?? '';
const PINECONE_INGEST_INDEX_NAME = process.env.PINECONE_INGEST_INDEX_NAME ?? '';

// const PINECONE_NAME_SPACE = 'pdf-test'; //namespace is optional for your vectors

export { PINECONE_INDEX_NAME, PINECONE_INGEST_INDEX_NAME };
