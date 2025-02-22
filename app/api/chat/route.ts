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

export const runtime = 'nodejs';
export const maxDuration = 240;

interface ChatRequestBody {
  collection: string;
  question: string;
  history: [string, string][];
  privateSession: boolean;
  mediaTypes: Record<string, boolean>;
  sourceCount: number;
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

async function validateAndPreprocessInput(req: NextRequest): Promise<
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
    console.log('Request body:', JSON.stringify(requestBody));
  } catch (error) {
    console.error('Error parsing request body:', error);
    console.log('Raw request body:', await req.text());
    return NextResponse.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 },
    );
  }

  const { collection, question } = requestBody;

  // Validate question length
  if (
    typeof question !== 'string' ||
    !validator.isLength(question, { min: 1, max: 4000 })
  ) {
    return NextResponse.json(
      { error: 'Invalid question. Must be between 1 and 4000 characters.' },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: 'Invalid collection provided' },
      { status: 400 },
    );
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
      max: siteConfig.queriesPerUserPerDay,
      name: 'query',
    },
    req.ip,
  );

  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Daily query limit reached. Please try again tomorrow.' },
      { status: 429 },
    );
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
        handleRetrieverEnd(docs: Document[]) {
          resolveWithDocuments(docs);
          sendData({ sourceDocs: docs });
        },
      } as Partial<BaseCallbackHandler>,
    ],
    k: sourceCount,
  });

  let resolveWithDocuments: (value: Document[]) => void;
  const documentPromise = new Promise<Document[]>((resolve) => {
    resolveWithDocuments = resolve;
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
): Promise<string> {
  // Create language model chain with sourceCount
  const chain = await makeChain(
    retriever,
    { model: 'gpt-4o', temperature: 0 },
    sourceCount,
    filter,
  );

  // Format chat history for the language model
  const pastMessages = history
    .map((message: [string, string]) => {
      return [`Human: ${message[0]}`, `Assistant: ${message[1]}`].join('\n');
    })
    .join('\n');

  let fullResponse = '';

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
            sendData({ done: true });
          },
        } as Partial<BaseCallbackHandler>,
      ],
    },
  );

  // Wait for the chain to complete
  await chainPromise;

  return fullResponse;
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
        // Set up Pinecone and retriever using existing functions
        const { index, filter } = await setupPineconeAndFilter(
          requestBody.collection,
          requestBody.mediaTypes,
          siteConfig,
        );

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
            requestBody.sourceCount,
          );

        // Create chains for both models
        const chainA = await makeChain(
          retriever,
          {
            model: requestBody.modelA,
            temperature: requestBody.temperatureA,
            label: 'A',
          },
          requestBody.sourceCount,
        );
        const chainB = await makeChain(
          retriever,
          {
            model: requestBody.modelB,
            temperature: requestBody.temperatureB,
            label: 'B',
          },
          requestBody.sourceCount,
        );

        // Format chat history
        const pastMessages = requestBody.history
          .map((message: [string, string]) => {
            return [`Human: ${message[0]}`, `Assistant: ${message[1]}`].join(
              '\n',
            );
          })
          .join('\n');

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
                } as Partial<BaseCallbackHandler>,
              ],
            },
          ),
        ]);

        // Send source documents once at the end
        const sourceDocs = await documentPromise;
        sendData({ sourceDocs });

        // Signal completion
        sendData({ done: true });
        controller.close();
      } catch (error) {
        handleError(error, sendData);
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

// main POST handler
export async function POST(req: NextRequest) {
  // Validate and preprocess the input
  const validationResult = await validateAndPreprocessInput(req);
  if (validationResult instanceof NextResponse) {
    return validationResult;
  }

  const { sanitizedInput, originalQuestion } = validationResult;

  // Load site configuration
  const siteConfig = loadSiteConfigSync();
  if (!siteConfig) {
    return NextResponse.json(
      { error: 'Failed to load site configuration' },
      { status: 500 },
    );
  }

  // Check if this is a comparison request
  const isComparison = 'modelA' in sanitizedInput;
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
      // Helper function to send data chunks
      const sendData = (data: StreamingResponseData) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Set up Pinecone and filter
        const { index, filter } = await setupPineconeAndFilter(
          sanitizedInput.collection,
          sanitizedInput.mediaTypes,
          siteConfig,
        );

        const { retriever, documentPromise } =
          await setupVectorStoreAndRetriever(
            index,
            filter,
            sendData,
            sanitizedInput.sourceCount || 4,
          );

        // Execute language model chain
        const fullResponse = await setupAndExecuteLanguageModelChain(
          retriever,
          sanitizedInput.question,
          sanitizedInput.history,
          sendData,
          sanitizedInput.sourceCount || 4,
          filter,
        );

        // Log warning if no sources were found
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
            sanitizedInput.collection,
            promiseDocuments,
            sanitizedInput.history,
            clientIP,
          );

          sendData({ docId });
        }

        controller.close();
      } catch (error: unknown) {
        handleError(error, sendData);
      } finally {
        controller.close();
      }
    },
  });

  // Return streaming response
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
