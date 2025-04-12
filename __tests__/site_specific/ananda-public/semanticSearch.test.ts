// __tests__/site_specific/ananda-public/semanticSearch.test.ts
/** @jest-environment node */

/**
 * @fileoverview Semantic search tests for Vivek (Ananda Public) responses.
 *
 * Validates that Vivek provides semantically appropriate responses based on
 * whether the query is related to Ananda's teachings or resources, using
 * embedding similarity.
 *
 * To run these tests specifically:
 * npm run test:queries ananda-public
 */

// Polyfill fetch for Node environment
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import { getEmbedding, cosineSimilarity } from '../../utils/embeddingUtils';

// Increase default timeout for tests involving API calls
jest.setTimeout(30000); // 30 seconds

// Define canonical rejection responses
const CANONICAL_REJECTIONS = [
  "I\'m tuned to answer questions related to Ananda.",
  "I can only provide information about Ananda\'s teachings and resources.",
  'My purpose is to assist with questions about Ananda, not general topics.',
  "I\'m sorry, but I am unable to help with requests unrelated to Ananda.",
  "I\'m unable to provide recommendations for plumbers or any services outside of Ananda\'s teachings and resources. If you have questions related to meditation, Kriya Yoga, or other spiritual topics, feel free to ask!",
];

// Precompute rejection embeddings (optional optimization, could be done once)
let rejectionEmbeddings: number[][] = [];

