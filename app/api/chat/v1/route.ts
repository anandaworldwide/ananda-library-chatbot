/**
 * This file implements a custom chat route for handling streaming responses on Vercel production.
 *
 * Core functionality:
 * - Handles both standard chat and model comparison requests
 * - Implements server-sent events (SSE) for real-time streaming
 * - Manages rate limiting per user/IP
 * - Validates and sanitizes all inputs
 * - Integrates with Pinecone for vector search
 * - Supports filtering by media type and collection
 * - Optional response persistence to Firestore
 *
 * Request flow:
 * 1. Input validation and sanitization
 * 2. Rate limit checking
 * 3. Pinecone setup with filters (media type, collection, library)
 * 4. Vector store and retriever initialization
 * 5. LLM chain execution with streaming
 * 6. Optional response saving to Firestore
 *
 * Error handling:
 * - Handles Pinecone connection issues
 * - Manages OpenAI rate limits and quotas
 * - Validates JSON structure and input lengths
 * - Provides detailed error messages for debugging
 *
 * Security features:
 * - JWT authentication for secure API access
 * - XSS prevention through input sanitization
 * - Rate limiting per IP
 * - Input length restrictions
 * - Collection access validation
 *
 * Performance considerations:
 * - Uses streaming to reduce time-to-first-token
 * - Concurrent document retrieval and response generation
 * - Efficient filter application at the vector store level
 */

// Custom route required for Vercel production streaming support
// See: https://vercel.com/docs/functions/streaming/quickstart
//
// TODO: wrap this in apiMiddleware
//
import { NextRequest, NextResponse } from 'next/server';
import { Document } from 'langchain/document';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import {
  makeChain,
  setupAndExecuteLanguageModelChain,
  makeComparisonChains,
} from '@/utils/server/makechain';
import { getCachedPineconeIndex } from '@/utils/server/pinecone-client';
import { getPineconeIndexName } from '@/config/pinecone';
import * as fbadmin from 'firebase-admin';
import { db } from '@/services/firebase';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import { Index, RecordMetadata } from '@pinecone-database/pinecone';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { loadSiteConfigSync } from '@/utils/server/loadSiteConfig';
import validator from 'validator';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';
import { SiteConfig } from '@/types/siteConfig';
import { StreamingResponseData } from '@/types/StreamingResponseData';
import { getClientIp } from '@/utils/server/ipUtils';
import { isDevelopment } from '@/utils/env';
import { withAppRouterJwtAuth } from '@/utils/server/appRouterJwtUtils';
import { JwtPayload } from '@/utils/server/jwtUtils';
import { ChatMessage, convertChatHistory } from '@/utils/shared/chatHistory';

export const runtime = 'nodejs';
export const maxDuration = 240;

interface MediaTypes {
  text?: boolean;
  image?: boolean;
  video?: boolean;
  audio?: boolean;
  [key: string]: boolean | undefined;
}

// Add timing interface
interface TimingMetrics {
  startTime: number;
  pineconeSetupComplete?: number;
  firstTokenGenerated?: number;
  firstByteTime?: number;
  totalTokens?: number;
  tokensPerSecond?: number;
  totalTime?: number;
}

interface ChatRequestBody {
  question: string;
  history?: ChatMessage[];
  collection?: string;
  privateSession?: boolean;
  mediaTypes?: Partial<MediaTypes>;
  sourceCount?: number;
  siteId?: string;
}

interface ComparisonRequestBody extends ChatRequestBody {
  modelA: string;
  modelB: string;
  temperatureA: number;
  temperatureB: number;
  useExtraSources: boolean;
  sourceCount: number;
}

// Define a minimal type that matches PineconeStore.fromExistingIndex expectations
type PineconeStoreOptions = {
  pineconeIndex: Index<RecordMetadata>;
  textKey: string;
  // We omit filter since we're handling it at runtime
};

