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
import { NextRequest, NextResponse } from "next/server";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { makeChain, setupAndExecuteLanguageModelChain } from "@/utils/server/makechain";
import { getCachedPineconeIndex } from "@/utils/server/pinecone-client";
import { getPineconeIndexName } from "@/utils/server/pinecone-config";
import * as fbadmin from "firebase-admin";
import { db } from "@/services/firebase";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { Index, RecordMetadata } from "@pinecone-database/pinecone";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { loadSiteConfigSync } from "@/utils/server/loadSiteConfig";
import validator from "validator";
import { genericRateLimiter } from "@/utils/server/genericRateLimiter";
import { SiteConfig } from "@/types/siteConfig";
import { StreamingResponseData } from "@/types/StreamingResponseData";
import { getClientIp } from "@/utils/server/ipUtils";
import { isDevelopment } from "@/utils/env";
import { withAppRouterJwtAuth } from "@/utils/server/appRouterJwtUtils";
import { ChatMessage, convertChatHistory } from "@/utils/shared/chatHistory";
import * as corsMiddleware from "@/utils/server/corsMiddleware";
import { determineActiveMediaTypes } from "@/utils/determineActiveMediaTypes";
import { firestoreSet, firestoreAdd } from "@/utils/server/firestoreRetryUtils";
import { sendOpsAlert } from "@/utils/server/emailOps";

export const runtime = "nodejs";
export const maxDuration = 240;

// Add OPTIONS handler for CORS preflight requests
export const OPTIONS = async (req: NextRequest) => {
  const siteConfig = loadSiteConfigSync();

  if (!siteConfig) {
    return NextResponse.json({ error: "Failed to load site configuration" }, { status: 500 });
  }

  // Create a response with proper CORS headers for preflight request
  const response = new NextResponse(null, { status: 204 });

  // Use the centralized CORS handler to add headers consistently
  return corsMiddleware.addCorsHeaders(response, req, siteConfig);
};

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
  historyA?: ChatMessage[];
  historyB?: ChatMessage[];
}

// Define a minimal type that matches PineconeStore.fromExistingIndex expectations
type PineconeStoreOptions = {
  pineconeIndex: Index<RecordMetadata>;
  textKey: string;
  // We omit filter since we're handling it at runtime
};

// Define a custom type for our filter structure
type PineconeFilter = {
  $and: Array<{
    [key: string]: { $in: string[] } | { $nin: string[] } | any; // Allow more operators like $nin and make it more flexible
  }>;
};

// Helper function to determine active media types based on input and config
// Export for testing

async function validateAndPreprocessInput(
  req: NextRequest,
  siteConfig: SiteConfig
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
    const response = NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    return corsMiddleware.addCorsHeaders(response, req, siteConfig);
  }

  const { collection, question } = requestBody;

  // Validate collection first - it's expected by tests
  if (typeof collection !== "string") {
    const response = NextResponse.json({ error: "Collection must be a string value" }, { status: 400 });
    return corsMiddleware.addCorsHeaders(response, req, siteConfig);
  }

  // Only validate collection against available options if there are multiple collections configured
  if (
    siteConfig.collectionConfig &&
    Object.keys(siteConfig.collectionConfig).length > 1 &&
    !Object.keys(siteConfig.collectionConfig).includes(collection)
  ) {
    const availableCollections = Object.keys(siteConfig.collectionConfig).join(", ");
    const response = NextResponse.json(
      {
        error: `Invalid collection provided. Available collections: ${availableCollections}`,
      },
      { status: 400 }
    );
    return corsMiddleware.addCorsHeaders(response, req, siteConfig);
  }

  // Validate question length last - tests expect collection errors to take precedence
  if (typeof question !== "string" || !validator.isLength(question, { min: 1, max: 4000 })) {
    const response = NextResponse.json(
      { error: "Invalid question. Must be between 1 and 4000 characters." },
      { status: 400 }
    );
    return corsMiddleware.addCorsHeaders(response, req, siteConfig);
  }

  const originalQuestion = question;
  // Sanitize the input to prevent XSS attacks
  const sanitizedQuestion = validator.escape(question.trim()).replaceAll("\n", " ");

  return {
    sanitizedInput: {
      ...requestBody,
      question: sanitizedQuestion,
    },
    originalQuestion,
  };
}