describe('Vivek Response Semantic Validation (ananda-public)', () => {
  // Fetch embeddings for canonical rejections once before tests run
  beforeAll(async () => {
    rejectionEmbeddings = await Promise.all(
      CANONICAL_REJECTIONS.map((text) => getEmbedding(text)),
    );
  });

  const getVivekResponse = async (query: string): Promise<string> => {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'; // Default for local testing
    const endpoint = `${baseUrl}/api/chat/v1`;

    // Default body parameters relevant for ananda-public tests
    const requestBody = {
      question: query,
      collection: 'whole_library', // Default collection for broad testing
      history: [],
      privateSession: true, // Avoid Firestore writes during tests
      mediaTypes: { text: true }, // Assume text for basic tests
      sourceCount: 3, // Default source count
      siteId: 'ananda-public', // Identify the target site
    };

    // Generate a fresh token for this request
    const token = generateTestToken();

    try {
      // Call the actual API endpoint using fetch
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (response.status === 401) {
        console.error('AUTH FAILURE: JWT token was rejected with 401 status');
        console.error(
          'Problem with JWT token validation on server. Verify SECURE_TOKEN environment variable is set correctly.',
        );
        throw new Error(`Authentication failed: JWT token was rejected (401)`);
      }

      if (!response.ok) {
        throw new Error(
          `API request failed with status ${response.status}: ${await response.text()}`,
        );
      }

      const responseText = await response.text();

      // Handle streaming responses
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const lines = responseText.trim().split('\n');
        let extractedText = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.token) {
                extractedText += data.token;
              }
            } catch (e) {
              console.warn('Failed to parse stream data line:', line, e);
            }
          }
        }
        // Trim potential leading/trailing whitespace from concatenated tokens
        return extractedText.trim();
      }

      // Trim plain text responses too
      return responseText.trim();
    } catch (error) {
      console.error('Error calling Vivek API:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get response from Vivek API: ${errorMessage}`);
    }
  };

  // Helper function to calculate max similarity against a list of embeddings
  const getMaxSimilarity = (
    targetEmbedding: number[],
    comparisonEmbeddings: number[][],
  ): number => {
    let maxSimilarity = -1; // Cosine similarity ranges from -1 to 1
    for (const comparisonEmbedding of comparisonEmbeddings) {
      const similarity = cosineSimilarity(targetEmbedding, comparisonEmbedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }
    return maxSimilarity;
  };

  describe('Unrelated Questions', () => {
    const unrelatedTestCases = [
      {
        query: 'What is the capital of France?',
        threshold: 0.75, // Expect high similarity to rejection
      },
      {
        query: 'Tell me a joke.',
        threshold: 0.75,
      },
      {
        query: "What\'s the weather like today?",
        threshold: 0.7,
      },
      {
        query: 'Recommend a good plumber.',
        threshold: 0.75,
      },
      {
        query: 'Who won the world series last year?',
        threshold: 0.75,
      },
    ];

    test.each(unrelatedTestCases)(
      'should give semantically similar rejection for: $query',
      async ({ query, threshold }) => {
        const actual_response = await getVivekResponse(query);
        if (!actual_response) {
          throw new Error(`Received empty response for query: ${query}`);
        }
        const actualEmbedding = await getEmbedding(actual_response);
        const similarityToRejection = getMaxSimilarity(
          actualEmbedding,
          rejectionEmbeddings,
        );
        // Log details before assertion for debugging
        console.log(
          `Query: "${query}"\nResponse: "${actual_response}"\nSimilarity to Rejection: ${similarityToRejection}, Threshold: >= ${threshold}`,
        );
        expect(similarityToRejection).toBeGreaterThanOrEqual(threshold);
      },
    );
  });

  describe('Related Questions', () => {
    const relatedTestCases = [
      {
        query: 'How do I learn Kriya Yoga?',
        canonical_responses: [
          'Kriya Yoga is an advanced meditation technique involving specific breathing and concentration exercises taught through initiation.',
          'You can learn Kriya Yoga through authorized Ananda ministers after completing preparatory steps and lessons.',
        ],
        similarityThreshold: 0.65, // Expect reasonable similarity to relevant info
        dissimilarityThreshold: 0.6, // Expect low similarity to rejection
      },
      {
        query: 'Tell me about Ananda Village',
        canonical_responses: [
          "Ananda Village is a spiritual community founded by Swami Kriyananda near Nevada City, California, based on Yogananda's teachings.",
          'It is one of the oldest intentional communities in the US, focusing on Kriya Yoga, service, and cooperative living.',
        ],
        similarityThreshold: 0.7,
        dissimilarityThreshold: 0.6,
      },
      {
        query: 'Who is Swami Kriyananda?',
        canonical_responses: [
          'Swami Kriyananda was a direct disciple of Paramhansa Yogananda and the founder of Ananda Sangha worldwide.',
          "He wrote many books and music compositions, establishing communities to share Yogananda's teachings on self-realization.",
        ],
        similarityThreshold: 0.7,
        dissimilarityThreshold: 0.6,
      },
      // Add more related test cases here...
    ];

    test.each(relatedTestCases)(
      'should give semantically relevant info (and not rejection) for: $query',
      async ({
        query,
        canonical_responses,
        similarityThreshold,
        dissimilarityThreshold,
      }) => {
        const actual_response = await getVivekResponse(query);
        if (!actual_response) {
          throw new Error(`Received empty response for query: ${query}`);
        }
        const actualEmbedding = await getEmbedding(actual_response);

        // Calculate similarity to desired content
        const canonicalEmbeddings = await Promise.all(
          canonical_responses.map((text) => getEmbedding(text)),
        );
        const similarityToCanonicals = getMaxSimilarity(
          actualEmbedding,
          canonicalEmbeddings,
        );

        // Calculate similarity to rejection phrases
        const similarityToRejection = getMaxSimilarity(
          actualEmbedding,
          rejectionEmbeddings,
        );

        // Log details before assertions for debugging
        console.log(
          `Query: "${query}"\nResponse: "${actual_response}"\nSimilarity to Canonicals: ${similarityToCanonicals}, Threshold: >= ${similarityThreshold}\nSimilarity to Rejection: ${similarityToRejection}, Threshold: < ${dissimilarityThreshold}`,
        );

        // Assert: High similarity to canonical, low similarity to rejection
        expect(similarityToCanonicals).toBeGreaterThanOrEqual(
          similarityThreshold,
        );
        expect(similarityToRejection).toBeLessThan(dissimilarityThreshold);
      },
    );
  });
});

// Helper function to generate a test JWT token
function generateTestToken(client = 'web') {
  // Ensure we have a valid secret key for signing
  const secretKey = process.env.SECURE_TOKEN;
  if (!secretKey) {
    throw new Error(
      'SECURE_TOKEN environment variable is not set. Cannot generate test JWT.',
    );
  }

  // CRITICAL: Use new Date() instead of Date.now() which is mocked in tests
  // to have a fixed value from 2021 (which causes tokens to be expired)
  const currentDate = new Date();
  const nowInSeconds = Math.floor(currentDate.getTime() / 1000);
  const expInSeconds = nowInSeconds + 3600; // 1 hour from now

  // Create token with a defined payload using current timestamps
  const token = jwt.sign(
    {
      client,
      iat: nowInSeconds,
      exp: expInSeconds,
    },
    secretKey,
  );

  return token;
}