// Helper function to check if a string matches a pattern with wildcards
function matchesPattern(origin: string, pattern: string): boolean {
  // Extract domain from origin (remove protocol)
  const originDomain = origin.replace(/^https?:\/\//, '');

  // Escape special regex characters but not the asterisk
  const escapedPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*');
  const regex = new RegExp(`^${escapedPattern}$`, 'i');

  // Check if the domain part (without protocol) matches the pattern
  return regex.test(originDomain);
}

// Middleware to handle CORS
function handleCors(req: NextRequest, siteConfig: SiteConfig) {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // If no origin header, allow the request (likely a server-side or direct API call)
  if (!origin) {
    // Check if this is a WordPress request (might use Referer instead of Origin)
    if (
      isDevelopment() &&
      referer &&
      (referer.includes('.local') ||
        referer.includes('localhost') ||
        referer.includes('wordpress'))
    ) {
      console.log(`Allowing request with referer: ${referer}`);
      return null;
    }
    return null;
  }

  // Allow localhost and *.local domains only in development
  if (
    isDevelopment() &&
    (origin.startsWith('http://localhost:') ||
      origin === 'http://localhost' ||
      origin.match(/^https?:\/\/[^.]+\.local(:\d+)?$/))
  ) {
    return null;
  }

  // Check against allowedFrontEndDomains from site config
  const allowedDomains = siteConfig.allowedFrontEndDomains || [];

  console.log(`Checking CORS for origin: ${origin}`);
  console.log(`Allowed domains:`, allowedDomains);

  for (const pattern of allowedDomains) {
    console.log(`Testing pattern: ${pattern} against origin: ${origin}`);
    if (matchesPattern(origin, pattern)) {
      console.log(
        `CORS allowed for origin: ${origin} matching pattern: ${pattern}`,
      );
      return null; // Origin is allowed
    }
  }

  // If we get here, the origin is not allowed
  console.warn(`CORS blocked request from origin: ${origin}`);
  return NextResponse.json(
    { error: 'CORS policy: No access from this origin' },
    { status: 403 },
  );
}

// Function to add CORS headers to responses for allowed origins
function addCorsHeaders(
  response: NextResponse,
  req: NextRequest,
  siteConfig: SiteConfig,
): NextResponse {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // If no origin, check if it's a WordPress request using Referer
  if (
    !origin &&
    isDevelopment() &&
    referer &&
    (referer.includes('.local') ||
      referer.includes('localhost') ||
      referer.includes('wordpress'))
  ) {
    // For WordPress requests without origin, use a wildcard or extract domain from referer
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    response.headers.set('Access-Control-Allow-Credentials', 'false'); // Must be false when using wildcard origin
    return response;
  }

  // If no origin and not a WordPress request, no need to add CORS headers
  if (!origin) {
    return response;
  }

  // Check if origin is allowed
  const isLocalDev =
    isDevelopment() &&
    (origin.startsWith('http://localhost:') ||
      origin === 'http://localhost' ||
      origin.match(/^https?:\/\/[^.]+\.local(:\d+)?$/));
  const allowedDomains = siteConfig.allowedFrontEndDomains || [];
  const isAllowedDomain = allowedDomains.some((pattern) =>
    matchesPattern(origin, pattern),
  );

  // If origin is allowed, add CORS headers
  if (isLocalDev || isAllowedDomain) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return response;
}

async function validateAndPreprocessInput(
  req: NextRequest,
  siteConfig: SiteConfig,
): Promise<
  | {
      sanitizedInput: ChatRequestBody;
      originalQuestion: string;
    }
  | NextResponse
> {
  // Parse and validate request body
  let requestBody: ChatRequestBody;
  try {
    requestBody = await req.json();
  } catch (error) {
    console.error('Error parsing request body:', error);
    console.log('Raw request body:', await req.text());
    const response = NextResponse.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 },
    );
    return addCorsHeaders(response, req, siteConfig);
  }

  const { collection, question } = requestBody;

  // Validate question length
  if (
    typeof question !== 'string' ||
    !validator.isLength(question, { min: 1, max: 4000 })
  ) {
    const response = NextResponse.json(
      { error: 'Invalid question. Must be between 1 and 4000 characters.' },
      { status: 400 },
    );
    return addCorsHeaders(response, req, siteConfig);
  }

  const originalQuestion = question;
  // Sanitize the input to prevent XSS attacks
  const sanitizedQuestion = validator
    .escape(question.trim())
    .replaceAll('\n', ' ');

  // Validate collection
  if (
    typeof collection !== 'string' ||
    !['master_swami', 'whole_library'].includes(collection)
  ) {
    const response = NextResponse.json(
      { error: 'Invalid collection provided' },
      { status: 400 },
    );
    return addCorsHeaders(response, req, siteConfig);
  }

  return {
    sanitizedInput: {
      ...requestBody,
      question: sanitizedQuestion,
    },
    originalQuestion,
  };
}

