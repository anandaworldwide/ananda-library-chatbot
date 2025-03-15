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
import { makeChain } from '@/utils/server/makechain';
import { getPineconeClient } from '@/utils/server/pinecone-client';
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

export const runtime = 'nodejs';
export const maxDuration = 240;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface MediaTypes {
  text?: boolean;
  image?: boolean;
  video?: boolean;
  audio?: boolean;
  [key: string]: boolean | undefined;
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
  const pinecone = await getPineconeClient();
  const index = pinecone.Index(
    getPineconeIndexName() || '',
  ) as Index<RecordMetadata>;

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

  return { index, filter };
}

async function setupVectorStoreAndRetriever(
  index: Index<RecordMetadata>,
  filter: PineconeFilter | undefined,
  sendData: (data: {
    token?: string;
    sourceDocs?: Document[];
    done?: boolean;
    error?: string;
    docId?: string;
  }) => void,
  sourceCount: number = 4,
): Promise<{
  vectorStore: PineconeStore;
  retriever: ReturnType<PineconeStore['asRetriever']>;
  documentPromise: Promise<Document[]>;
}> {
  let resolveWithDocuments: (value: Document[]) => void;
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
          }
          resolveWithDocuments(docs);
          sendData({ sourceDocs: docs });
        },
      } as Partial<BaseCallbackHandler>,
    ],
    k: sourceCount,
  });

  return { vectorStore, retriever, documentPromise };
}

// This function executes the language model chain and handles the streaming response
async function setupAndExecuteLanguageModelChain(
  retriever: ReturnType<PineconeStore['asRetriever']>,
  sanitizedQuestion: string,
  history: [string, string][],
  sendData: (data: StreamingResponseData) => void,
  sourceCount: number = 4,
  filter?: PineconeFilter,
  resolveDocs?: (docs: Document[]) => void,
  siteConfig?: SiteConfig | null,
): Promise<string> {
  try {
    const modelName = siteConfig?.modelName || 'gpt-4o';
    const temperature = siteConfig?.temperature || 0.3;

    const chain = await makeChain(
      retriever,
      { model: modelName, temperature },
      sourceCount,
      filter,
      sendData,
      resolveDocs,
    );

    // Format chat history for the language model
    const pastMessages = history
      .map((message) => {
        return [`Human: ${message[0]}`, `Assistant: ${message[1]}`].join('\n');
      })
      .join('\n');

    let fullResponse = '';
    let streamingComplete = false;

    // Invoke the chain with callbacks for streaming tokens
    const chainPromise = chain.invoke(
      {
        question: sanitizedQuestion,
        chat_history: pastMessages,
      },
      {
        callbacks: [
          {
            // Callback for handling new tokens from the language model
            handleLLMNewToken(token: string) {
              fullResponse += token;
              sendData({ token });
            },
            // Callback for handling the end of the chain execution
            handleChainEnd() {
              streamingComplete = true;
            },
          } as Partial<BaseCallbackHandler>,
        ],
      },
    );

    // Wait for the chain to complete
    await chainPromise;

    // Only send the done signal after the chain has fully completed and all tokens have been processed
    if (streamingComplete) {
      sendData({ done: true });
    }

    return fullResponse;
  } catch (error) {
    console.error('Error in setupAndExecuteLanguageModelChain:', error);
    throw error;
  }
}