async function applyRateLimiting(req: NextRequest, siteConfig: SiteConfig): Promise<NextResponse | null> {
  const isAllowed = await genericRateLimiter(
    req,
    null,
    {
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
      max: isDevelopment() ? siteConfig.queriesPerUserPerDay * 10 : siteConfig.queriesPerUserPerDay,
      name: "query",
    },
    req.ip
  );

  if (!isAllowed) {
    const response = NextResponse.json(
      { error: "Daily query limit reached. Please try again tomorrow." },
      { status: 429 }
    );
    return corsMiddleware.addCorsHeaders(response, req, siteConfig);
  }

  return null; // Rate limiting passed
}

async function setupPineconeAndFilter(
  collection: string,
  mediaTypes: Partial<MediaTypes> | undefined,
  siteConfig: SiteConfig
): Promise<{ index: Index<RecordMetadata>; filter: PineconeFilter }> {
  // Use cached Pinecone index instead of creating a new one each time
  const indexName = getPineconeIndexName() || "";
  const index = (await getCachedPineconeIndex(indexName)) as Index<RecordMetadata>;

  // Determine active types using the helper function
  const activeTypes = determineActiveMediaTypes(mediaTypes, siteConfig.enabledMediaTypes);

  // Create a cleaner filter structure - initialize with empty $and array
  const filter: PineconeFilter = {
    $and: [],
  };

  // Add media type filter
  filter.$and.push({ type: { $in: activeTypes } });

  // Apply collection-specific filters only if the collection exists in siteConfig
  if (siteConfig.collectionConfig && siteConfig.collectionConfig[collection]) {
    // Apply collection-specific filters based on the collection name
    if (collection === "master_swami") {
      filter.$and.push({
        author: { $in: ["Paramhansa Yogananda", "Swami Kriyananda"] },
      });
    }
  }

  // If you need to pass filter to makeChain in the future, you might need to add library filters here
  // But don't add redundant library filters if makeChain is already handling it

  return { index, filter };
}

async function setupVectorStoreAndRetriever(
  index: Index<RecordMetadata>,
  filter: PineconeFilter | undefined,
  sendData: (data: StreamingResponseData) => void,
  requestedSourceCount: number = 4 // Final number of sources needed
): Promise<{
  vectorStore: PineconeStore;
  retriever: ReturnType<PineconeStore["asRetriever"]>;
  documentPromise: Promise<Document[]>;
  resolveWithDocuments: (docs: Document[]) => void;
}> {
  // Create the promise and resolver
  let resolveWithDocuments!: (docs: Document[]) => void;
  const documentPromise = new Promise<Document[]>((resolve) => {
    resolveWithDocuments = resolve;
  });

  const vectorStoreOptions: PineconeStoreOptions = {
    pineconeIndex: index,
    textKey: "text",
  };

  const vectorStore = await PineconeStore.fromExistingIndex(
    new OpenAIEmbeddings({
      model:
        process.env.OPENAI_EMBEDDINGS_MODEL ||
        (() => {
          console.warn("OPENAI_EMBEDDINGS_MODEL not set, using default text-embedding-ada-002");
          return "text-embedding-ada-002";
        })(),
    }),
    vectorStoreOptions
  );

  // Use the vector store as-is without debug logging

  // Configure retriever to fetch the expanded number of documents
  const retriever = vectorStore.asRetriever({
    callbacks: [
      {
        handleRetrieverError(error) {
          console.error("Retriever error:", error);
          resolveWithDocuments([]); // Resolve with empty array on error
        },
        handleRetrieverEnd(docs: Document[]) {
          // Now, simply resolve the promise with the expanded list of documents.
          resolveWithDocuments(docs); // Resolve with the full list retrieved
        },
      } as Partial<BaseCallbackHandler>,
    ],
    k: requestedSourceCount,
  });

  return { vectorStore, retriever, documentPromise, resolveWithDocuments };
}