async function applyRateLimiting(
  req: NextRequest,
  siteConfig: SiteConfig,
): Promise<NextResponse | null> {
  const isAllowed = await genericRateLimiter(
    req,
    null,
    {
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
      max: isDevelopment()
        ? siteConfig.queriesPerUserPerDay * 10
        : siteConfig.queriesPerUserPerDay,
      name: 'query',
    },
    req.ip,
  );

  if (!isAllowed) {
    const response = NextResponse.json(
      { error: 'Daily query limit reached. Please try again tomorrow.' },
      { status: 429 },
    );
    return addCorsHeaders(response, req, siteConfig);
  }

  return null; // Rate limiting passed
}

// Define a custom type for our filter structure
type PineconeFilter = {
  $and: Array<{
    [key: string]: {
      $in: string[];
    };
  }>;
};

async function setupPineconeAndFilter(
  collection: string,
  mediaTypes: Record<string, boolean>,
  siteConfig: SiteConfig,
): Promise<{ index: Index<RecordMetadata>; filter: PineconeFilter }> {
  const startTime = Date.now();

  // Use cached Pinecone index instead of creating a new one each time
  const indexName = getPineconeIndexName() || '';
  const index = (await getCachedPineconeIndex(
    indexName,
  )) as Index<RecordMetadata>;

  const filter: PineconeFilter = {
    $and: [{ type: { $in: [] } }],
  };

  if (
    collection === 'master_swami' &&
    siteConfig.collectionConfig?.master_swami
  ) {
    filter.$and.push({
      author: { $in: ['Paramhansa Yogananda', 'Swami Kriyananda'] },
    });
  }

  // Apply library filter only if includedLibraries is non-empty
  if (siteConfig.includedLibraries && siteConfig.includedLibraries.length > 0) {
    const libraryNames = siteConfig.includedLibraries.map((lib) =>
      typeof lib === 'string' ? lib : lib.name,
    );
    filter.$and.push({ library: { $in: libraryNames } });
  }

  const enabledMediaTypes = siteConfig.enabledMediaTypes || [
    'text',
    'audio',
    'youtube',
  ];
  enabledMediaTypes.forEach((type) => {
    if (mediaTypes[type]) {
      filter.$and[0].type.$in.push(type);
    }
  });
  if (filter.$and[0].type.$in.length === 0) {
    filter.$and[0].type.$in = enabledMediaTypes;
  }

  const setupTime = Date.now() - startTime;
  if (setupTime > 50) {
    // Only log if it takes longer than 50ms
    console.log(`Pinecone setup completed in ${setupTime}ms`);
  }

  return { index, filter };
}

async function setupVectorStoreAndRetriever(
  index: Index<RecordMetadata>,
  filter: PineconeFilter | undefined,
  sendData: (data: StreamingResponseData) => void,
  sourceCount: number = 4,
): Promise<{
  vectorStore: PineconeStore;
  retriever: ReturnType<PineconeStore['asRetriever']>;
  documentPromise: Promise<Document[]>;
  resolveWithDocuments: (docs: Document[]) => void;
}> {
  // Create the promise and resolver in a way that TypeScript understands
  let resolveWithDocuments!: (docs: Document[]) => void;
  const documentPromise = new Promise<Document[]>((resolve) => {
    resolveWithDocuments = resolve;
  });

  const vectorStoreOptions: PineconeStoreOptions = {
    pineconeIndex: index,
    textKey: 'text',
  };

  const vectorStore = await PineconeStore.fromExistingIndex(
    new OpenAIEmbeddings({}),
    vectorStoreOptions,
  );

  const retrieverStartTime = Date.now();

  const retriever = vectorStore.asRetriever({
    callbacks: [
      {
        handleRetrieverError(error) {
          console.error('Retriever error:', error);
          resolveWithDocuments([]);
        },
        handleRetrieverEnd(docs: Document[], runId: string) {
          if (docs.length < sourceCount) {
            const error = `Error: Retrieved ${docs.length} sources, but ${sourceCount} were requested. (runId: ${runId})`;
            console.error(error);
            sendData({ warning: error });
          }
          resolveWithDocuments(docs);
          sendData({ sourceDocs: docs });
          console.log(
            `Document retrieval took ${Date.now() - retrieverStartTime}ms for ${docs.length} documents`,
          );
        },
      } as Partial<BaseCallbackHandler>,
    ],
    k: sourceCount,
  });

  return { vectorStore, retriever, documentPromise, resolveWithDocuments };
}