// Function to save the answer and related information to Firestore
async function saveAnswerToFirestore(
  originalQuestion: string,
  fullResponse: string,
  collection: string,
  promiseDocuments: Document[],
  history: [string, string][],
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
      history: history.map((messagePair: [string, string]) => ({
        question: messagePair[0],
        answer: messagePair[1],
      })),
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
      const sendData = (data: StreamingResponseData & { model?: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Set up Pinecone and filter
        const { index, filter } = await setupPineconeAndFilter(
          requestBody.collection || 'default',
          normalizeMediaTypes(requestBody.mediaTypes),
          siteConfig,
        );

        // Use the source count directly from the request body
        // The frontend is responsible for using siteConfig.defaultNumSources
        const sourceCount = requestBody.sourceCount || 4;

        // Setup Vector Store and Retriever
        const { retriever, documentPromise } =
          await setupVectorStoreAndRetriever(
            index,
            filter,
            (data) => {
              if (data.sourceDocs) {
                sendData({ ...data, model: 'A' });
                sendData({ ...data, model: 'B' });
              }
            },
            sourceCount,
          );

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
        const pastMessages = convertChatHistory(requestBody.history)
          .map((message) => {
            return [`Human: ${message[0]}`, `Assistant: ${message[1]}`].join(
              '\n',
            );
          })
          .join('\n');

        // Track completion of both models
        let modelAComplete = false;
        let modelBComplete = false;

        // Run both chains concurrently
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
                    // Only send the token if it's not empty or just whitespace
                    if (token.trim()) {
                      sendData({ token, model: 'A' });
                    }
                  },
                  handleChainEnd() {
                    modelAComplete = true;
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
                    // Only send the token if it's not empty or just whitespace
                    if (token.trim()) {
                      sendData({ token, model: 'B' });
                    }
                  },
                  handleChainEnd() {
                    modelBComplete = true;
                  },
                } as Partial<BaseCallbackHandler>,
              ],
            },
          ),
        ]);

        // Send source documents once at the end
        const sourceDocs = await documentPromise;
        sendData({ sourceDocs });

        // Signal completion only after both models have completed
        if (modelAComplete && modelBComplete) {
          sendData({ done: true });
        }

        controller.close();
      } catch (error) {
        handleError(error, sendData);
        controller.close();
      }
    },
  });

  // Replace standard response with one that has CORS headers
  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });

  return addCorsHeaders(response, req, siteConfig);
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(req: NextRequest) {
  const siteConfig = loadSiteConfigSync();

  if (!siteConfig) {
    return NextResponse.json(
      { error: 'Failed to load site configuration' },
      { status: 500 },
    );
  }

  // Create a basic response
  const response = new NextResponse(null, { status: 204 });
  const origin = req.headers.get('origin');

  // First, ensure critical preflight headers are present
  if (origin) {
    // Check if origin is allowed
    const allowedDomains = siteConfig.allowedFrontEndDomains || [];
    const isAllowedDomain = allowedDomains.some((pattern) =>
      matchesPattern(origin, pattern),
    );

    if (isAllowedDomain || isDevelopment()) {
      // Add critical CORS headers directly for preflight
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS',
      );
      response.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );

      console.log(`OPTIONS: Allowing origin: ${origin}`);
    } else {
      console.log(`OPTIONS: Rejected origin: ${origin}`);
    }
  }

  // Then, let addCorsHeaders add any additional headers
  return addCorsHeaders(response, req, siteConfig);
}

// main POST handler
export async function POST(req: NextRequest) {
  // Load site configuration
  const siteConfig = loadSiteConfigSync();

  if (!siteConfig) {
    return NextResponse.json(
      { error: 'Failed to load site configuration' },
      { status: 500 },
    );
  }

  // Validate and preprocess the input
  const validationResult = await validateAndPreprocessInput(req, siteConfig);
  if (validationResult instanceof NextResponse) {
    return validationResult;
  }

  const { sanitizedInput, originalQuestion } = validationResult;

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
      const sendData = (data: StreamingResponseData) => {
        if (!isControllerClosed) {
          try {
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

        const { retriever } = await setupVectorStoreAndRetriever(
          index,
          filter,
          sendData,
          sanitizedInput.sourceCount || 4,
        );

        // Factory function to define promise and resolver together
        const createDocumentPromise = () => {
          let resolveFn: (docs: Document[]) => void;
          const promise = new Promise<Document[]>((resolve) => {
            resolveFn = resolve;
          });
          return { documentPromise: promise, resolveWithDocuments: resolveFn! };
        };
        const { documentPromise, resolveWithDocuments } =
          createDocumentPromise();

        // Execute language model chain
        const fullResponse = await setupAndExecuteLanguageModelChain(
          retriever,
          sanitizedInput.question,
          convertChatHistory(sanitizedInput.history),
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
          console.log('Filter used:', JSON.stringify(filter));
          console.log('Pinecone index:', getPineconeIndexName());
        }

        // Save answer to Firestore if not a private session
        if (!sanitizedInput.privateSession) {
          const docId = await saveAnswerToFirestore(
            originalQuestion,
            fullResponse,
            sanitizedInput.collection || 'default',
            promiseDocuments,
            convertChatHistory(sanitizedInput.history),
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

function convertChatHistory(
  history: ChatMessage[] | undefined,
): [string, string][] {
  if (!history) return [];
  return history.map((msg) => [
    msg.role === 'user' ? msg.content : '',
    msg.role === 'assistant' ? msg.content : '',
  ]);
}

// Helper function to convert partial media types to full boolean record
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
