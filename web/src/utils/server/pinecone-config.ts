import { loadEnv } from "./loadEnv.js";

// This function is now only used internally in this file
// and ensures environment variables are available
function validatePineconeEnv() {
  if (!process.env.PINECONE_INDEX_NAME) {
    throw new Error("Missing Pinecone index name in environment variables");
  }

  if (process.env.NODE_ENV === "development" && !process.env.PINECONE_INGEST_INDEX_NAME) {
    throw new Error("Missing Pinecone ingest index name in environment variables");
  }
}

// Initialize environment loading at module load
loadEnv();

export function getPineconeIndexName() {
  // Only validate when actually needed and not in test or build environment
  const isBuildTime =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "test";

  if (!isBuildTime && !process.env.PINECONE_INDEX_NAME) {
    throw new Error("Missing Pinecone index name in environment variables");
  }
  return process.env.PINECONE_INDEX_NAME ?? "default-index";
}

export function getPineconeIngestIndexName() {
  // Only validate when actually needed and not in test or build environment
  const isBuildTime =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "test";

  if (!isBuildTime && process.env.NODE_ENV === "development" && !process.env.PINECONE_INGEST_INDEX_NAME) {
    throw new Error("Missing Pinecone ingest index name in environment variables");
  }
  return process.env.PINECONE_INGEST_INDEX_NAME ?? "default-ingest-index";
}

// Export for tests only
export const __test__ = {
  validatePineconeEnv,
};
