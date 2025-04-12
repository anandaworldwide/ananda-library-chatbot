import 'openai/shims/node';
import OpenAI from 'openai';

// Initialize OpenAI client with a fallback mock API key for testing
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'mock-api-key-for-testing',
  dangerouslyAllowBrowser: true, // Necessary for Node.js test environments
});

// Use a recommended embedding model
const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Calculates the cosine similarity between two vectors.
 * @param vecA - The first vector.
 * @param vecB - The second vector.
 * @returns The cosine similarity score (between -1 and 1).
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0; // Avoid division by zero
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Generates an embedding for the given text using the OpenAI API.
 * @param text - The input text to embed.
 * @returns A promise that resolves to the embedding vector (array of numbers).
 */
export async function getEmbedding(text: string): Promise<number[]> {
  // Replace newlines with spaces, as recommended by OpenAI
  const cleanedText = text.replace(/\n/g, ' ').trim();

  if (!cleanedText) {
    // Handle empty strings to avoid API errors - return a zero vector or handle as needed
    // The dimension depends on the model, text-embedding-3-small uses 1536
    // You might need to adjust this based on the model you use.
    console.warn('Attempted to embed an empty string. Returning zero vector.');
    const dimensions = 1536; // Dimension for text-embedding-3-small
    return Array(dimensions).fill(0);
  }

  // Return mock embeddings if using the mock API key
  if (process.env.OPENAI_API_KEY === undefined) {
    console.warn('Using mock embeddings for testing');
    // Generate deterministic mock embeddings based on text length
    const dimensions = 1536;
    return Array(dimensions)
      .fill(0)
      .map(
        (_, i) => ((cleanedText.length * i) % 100) / 100, // Creates values between 0 and 1
      );
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanedText,
    });

    // Assuming the response structure includes data[0].embedding
    if (response.data && response.data[0] && response.data[0].embedding) {
      return response.data[0].embedding;
    } else {
      throw new Error('Invalid response structure from OpenAI API');
    }
  } catch (error) {
    console.error('Error getting embedding from OpenAI:', error);
    // Re-throw the error to fail the test
    throw new Error(
      `Failed to get embedding: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