// Function to save the answer and related information to Firestore
async function saveAnswerToFirestore(
  originalQuestion: string,
  fullResponse: string,
  collection: string,
  promiseDocuments: Document[],
  history: ChatMessage[],
  clientIP: string,
): Promise<string> {
  // Check if db is available
  if (!db) {
    console.warn('Firestore database not initialized, skipping save');
    return '';
  }

  try {
    const answerRef = db.collection(getAnswersCollectionName());
    const answerEntry = {
      question: originalQuestion,
      answer: fullResponse,
      collection: collection,
      sources: JSON.stringify(promiseDocuments),
      likeCount: 0,
      history: history,
      ip: clientIP,
      timestamp: fbadmin.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await answerRef.add(answerEntry);
    return docRef.id;
  } catch (error) {
    console.error('Error saving to Firestore:', error);
    return '';
  }
}

// Function for handling errors and sending appropriate error messages
function handleError(
  error: unknown,
  sendData: (data: StreamingResponseData) => void,
) {
  console.error('Error in chat route:', error);
  if (error instanceof Error) {
    // Handle specific error cases
    if (error.name === 'PineconeNotFoundError') {
      console.error('Pinecone index not found:', getPineconeIndexName());
      sendData({
        error:
          'The specified Pinecone index does not exist. Please notify your administrator.',
      });
    } else if (error.message.includes('429')) {
      // Log the first 10 characters of the API key for debugging purposes
      console.log(
        'First 10 chars of OPENAI_API_KEY:',
        process.env.OPENAI_API_KEY?.substring(0, 10),
      );
      sendData({
        error:
          'The site has exceeded its current quota with OpenAI, please tell an admin to check the plan and billing details.',
      });
    } else if (error.message.includes('Pinecone')) {
      sendData({
        error: `Error connecting to Pinecone: ${error.message}`,
      });
    } else {
      sendData({ error: error.message || 'Something went wrong' });
    }
  } else {
    sendData({ error: 'An unknown error occurred' });
  }
}

// Add new function near other handlers
async function handleComparisonRequest(
  req: NextRequest,
  requestBody: ComparisonRequestBody,
  siteConfig: SiteConfig,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('Comparison request starting');

        // Send site ID first
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ siteId: siteConfig.siteId })}\n\n`,
          ),
        );

        // Set up Pinecone and filter
        const { index } = await setupPineconeAndFilter(
          requestBody.collection || 'default',
          normalizeMediaTypes(requestBody.mediaTypes),
          siteConfig,
        );

        // Set up a manual tracking function to signal "done" to the client
        const signalDone = () => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
            );
          } catch (e) {
            console.error('Error sending done event:', e);
          }
        };

        // Set up function to send data to the client
        const sendToClient = (data: any) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch (e) {
            console.error('Error sending data to client:', e);
          }
        };

        // Use the source count directly from the request body
        const sourceCount = requestBody.sourceCount || 4;

        // Create a completely fresh vector store and retriever for this request
        const vectorStoreOptions = {
          pineconeIndex: index,
          textKey: 'text',
        };

        const vectorStore = await PineconeStore.fromExistingIndex(
          new OpenAIEmbeddings({}),
          vectorStoreOptions,
        );

        const retriever = vectorStore.asRetriever({
          k: sourceCount,
        });

        // Create chains for both models
        const chainA = await makeChain(
          retriever,
          {
            model: requestBody.modelA,
            temperature: requestBody.temperatureA,
            label: 'A',
          },
          sourceCount,
        );

        const chainB = await makeChain(
          retriever,
          {
            model: requestBody.modelB,
            temperature: requestBody.temperatureB,
            label: 'B',
          },
          sourceCount,
        );

        // Format chat history
        const pastMessages = convertChatHistory(requestBody.history);

        // Set up a timeout to ensure done is sent even if models hang
        const doneTimeout = setTimeout(() => {
          signalDone();
        }, 60000); // 60 second timeout

        // Flag to track if we've sent the done signal
        let doneSent = false;

        // Execute both models concurrently
        try {
          await Promise.all([
            chainA.invoke(
              {
                question: requestBody.question,
                chat_history: pastMessages,
              },
              {
                callbacks: [
                  {
                    handleLLMNewToken(token: string) {
                      if (token.trim()) {
                        sendToClient({ token, model: 'A' });
                      }
                    },
                  } as Partial<BaseCallbackHandler>,
                ],
              },
            ),
            chainB.invoke(
              {
                question: requestBody.question,
                chat_history: pastMessages,
              },
              {
                callbacks: [
                  {
                    handleLLMNewToken(token: string) {
                      if (token.trim()) {
                        sendToClient({ token, model: 'B' });
                      }
                    },
                  } as Partial<BaseCallbackHandler>,
                ],
              },
            ),
          ]);

          // Clear the timeout as we don't need it anymore
          clearTimeout(doneTimeout);

          // Since both models have completed, we can send the done signal
          if (!doneSent) {
            doneSent = true;
            signalDone();
          }

          // Wait a moment to ensure the done signal is processed
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Now we can close the controller
          console.log('Closing controller after both models completed');
          controller.close();
        } catch (error) {
          console.error('Error running model chains:', error);

          // Clear the timeout as we're handling the error
          clearTimeout(doneTimeout);

          // Send error to client
          sendToClient({
            error:
              'Error running model comparison: ' +
              (error instanceof Error ? error.message : String(error)),
          });

          // Send done signal if we haven't already
          if (!doneSent) {
            doneSent = true;
            signalDone();
          }

          // Wait a moment to ensure the error and done signals are processed
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Close the controller
          controller.close();
        }
      } catch (error) {
        console.error('Error in comparison handler:', error);

        try {
          // Try to send error to client
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error:
                  'Error in comparison handler: ' +
                  (error instanceof Error ? error.message : String(error)),
              })}\n\n`,
            ),
          );

          // Signal done
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
          );
        } catch (e) {
          console.error('Error sending error to client:', e);
        }

        // Close the controller
        controller.close();
      }
    },
  });

  // Return response with CORS headers
  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });

  return addCorsHeaders(response, req, siteConfig);
}

