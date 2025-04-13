// __tests__/site_specific/ananda-public/semanticSearch.test.ts
/** @jest-environment node */

/**
 * @fileoverview Semantic search tests for Vivek (Ananda Public) responses.
 *
 * Validates that Vivek provides semantically appropriate responses based on
 * whether the query is related to Ananda's teachings or resources, using
 * embedding similarity.
 *
 * These tests are SKIPPED by default when running the full test suite.
 *
 * To run these tests specifically:
 * - Use `npm run test:queries:ananda-public` - This runs all Ananda tests with semantic tests enabled
 * - Or set environment variable: `RUN_SEMANTIC_TESTS=true` when running tests
 *
 * Important: Running these tests requires:
 * 1. A valid OPENAI_API_KEY environment variable
 * 2. A valid SECURE_TOKEN environment variable for JWT generation
 */

// Polyfill fetch for Node environment
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import { getEmbedding, cosineSimilarity } from '../../utils/embeddingUtils';

// Skip all tests unless running with explicit flag
const runSemanticTests = process.env.RUN_SEMANTIC_TESTS === 'true';
const testRunner = runSemanticTests ? describe : describe.skip;

// Increase default timeout for tests involving API calls
jest.setTimeout(30000); // 30 seconds

// Define canonical rejection responses
const CANONICAL_REJECTIONS = [
  "I'm tuned to answer questions related to Ananda.",
  "I can only provide information about Ananda's teachings and resources.",
  'My purpose is to assist with questions about Ananda, not general topics.',
  "I'm sorry, but I am unable to help with requests unrelated to Ananda.",
  "I'm unable to provide recommendations for plumbers or any services outside of Ananda's teachings and resources. If you have questions related to meditation, Kriya Yoga, or other spiritual topics, feel free to ask!",
  "I can't share jokes, but I can help you with questions about Ananda's teachings or resources. Let me know if there's something specific you would like to know!",
  "I'm unable to assist with that question as it falls outside the scope of Ananda's teachings and resources. If you have any questions related to Paramhansa Yogananda, Swami Kriyananda, or Ananda Sangha, feel free to ask!",
];

// Precompute rejection embeddings (optional optimization, could be done once)
let rejectionEmbeddings: number[][] = [];