// Updated function to handle both creation (if docId is missing) and update
async function saveOrUpdateDocument(
  docId: string | undefined | null, // Make docId optional
  originalQuestion: string,
  fullResponse: string,
  finalDocuments: Document[], // Use the final documents
  collection: string,
  history: ChatMessage[],
  clientIP: string,
  restatedQuestion: string
): Promise<string | null> {
  if (!db) {
    return null;
  }

  // Create data object to save
  const dataToSave = {
    question: originalQuestion,
    answer: fullResponse,
    collection: collection,
    sources: JSON.stringify(finalDocuments), // Save the correct final documents
    likeCount: 0, // Reset or handle like count as needed
    history: history,
    ip: clientIP,
    timestamp: fbadmin.firestore.FieldValue.serverTimestamp(), // Update timestamp on save/update
    relatedQuestionsV2: [], // Reset or handle related questions as needed
    restatedQuestion: restatedQuestion,
  };

  try {
    const answerRef = db.collection(getAnswersCollectionName());
    if (docId) {
      // Update existing document
      try {
        await firestoreSet(
          answerRef.doc(docId),
          dataToSave,
          { merge: true },
          "chat document update",
          `docId: ${docId}, question: ${originalQuestion.substring(0, 50)}...`
        );
        return docId;
      } catch (updateError) {
        // Fall through to creation as a fallback
        docId = null; // Force creation path below
      }
    }

    if (!docId) {
      // Create new document if docId was not provided or creation failed initially
      try {
        const newDocRef = await firestoreAdd(
          answerRef,
          dataToSave,
          "chat document creation",
          `question: ${originalQuestion.substring(0, 50)}...`
        );
        return newDocRef.id;
      } catch (createError) {
        return null;
      }
    }

    // This should never be reached, but just in case
    return docId || null;
  } catch (error) {
    return null;
  }
}

// Function for handling errors and sending appropriate error messages
function handleError(error: unknown, sendData: (data: StreamingResponseData) => void) {
  if (error instanceof Error) {
    // Handle specific error cases
    if (error.name === "PineconeNotFoundError") {
      sendData({
        error: "The specified Pinecone index does not exist. Please notify your administrator.",
      });
    } else if (error.message.includes("429")) {
      sendData({
        error:
          "The site has exceeded its current quota with OpenAI, please tell an admin to check the plan and billing details.",
      });

      // Send ops alert for OpenAI quota exhaustion
      sendOpsAlert(
        `CRITICAL: OpenAI API Quota Exhausted`,
        `OpenAI API returned a 429 (quota exceeded) error during chat request processing.

This indicates that the OpenAI API usage limits have been reached, preventing:
- Chat response generation
- Document embedding creation
- Question reformulation
- All AI-powered functionality

IMMEDIATE ACTION REQUIRED: 
1. Check OpenAI account billing and usage limits
2. Upgrade plan or increase quota limits
3. Monitor API usage patterns

Error context: ${error.message}`,
        {
          error,
          context: {
            errorType: "openai_quota_exhaustion",
            httpStatus: 429,
            timestamp: new Date().toISOString(),
            apiEndpoint: "/api/chat/v1",
          },
        }
      ).catch((emailError) => {
        console.error("Failed to send OpenAI quota ops alert:", emailError);
      });
    } else if (error.message.includes("Pinecone")) {
      sendData({
        error: `Error connecting to Pinecone: ${error.message}`,
      });

      // Send ops alert for Pinecone connection failures
      sendOpsAlert(
        `CRITICAL: Pinecone Vector Database Connection Failure`,
        `Pinecone vector database connection failed during chat request processing.

This prevents the system from:
- Retrieving relevant documents for user queries
- Performing semantic search operations
- Accessing the knowledge base
- Generating contextual responses

IMMEDIATE ACTION REQUIRED:
1. Check Pinecone service status and connectivity
2. Verify API keys and environment configuration
3. Check network connectivity to Pinecone endpoints

Error details: ${error.message}`,
        {
          error,
          context: {
            errorType: "pinecone_connection_failure",
            timestamp: new Date().toISOString(),
            apiEndpoint: "/api/chat/v1",
          },
        }
      ).catch((emailError) => {
        console.error("Failed to send Pinecone ops alert:", emailError);
      });
    } else {
      sendData({ error: error.message || "Something went wrong" });
    }
  } else {
    sendData({ error: "An unknown error occurred" });
  }
}