// Apply JWT authentication to the POST handler
export const POST = withAppRouterJwtAuth(
  async (req: NextRequest, context: any, token: JwtPayload) => {
    // The token has been verified at this point
    console.log(`Authenticated request from client: ${token.client}`);

    // Original POST handler implementation starts here
    return handleChatRequest(req);
  },
);

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(req: NextRequest) {
  return handleCorsOptions(req);
}

/**
 * Handles CORS preflight requests for the chat API
 */
async function handleCorsOptions(req: NextRequest) {
  // Load site configuration
  const siteConfig = loadSiteConfigSync();

  if (!siteConfig) {
    return NextResponse.json(
      { error: 'Failed to load site configuration' },
      { status: 500 },
    );
  }

  // Create basic response with CORS headers
  const response = new NextResponse(null, { status: 204 });

  // Get origin from request for CORS headers
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // Set CORS headers based on origin if available
  if (origin) {
    const allowedDomains = siteConfig.allowedFrontEndDomains || [];
    const isAllowedDomain = allowedDomains.some((pattern) =>
      matchesPattern(origin, pattern),
    );

    if (isAllowedDomain || isDevelopment()) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS',
      );
      response.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );
      response.headers.set('Access-Control-Max-Age', '86400');
    }
  } else if (isDevelopment() && referer && referer.includes('wordpress')) {
    // Special case for WordPress in development
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    response.headers.set('Access-Control-Allow-Credentials', 'false');
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  // For any other case (no origin, not dev WordPress), don't set CORS headers

  return response;
}

/**
 * Main handler for chat requests
 * This contains the original implementation of the POST handler
 *
 * TODO: remove comparison functionality here if it is not needed. confirm it is not needed.
 */