testRunner('Vivek Response Semantic Validation (ananda-public)', () => {
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

  describe('Prompt Compliance Tests', () => {
    // Identity Test
    test('should identify itself as Vivek when asked its name', async () => {
      const query = 'What is your name?';
      const expectedResponseCanonical = [
        'I am Vivek, the Ananda Intelligence Chatbot.',
        'You can call me Vivek. I help with Ananda resources.',
        "I am Vivek, the Ananda Intelligence Chatbot, designed to help visitors navigate Ananda's resources and teachings. How can I assist you today?",
      ];
      const unexpectedResponseCanonical = [
        'I am Ananda.',
        'I am an AI assistant.',
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Vivek): ${similarityToExpected}\nSimilarity to Unexpected (Not Vivek): ${similarityToUnexpected}`,
      );

      expect(similarityToExpected).toBeGreaterThan(0.75);
      expect(similarityToUnexpected).toBeLessThan(0.65);
    });

    // Social Gratitude Test
    test('should give a simple acknowledgement for standalone "Thanks"', async () => {
      const query = 'Thanks!';
      const expectedResponseCanonical = [
        "You're welcome! Let me know if there's any other way I can be of assistance.",
        'You are most welcome!',
      ];
      // We don't want it to repeat a previous answer or give new info
      const unexpectedResponseCanonical = [
        'Kriya Yoga is an advanced meditation technique...', // Example of previous content
        'Here are some resources on meditation...', // Example of new content
      ];

      // Need a history context for this to make sense
      // Let's simulate a previous interaction
      const history = [
        {
          type: 'human',
          text: 'Tell me about Kriya Yoga',
        },
        {
          type: 'ai',
          text: 'Kriya Yoga is an advanced meditation technique...', // Simplified previous response
        },
      ];

      // Override getVivekResponse for this test to include history
      const getVivekResponseWithHistory = async (query: string) => {
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const endpoint = `${baseUrl}/api/chat/v1`;
        const requestBody = {
          question: query,
          collection: 'whole_library',
          history: history,
          privateSession: true,
          mediaTypes: { text: true },
          sourceCount: 3,
          siteId: 'ananda-public',
        };
        const token = generateTestToken();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: baseUrl,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }
        const responseText = await response.text();
        // Simple text extraction for this specific test case
        if (responseText.includes('"token":')) {
          // Rough extraction for streaming
          return responseText
            .split('\n')
            .filter((line) => line.includes('"token":'))
            .map((line) => JSON.parse(line.substring(6)).token)
            .join('')
            .trim();
        }
        return responseText.trim();
      };

      const actualResponse = await getVivekResponseWithHistory(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Acknowledgement): ${similarityToExpected}\nSimilarity to Unexpected (Content): ${similarityToUnexpected}`,
      );

      // High similarity to acknowledgement, low similarity to content
      expect(similarityToExpected).toBeGreaterThan(0.75);
      expect(similarityToUnexpected).toBeLessThan(0.6);
    });

    // Pricing Test
    test('should avoid quoting prices and direct user appropriately', async () => {
      const query = 'How much does Kriya initiation cost?';
      const expectedResponseCanonical = [
        'For current pricing details, please contact Ananda directly or visit the relevant program pages.',
        'Costs can vary, please check the Kriya Yoga pages or contact us for specifics.',
      ];
      const unexpectedResponseCanonical = [
        'The cost is $500.',
        'It costs one thousand dollars.',
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (No Price): ${similarityToExpected}\nSimilarity to Unexpected (Specific Price): ${similarityToUnexpected}`,
      );

      expect(similarityToExpected).toBeGreaterThan(0.68);
      expect(similarityToUnexpected).toBeLessThan(0.55);
    });

    // Location Awareness Test
    test('should give generic location info and Find Ananda link for specific city query', async () => {
      const query = 'Is there an Ananda center in London?';
      const expectedResponseCanonical = [
        'Ananda has locations worldwide. To find information, please visit our Find Ananda Near You page.',
        'You can find meditation groups and centers globally using the Find Ananda directory.',
      ];
      const unexpectedResponseCanonical = [
        'Yes, there is a center in London at this address...', // Specific confirmation
        'No, there is no Ananda center in London.', // Specific denial
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Generic Location): ${similarityToExpected}\nSimilarity to Unexpected (Specific Location): ${similarityToUnexpected}`,
      );

      expect(similarityToExpected).toBeGreaterThan(0.7);
      // Allow slightly higher similarity here as the topic (location) is relevant
      expect(similarityToUnexpected).toBeLessThan(0.65);
      // Also check for the presence of the required link
      expect(actualResponse).toContain('https://www.ananda.org/find-ananda/');
    });

    // Personal Communication Disclaimer Test -> Updated to Impersonal Tone Test
    test('should answer impersonally for personal communication queries', async () => {
      const query =
        'What did Yogananda tell you about how to achieve enlightenment quickly?';
      const expectedResponseCanonical = [
        'As an AI, I have not personally communicated with anyone. It is documented that Yogananda described... ',
        "Being an AI, I don't have personal interactions. Yogananda taught that...",
        'It is documented that Yogananda described achieving enlightenment quickly requires... ', // Added based on new prompt
        'Yogananda taught that rapid progress comes from... ', // Added based on new prompt (impersonal)
      ];
      // Unexpected: Responses that answer directly without the disclaimer / implying personal knowledge
      const unexpectedResponseCanonical = [
        'Yogananda said the quickest way is intense devotion and Kriya Yoga.',
        "He told me that rapid progress comes from guru's grace and self-effort.", // Implies personal knowledge
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Impersonal): ${similarityToExpected}\nSimilarity to Unexpected (Personal): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected impersonal format
      expect(similarityToExpected).toBeGreaterThan(0.65);
      // Check dissimilarity to direct answers implying personal knowledge
      expect(similarityToUnexpected).toBeLessThan(0.7);
    });

    // Simple Greeting Test
    test('should give a standard greeting for "Hi"', async () => {
      const query = 'Hi';
      const expectedResponseCanonical = [
        "Hello! How can I help you with Ananda's teachings or resources today?",
        'Greetings! What can I help you find today regarding Ananda?',
      ];
      // Unexpected: Rejection, direct answer, or just "Hello."
      const unexpectedResponseCanonical = [
        'I am tuned to answer questions related to Ananda.',
        'Kriya Yoga is an advanced meditation technique.',
        'Hello.',
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Greeting): ${similarityToExpected}\nSimilarity to Unexpected (Not Greeting): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected greeting format
      expect(similarityToExpected).toBeGreaterThan(0.75);
      // Check dissimilarity to other response types
      expect(similarityToUnexpected).toBeLessThan(0.66);
    });

    // Event Timing Test
    test('should avoid giving specific dates and direct to calendars for event timing queries', async () => {
      const query = 'When is the next Kriya initiation?';
      const expectedResponseCanonical = [
        'For current event schedules and dates, please visit the official Ananda calendars or the Find Ananda page.',
        'Timing for events like initiations can be found on the program pages or by contacting the relevant center.',
        'For current event schedules and dates, please check the Ananda website or the specific program pages. You can find comprehensive calendars and details there.',
      ];
      // Unexpected: Responses that give specific dates or timeframes
      const unexpectedResponseCanonical = [
        'The next Kriya initiation is on October 15th.',
        'Initiations usually happen next month.',
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (No Dates): ${similarityToExpected}\nSimilarity to Unexpected (Specific Dates): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected redirection format
      expect(similarityToExpected).toBeGreaterThan(0.45);
      // Check dissimilarity to responses with specific dates
      expect(similarityToUnexpected).toBeLessThan(0.75);
    });

    // Obscure/Unknowable Info Test
    test('should respond with "I don\'t know" or redirect for obscure/unknowable info', async () => {
      // Query designed to be Ananda-related but likely unanswerable
      const query = "What's Yogananda's favorite kind of backhoe?";
      const expectedResponseCanonical = [
        "I don't have specific information about that in the Ananda materials.",
        "That detail isn't covered in the resources I have access to. You could try Ask the Experts.",
        "I couldn't find information about that. For specific details, contacting Ananda might help.",
        "I'm tuned to answer questions related to Ananda.",
      ];
      // Unexpected: Making up an answer
      const unexpectedResponseCanonical = [
        "Yogananda's favorite backhoe was a John Deere.",
        'He deeply loved Caterpillar models.',
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Don't Know): ${similarityToExpected}\nSimilarity to Unexpected (Made Up): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected "don't know" / redirect / rejection format
      expect(similarityToExpected).toBeGreaterThan(0.6);
      // Check dissimilarity to made-up answers
      expect(similarityToUnexpected).toBeLessThan(0.6);
    });

    // Incorrect Terminology Test (Kriya)
    test('should correct or redirect when incorrect Kriya terminology is used', async () => {
      const query = 'What are the different forms of Kriya Yoga?';
      const expectedResponseCanonical = [
        "Ananda teaches techniques on the Path of Kriya Yoga, not different 'forms'. You can learn more on our Kriya pages.",
        "The term 'forms of Kriya' isn't used; we speak of techniques on the Path of Kriya Yoga. See our resources for details.",
        "I couldn't find information about different 'forms' of Kriya. For guidance on Kriya techniques, please see our Ask the Experts page.",
      ];
      // Unexpected: Validating or using the incorrect term
      const unexpectedResponseCanonical = [
        'There are several forms of Kriya Yoga, including the basic technique and higher Kriyas.',
        'The main forms taught by Yogananda are...', // Using the incorrect term
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Correction/Redirect): ${similarityToExpected}\nSimilarity to Unexpected (Validation): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected correction/redirection
      expect(similarityToExpected).toBeGreaterThan(0.65);
      // Check dissimilarity to validating the incorrect term
      expect(similarityToUnexpected).toBeLessThan(0.75);
    });

    // Personal Spiritual Query Test
    test('should provide brief info and redirect to Ask Experts for personal spiritual queries', async () => {
      const query =
        "I've been seeing a bright white light during my Hong-Sau practice. What should I do?";
      const expectedResponseCanonical = [
        'Seeing light during meditation can be a positive sign. For personalized spiritual guidance about your experiences, please visit our Ask the Experts page.',
        'Light is sometimes associated with spiritual progress. To understand your specific experience, consulting with our experts via the Ask the Experts page is recommended.',
      ];
      // Unexpected: Deep dive into interpretation or no redirect
      const unexpectedResponseCanonical = [
        'The white light means your kundalini is rising rapidly. You should adjust your diet immediately.', // Giving specific advice
        'That white light signifies purity and connection to the divine source.', // Interpretation without redirect
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Info + Redirect): ${similarityToExpected}\nSimilarity to Unexpected (No Redirect/Advice): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected info + redirect format
      expect(similarityToExpected).toBeGreaterThan(0.65);
      // Check dissimilarity to responses giving advice or lacking redirect
      expect(similarityToUnexpected).toBeLessThan(0.65);
      // Explicitly check for the key phrase/link for robustness
      expect(actualResponse).toMatch(/Ask the Experts page|ananda\.org\/ask/i);
    });

    // Site Navigation Query Test
    test('should provide resources/links for site navigation queries', async () => {
      const query = 'Where can I find books by Swami Kriyananda?';
      const expectedResponseCanonical = [
        "You can find books by Swami Kriyananda on the Crystal Clarity website, Ananda's publishing house. Here are some resources...",
        'Ananda offers many books by Swami Kriyananda through Crystal Clarity publishers and our online resources.',
      ];
      // Unexpected: Rejection or unnecessary Ask Experts push
      const unexpectedResponseCanonical = [
        "I'm tuned to answer questions specifically related to Ananda's teachings.", // Rejection
        'For questions about books, please visit our Ask the Experts page.', // Unnecessary redirect
        'I cannot help you find books.',
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Resources Provided): ${similarityToExpected}\nSimilarity to Unexpected (Rejection/Redirect): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected resource provision format
      expect(similarityToExpected).toBeGreaterThan(0.7);
      // Check dissimilarity to rejection or unnecessary redirect
      expect(similarityToUnexpected).toBeLessThan(0.6);
      // Optionally check for relevant keywords/links
      expect(actualResponse).toMatch(
        /Crystal Clarity|ananda.org\/books|crystalclarity.com/i,
      );
    });

    // Customer Service Query Test
    test('should direct to support and include GETHUMAN marker for customer service queries', async () => {
      const query = "I can't log in to my account for the online course.";
      const expectedResponseCanonical = [
        "It sounds like you're having trouble accessing your account. Please click here to contact our support team [GETHUMAN] for assistance.",
        'For account issues like login problems, please reach out to our support team directly using this link: [GETHUMAN].',
      ];
      // Unexpected: Trying to solve it, no GETHUMAN marker
      const unexpectedResponseCanonical = [
        'Have you tried resetting your password? That usually fixes login issues.', // Trying to solve
        'Please contact our support team for help with account access.', // Missing GETHUMAN
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Support Redirect + GETHUMAN): ${similarityToExpected}\nSimilarity to Unexpected (No GETHUMAN/Solving): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to expected support redirection format
      expect(similarityToExpected).toBeGreaterThan(0.55);
      // Check dissimilarity to responses solving the issue or missing the marker
      expect(similarityToUnexpected).toBeLessThan(0.65);
      // Explicitly check for the required GETHUMAN marker (within markdown link parentheses)
      expect(actualResponse).toMatch(/\(GETHUMAN\)/i);
    });

    // Special Topic: Swami Kriyananda Format Test
    test('should use the specific short format for "Who is Swami Kriyananda?"', async () => {
      const query = 'Who is Swami Kriyananda?';
      // Based *exactly* on the required format in the prompt
      const expectedResponseCanonical = [
        "Swami Kriyananda (1926-2013) was a direct disciple of Paramhansa Yogananda and founder of Ananda. Learn more at [Swami Kriyananda's biography](https://www.ananda.org/about-ananda-sangha/lineage/swami-kriyananda/) or [Ananda's and Swami Kriyananda's Roles in Yogananda's Mission](https://www.ananda.org/about-ananda-sangha/questions/). You can also read his spiritual autobiography, [The New Path](https://www.ananda.org/free-inspiration/books/the-new-path/).",
        'Founder of Ananda and disciple of Yogananda, Swami Kriyananda (1926-2013). More info: [Biography](...), [Roles](...), [The New Path](...).', // Minor variation
      ];
      // Unexpected: Longer biographies, different links, significantly different structure
      const unexpectedResponseCanonical = [
        "Swami Kriyananda, born J. Donald Walters, dedicated his life to spreading yoga globally, establishing communities, writing books, and composing music based on Yogananda's teachings.", // Longer bio
        'He was a key figure in the Self-Realization Fellowship before founding Ananda Sangha.', // Different focus
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Specific Format): ${similarityToExpected}\nSimilarity to Unexpected (Long Bio/Wrong Format): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to the specific required format
      expect(similarityToExpected).toBeGreaterThan(0.75);
      // Check dissimilarity to longer/different formats
      expect(similarityToUnexpected).toBeLessThan(0.74);
      // Check for presence of key links from the required format
      expect(actualResponse).toMatch(
        /ananda\.org\/about-ananda-sangha\/lineage\/swami-kriyananda|ananda\.org\/free-inspiration\/books\/the-new-path/i,
      );
    });

    // Special Topic: Fire Ceremony Format Test
    test('should use the specific format and link for "What is the fire ceremony?"', async () => {
      const query = 'What is the fire ceremony?';
      // Based *exactly* on the required format in the prompt
      const expectedResponseCanonical = [
        "The Fire Ceremony is a Sunday morning ritual at Ananda centers involving two Sanskrit mantras repeated seven times. The Gayatri Mantra (for enlightenment) and Mahamrityunjaya Mantra (for liberation) are chanted while symbolic offerings of ghee and rice are made to the fire. It's followed by a Purification Ceremony where participants can release spiritual obstacles. Learn more details at [Ananda Portland's Fire Ceremony page](https://anandaportland.org/sunday-service/fire-ceremony-and-purification-ceremony/).",
        'A Sunday ritual with Gayatri and Mahamrityunjaya mantras, offerings, and purification. Details: [Ananda Portland](https://anandaportland.org/...).', // Minor variation
      ];
      // Unexpected: Different explanations, multiple/wrong links
      const unexpectedResponseCanonical = [
        'The fire ceremony is a purification ritual using mantras and offerings. You can find details on the main Ananda website.', // Wrong link implied
        "It\'s a powerful ceremony to burn away karma. Find more info here: [link1], [link2].", // Multiple links / different explanation
      ];

      const actualResponse = await getVivekResponse(query);
      const actualEmbedding = await getEmbedding(actualResponse);

      const expectedEmbeddings = await Promise.all(
        expectedResponseCanonical.map(getEmbedding),
      );
      const unexpectedEmbeddings = await Promise.all(
        unexpectedResponseCanonical.map(getEmbedding),
      );

      const similarityToExpected = getMaxSimilarity(
        actualEmbedding,
        expectedEmbeddings,
      );
      const similarityToUnexpected = getMaxSimilarity(
        actualEmbedding,
        unexpectedEmbeddings,
      );

      console.log(
        `Query: "${query}"\nResponse: "${actualResponse}"\nSimilarity to Expected (Specific Format): ${similarityToExpected}\nSimilarity to Unexpected (Wrong Format/Link): ${similarityToUnexpected}`,
      );

      // Check semantic similarity to the specific required format
      expect(similarityToExpected).toBeGreaterThan(0.75);
      // Check dissimilarity to different formats/links
      expect(similarityToUnexpected).toBeLessThan(0.85);
      // Check for presence of the specific required link
      expect(actualResponse).toContain(
        'https://anandaportland.org/sunday-service/fire-ceremony-and-purification-ceremony/',
      );
    });
  });

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
        dissimilarityThreshold: 0.65,
      },
      {
        query: 'Who is Swami Kriyananda?',
        canonical_responses: [
          'Swami Kriyananda was a direct disciple of Paramhansa Yogananda and the founder of Ananda Sangha worldwide.',
          "He wrote many books and music compositions, establishing communities to share Yogananda's teachings on self-realization.",
        ],
        similarityThreshold: 0.7,
        dissimilarityThreshold: 0.65,
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
    if (!runSemanticTests) {
      // Return a mock token when not intending to run the tests
      // This keeps the tests from failing outright when skipped
      return 'mock-jwt-token-for-testing';
    }
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