// Add new function near other handlers
async function handleComparisonRequest(req: NextRequest, requestBody: ComparisonRequestBody, siteConfig: SiteConfig) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send site ID first
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ siteId: siteConfig.siteId })}\n\n`));

        // Set up Pinecone and filter
        const { index } = await setupPineconeAndFilter(
          requestBody.collection || "whole_library",
          requestBody.mediaTypes,
          siteConfig
        );

        // Set up a manual tracking function to signal "done" to the client
        const signalDone = () => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          } catch (e) {
            console.error("Error sending done event:", e);
          }
        };

        // Set up function to send data to the client
        const sendToClient = (data: any) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (e) {
            console.error("Error sending data to client:", e);
          }
        };

        // Use the source count directly from the request body
        const sourceCount = requestBody.sourceCount || 4;

        // Create a completely fresh vector store and retriever for this request
        const vectorStoreOptions = {
          pineconeIndex: index,
          textKey: "text",
        };

        const vectorStore = await PineconeStore.fromExistingIndex(
          new OpenAIEmbeddings({
            model:
              process.env.OPENAI_EMBEDDINGS_MODEL ||
              (() => {
                console.warn("OPENAI_EMBEDDINGS_MODEL not set, using default text-embedding-ada-002");
                return "text-embedding-ada-002";
              })(),
          }),
          vectorStoreOptions
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
            label: "A",
          },
          sourceCount,
          undefined,
          undefined,
          undefined,
          undefined,
          requestBody.privateSession || false
        );

        const chainB = await makeChain(
          retriever,
          {
            model: requestBody.modelB,
            temperature: requestBody.temperatureB,
            label: "B",
          },
          sourceCount,
          undefined,
          undefined,
          undefined,
          undefined,
          requestBody.privateSession || false
        );

        // Format chat history for each model
        const pastMessagesA = convertChatHistory(requestBody.historyA || []);
        const pastMessagesB = convertChatHistory(requestBody.historyB || []);

        // Set up concurrent execution for both models

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
                chat_history: pastMessagesA,
              },
              {
                callbacks: [
                  {
                    handleLLMNewToken(token: string) {
                      if (token.trim()) {
                        sendToClient({ token, model: "A" });
                      }
                    },
                  } as Partial<BaseCallbackHandler>,
                ],
              }
            ),
            chainB.invoke(
              {
                question: requestBody.question,
                chat_history: pastMessagesB,
              },
              {
                callbacks: [
                  {
                    handleLLMNewToken(token: string) {
                      if (token.trim()) {
                        sendToClient({ token, model: "B" });
                      }
                    },
                  } as Partial<BaseCallbackHandler>,
                ],
              }
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
          controller.close();
        } catch (error) {
          console.error("Error running model chains:", error);

          // Clear the timeout as we're handling the error
          clearTimeout(doneTimeout);

          // Send error to client
          sendToClient({
            error: "Error running model comparison: " + (error instanceof Error ? error.message : String(error)),
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
        try {
          // Try to send error to client
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: "Error in comparison handler: " + (error instanceof Error ? error.message : String(error)),
              })}\n\n`
            )
          );

          // Signal done
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        } catch (e) {
          // Silently handle encoding errors
        }

        // Close the controller
        controller.close();
      }
    },
  });

  // Return response with CORS headers
  const response = new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

  return corsMiddleware.addCorsHeaders(response, req, siteConfig);
}

// Apply JWT authentication to the POST handler
export const POST = withAppRouterJwtAuth(async (req: NextRequest) => {
  // The token has been verified at this point
  // Original POST handler implementation starts here
  return handleChatRequest(req);
});

/**
 * Main handler for chat requests
 */