async function handleChatRequest(req: NextRequest) {
  // Start timing with stages for component timing
  const timingMetrics: TimingMetrics = {
    startTime: Date.now(),
  };

  const stages = {
    startTime: Date.now(),
    pineconeComplete: 0,
    retrievalComplete: 0,
  };

  // Load site configuration
  const siteConfig = loadSiteConfigSync();

  if (!siteConfig) {
    return NextResponse.json(
      { error: 'Failed to load site configuration' },
      { status: 500 },
    );
  }

  // Store the model name for logging
  const modelName = siteConfig.modelName || 'unknown';

  // Validate and preprocess the input
  const validationResult = await validateAndPreprocessInput(req, siteConfig);
  if (validationResult instanceof NextResponse) {
    return validationResult;
  }

  const { sanitizedInput, originalQuestion } = validationResult;
  const convertedHistory = convertChatHistory(sanitizedInput.history);

  // Check if this is a comparison request
  const isComparison = 'modelA' in sanitizedInput;

  // Check CORS restrictions
  const corsCheckResult = handleCors(req, siteConfig);
  if (corsCheckResult) {
    return corsCheckResult;
  }

  if (isComparison) {
    return handleComparisonRequest(
      req,
      sanitizedInput as ComparisonRequestBody,
      siteConfig,
    );
  }

  // Apply rate limiting
  const rateLimitResult = await applyRateLimiting(req, siteConfig);
  if (rateLimitResult) {
    return rateLimitResult;
  }

  // Get client IP for logging purposes
  const clientIP = getClientIp(req);

  // Set up streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let isControllerClosed = false;
      let tokensStreamed = 0;
      let firstTokenSent = false;
      let performanceLogged = false;

      const sendData = (data: StreamingResponseData) => {
        if (!isControllerClosed) {
          try {
            // Track first token generation time from LLM (now in timing object)
            if (
              data.timing?.firstTokenGenerated &&
              !timingMetrics.firstTokenGenerated
            ) {
              timingMetrics.firstTokenGenerated =
                data.timing.firstTokenGenerated;
            }

            // Track first byte time (when token reaches client)
            if (!firstTokenSent && data.token) {
              firstTokenSent = true;
              timingMetrics.firstByteTime = Date.now();

              // Add timing info to the response
              data.timing = {
                ...(data.timing || {}),
                ttfb: timingMetrics.firstByteTime - timingMetrics.startTime,
              };
            }

            // Count tokens for calculating streaming rate
            if (data.token) {
              tokensStreamed += data.token.length;
            }

            // Add done timing info
            if (data.done && !performanceLogged) {
              performanceLogged = true;
              timingMetrics.totalTime = Date.now() - timingMetrics.startTime;
              const streamingTime = timingMetrics.firstByteTime
                ? Date.now() - timingMetrics.firstByteTime
                : 0;
              timingMetrics.totalTokens = tokensStreamed;

              // Calculate tokens per second if we have streaming time
              if (streamingTime > 0) {
                timingMetrics.tokensPerSecond = Math.round(
                  (tokensStreamed / streamingTime) * 1000,
                );
              }

              // Log consolidated performance metrics
              logPerformanceMetrics(timingMetrics, stages, modelName);

              // Add timing to the final response
              data.timing = {
                ttfb: timingMetrics.firstByteTime
                  ? timingMetrics.firstByteTime - timingMetrics.startTime
                  : 0,
                total: timingMetrics.totalTime,
                tokensPerSecond: timingMetrics.tokensPerSecond || 0,
                totalTokens: tokensStreamed,
                firstTokenGenerated: timingMetrics.firstTokenGenerated,
              };
            }

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          } catch (error) {
            if (
              error instanceof TypeError &&
              error.message.includes('Controller is already closed')
            ) {
              isControllerClosed = true;
            } else {
              throw error;
            }
          }
        }
      };

      try {
        // Send site ID first
        sendData({ siteId: siteConfig.siteId });

        // Set up Pinecone and filter
        const { index, filter } = await setupPineconeAndFilter(
          sanitizedInput.collection || 'default',
          normalizeMediaTypes(sanitizedInput.mediaTypes),
          siteConfig,
        );

        // Track pinecone setup completion time
        stages.pineconeComplete = Date.now();

        const { retriever, documentPromise, resolveWithDocuments } =
          await setupVectorStoreAndRetriever(
            index,
            filter,
            sendData,
            sanitizedInput.sourceCount || 4,
          );

        // Add a callback that will be triggered when documents are ready
        documentPromise.then(() => {
          // Set retrieval completion time as soon as documents are resolved
          stages.retrievalComplete = Date.now();
        });

        // Execute language model chain
        console.log('Starting LLM chain execution');

        const fullResponse = await setupAndExecuteLanguageModelChain(
          retriever,
          sanitizedInput.question,
          sanitizedInput.history || [],
          sendData,
          sanitizedInput.sourceCount || 4,
          filter,
          resolveWithDocuments,
          siteConfig,
        );

        // Wait for documents for Firestore, but sources are already sent
        const promiseDocuments = await documentPromise;

        if (promiseDocuments.length === 0) {
          console.warn(
            `Warning: No sources returned for query: "${sanitizedInput.question}"`,
          );
        }

        // Save answer to Firestore if not a private session
        if (!sanitizedInput.privateSession) {
          const docId = await saveAnswerToFirestore(
            originalQuestion,
            fullResponse,
            sanitizedInput.collection || 'default',
            promiseDocuments,
            sanitizedInput.history || [],
            clientIP,
          );
          sendData({ docId });
        }

        // Send done event
        sendData({ done: true });
      } catch (error: unknown) {
        console.error('Error in stream handler:', error);
        handleError(error, sendData);
      } finally {
        if (!isControllerClosed) {
          controller.close();
          isControllerClosed = true;
        }
        console.log('Stream processing ended');
      }
    },
  });

  // Return streaming response
  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });

  return addCorsHeaders(response, req, siteConfig);
}

function normalizeMediaTypes(
  mediaTypes: Partial<MediaTypes> | undefined,
): Record<string, boolean> {
  const defaultTypes = {
    text: true,
    image: false,
    video: false,
    audio: false,
  };

  if (!mediaTypes) return defaultTypes;

  return Object.entries(defaultTypes).reduce(
    (acc, [key, defaultValue]) => ({
      ...acc,
      [key]: mediaTypes[key as keyof MediaTypes] ?? defaultValue,
    }),
    {} as Record<string, boolean>,
  );
}

// Consolidated logging function for better summary messages
function logPerformanceMetrics(
  metrics: TimingMetrics,
  stages: Record<string, number>,
  modelName: string = 'unknown',
) {
  const summaryMetrics = {
    setup: stages.pineconeComplete
      ? stages.pineconeComplete - stages.startTime
      : 0,
    retrieval: stages.retrievalComplete
      ? stages.retrievalComplete - stages.pineconeComplete
      : 0,
    llmThinkTime:
      metrics.firstTokenGenerated && stages.retrievalComplete
        ? metrics.firstTokenGenerated - stages.retrievalComplete
        : 0,
    tokenDelivery:
      metrics.firstByteTime && metrics.firstTokenGenerated
        ? metrics.firstByteTime - metrics.firstTokenGenerated
        : 0,
    ttfb: metrics.firstByteTime ? metrics.firstByteTime - metrics.startTime : 0,
    streaming:
      metrics.firstByteTime && metrics.totalTime
        ? metrics.totalTime - (metrics.firstByteTime - metrics.startTime)
        : 0,
    total: metrics.totalTime || 0,
    tokensPerSecond: metrics.tokensPerSecond || 0,
    totalTokens: metrics.totalTokens || 0,
  };

  console.log(`
  ⚡️ Chat Performance:
    Model: ${modelName}
    Setup: ${(summaryMetrics.setup / 1000).toFixed(2)}s
    Retrieval: ${(summaryMetrics.retrieval / 1000).toFixed(2)}s
    LLM think time: ${(summaryMetrics.llmThinkTime / 1000).toFixed(2)}s
    Token delivery: ${(summaryMetrics.tokenDelivery / 1000).toFixed(2)}s
    (Time to first byte: ${(summaryMetrics.ttfb / 1000).toFixed(2)}s)
    Streaming: ${(summaryMetrics.streaming / 1000).toFixed(2)}s (${summaryMetrics.tokensPerSecond} chars/sec)
    Total time: ${(summaryMetrics.total / 1000).toFixed(2)}s (${summaryMetrics.totalTokens} total tokens)
    `);
}