async function handleChatRequest(req: NextRequest) {
  // Start timing with stages for component timing
  const timingMetrics: TimingMetrics = {
    startTime: Date.now(),
  };

  const stages = {
    startTime: Date.now(),
    pineconeComplete: 0,
    retrievalComplete: 0, // This might not be tracked separately anymore
  };

  // Load site configuration
  const siteConfig = loadSiteConfigSync();

  if (!siteConfig) {
    const response = NextResponse.json({ error: "Failed to load site configuration" }, { status: 500 });
    // Return without CORS headers since we don't have site config
    return response;
  }

  // Store the model name for logging
  const modelName = siteConfig.modelName || "unknown";

  // Check CORS restrictions
  const corsCheckResult = corsMiddleware.handleCors(req, siteConfig);
  if (corsCheckResult) {
    return corsCheckResult;
  }

  // Apply rate limiting before validating the input
  const rateLimitResult = await applyRateLimiting(req, siteConfig);
  if (rateLimitResult) {
    return corsMiddleware.addCorsHeaders(rateLimitResult, req, siteConfig);
  }

  // Validate and preprocess the input
  const validationResult = await validateAndPreprocessInput(req, siteConfig);
  if (validationResult instanceof NextResponse) {
    return corsMiddleware.addCorsHeaders(validationResult, req, siteConfig);
  }

  const { sanitizedInput, originalQuestion } = validationResult;

  // Check if this is a comparison request
  const isComparison = "modelA" in sanitizedInput;

  if (isComparison) {
    return handleComparisonRequest(req, sanitizedInput as ComparisonRequestBody, siteConfig);
  }

  const sourceCount = sanitizedInput.sourceCount || 4;
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
            // DEBUG: Add logging for sources debugging
            if (data.sourceDocs) {
              console.log(`🔍 SSE SOURCES DEBUG: Attempting to send ${data.sourceDocs.length} sources via SSE`);

              // Test JSON stringification before sending
              try {
                const testSerialization = JSON.stringify(data);
                const serializedSize = new Blob([testSerialization]).size;
                console.log(`🔍 SSE SOURCES DEBUG: SSE payload size: ${serializedSize} bytes`);

                if (serializedSize > 2000000) {
                  // 2MB threshold for SSE
                  console.warn(`⚠️ SSE SOURCES WARNING: Very large SSE payload: ${serializedSize} bytes`);
                }
              } catch (serializeError) {
                console.error(`❌ SSE SOURCES ERROR: Failed to serialize SSE data:`, serializeError);
                console.error(`❌ SSE SOURCES ERROR: This explains the bug - answer will stream but sources will fail`);
                console.error(`❌ SSE SOURCES ERROR: Serialization error details:`, {
                  name: serializeError instanceof Error ? serializeError.name : "Unknown",
                  message: serializeError instanceof Error ? serializeError.message : String(serializeError),
                  sourceCount: data.sourceDocs?.length || 0,
                });
                // Don't send sourceDocs if serialization fails
                data = { ...data, sourceDocs: [] };
                console.log(
                  `🔍 SSE SOURCES DEBUG: Fallback - sending empty sources array, answer will still stream normally`
                );
              }
            }

            // DEBUG: Log the sequence of sources vs answer streaming
            if (data.sourceDocs && !data.token) {
              console.log(`🔍 SSE TIMING DEBUG: Sending sources BEFORE answer streaming begins`);
            } else if (data.token && !data.sourceDocs) {
              // This is normal answer streaming - no need to log every token
            } else if (data.token && data.sourceDocs) {
              console.log(`🔍 SSE TIMING DEBUG: Unusual - sending both token and sources simultaneously`);
            }

            if (data.timing?.firstTokenGenerated && !timingMetrics.firstTokenGenerated) {
              timingMetrics.firstTokenGenerated = data.timing.firstTokenGenerated;
            }
            if (!firstTokenSent && data.token) {
              firstTokenSent = true;
              timingMetrics.firstByteTime = Date.now();
              data.timing = {
                ...(data.timing || {}),
                ttfb: timingMetrics.firstByteTime - timingMetrics.startTime,
              };
            }
            if (data.token) {
              tokensStreamed += data.token.length;
            }
            if (data.done && !performanceLogged) {
              performanceLogged = true;
              timingMetrics.totalTime = Date.now() - timingMetrics.startTime;
              const streamingTime = timingMetrics.firstByteTime ? Date.now() - timingMetrics.firstByteTime : 0;
              timingMetrics.totalTokens = tokensStreamed;
              if (streamingTime > 0) {
                timingMetrics.tokensPerSecond = Math.round((tokensStreamed / streamingTime) * 1000);
              }
              logPerformanceMetrics(timingMetrics, stages, modelName);
              data.timing = {
                ttfb: timingMetrics.firstByteTime ? timingMetrics.firstByteTime - timingMetrics.startTime : 0,
                total: timingMetrics.totalTime,
                tokensPerSecond: timingMetrics.tokensPerSecond || 0,
                totalTokens: tokensStreamed,
                firstTokenGenerated: timingMetrics.firstTokenGenerated,
              };
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

            // DEBUG: Log successful transmission
            if (data.sourceDocs) {
              console.log(`✅ SSE SOURCES DEBUG: Successfully sent ${data.sourceDocs.length} sources via SSE`);
            }
          } catch (error) {
            // DEBUG: Enhanced error logging
            if (data.sourceDocs) {
              console.error(`❌ SSE SOURCES ERROR: Failed to send sources via SSE:`, error);
            }
            if (error instanceof TypeError && error.message.includes("Controller is already closed")) {
              isControllerClosed = true;
            } else {
              // Re-throwing might close the stream prematurely if not caught elsewhere
              throw error;
            }
          }
        }
      };

      try {
        // Send site ID first
        sendData({ siteId: siteConfig.siteId });

        const { index, filter } = await setupPineconeAndFilter(
          sanitizedInput.collection || "whole_library",
          sanitizedInput.mediaTypes,
          siteConfig
        );
        stages.pineconeComplete = Date.now();

        // --- Call the Encapsulated RAG Chain Function ---
        const { retriever /*, documentPromise, resolveWithDocuments*/ } = await setupVectorStoreAndRetriever(
          index,
          filter,
          sendData, // Pass sendData for internal progress updates
          sourceCount
        );

        // Execute the full chain
        const { fullResponse, finalDocs, restatedQuestion } = await setupAndExecuteLanguageModelChain(
          retriever,
          sanitizedInput.question,
          sanitizedInput.history || [],
          sendData,
          sourceCount,
          filter,
          siteConfig,
          timingMetrics.startTime,
          sanitizedInput.privateSession || false
        );
        // --- End of Encapsulated Call ---

        // SAVE DOCUMENT AFTER RESPONSE IS READY
        if (!sanitizedInput.privateSession) {
          try {
            // Always create a new document; pass null as docId
            const savedDocId = await saveOrUpdateDocument(
              null, // Force creation path
              originalQuestion,
              fullResponse,
              finalDocs,
              sanitizedInput.collection || "whole_library",
              sanitizedInput.history || [],
              clientIP,
              restatedQuestion // Pass the restated question
            );

            if (savedDocId) {
              sendData({ docId: savedDocId }); // Send the new docId to the client
            }
          } catch (saveError) {
            // Silently handle save errors to avoid breaking the chat flow
          }
        }
      } catch (error: unknown) {
        handleError(error, sendData);
      } finally {
        if (!isControllerClosed) {
          controller.close();
          isControllerClosed = true;
        }
      }
    },
  });

  const response = new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
  return corsMiddleware.addCorsHeaders(response, req, siteConfig);
}

// Consolidated logging function for better summary messages
function logPerformanceMetrics(metrics: TimingMetrics, stages: Record<string, number>, modelName: string = "unknown") {
  // Use setTimeout to log metrics asynchronously
  setTimeout(() => {
    const summaryMetrics = {
      setup: stages.pineconeComplete ? stages.pineconeComplete - stages.startTime : 0,
      retrieval: stages.retrievalComplete ? stages.retrievalComplete - stages.pineconeComplete : 0,
      llmThinkTime:
        metrics.firstTokenGenerated && stages.retrievalComplete
          ? metrics.firstTokenGenerated - stages.retrievalComplete
          : 0,
      tokenDelivery:
        metrics.firstByteTime && metrics.firstTokenGenerated ? metrics.firstByteTime - metrics.firstTokenGenerated : 0,
      ttfb: metrics.firstByteTime ? metrics.firstByteTime - stages.startTime : 0,
      streaming:
        metrics.firstByteTime && metrics.totalTime ? metrics.totalTime - (metrics.firstByteTime - stages.startTime) : 0,
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
  }, 0); // Using setTimeout with 0 delay to execute after the current execution stack
}
