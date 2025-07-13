/**
 * @fileoverview Manages related question functionality using OpenAI embeddings and Pinecone vector search.
 *
 * Core Workflow:
 * 1. Initialization (`initializeClients`): Sets up OpenAI and Pinecone clients, checking for API keys (OPENAI_API_KEY, PINECONE_API_KEY) and SITE_ID env vars.
 * 2. Pinecone Index Management (`getPineconeIndexName`, `getPineconeIndex`): Creates or retrieves an environment-specific Pinecone index (e.g., `dev-related-questions`) with the correct dimension (`embeddingDimension`) for the chosen OpenAI model (`embeddingModel`).
 * 3. Embedding Generation (`getEmbedding`): Takes text, cleans it, and uses the OpenAI client to generate a vector embedding.
 * 4. Vector Upsert (`upsertEmbeddings`): Takes `Answer` objects, generates embeddings for their questions, and upserts them into Pinecone in batches. Includes `siteId` and truncated `title` in metadata.
 * 5. Vector Search (`findRelatedQuestionsPinecone`): Embeds a query question, searches Pinecone for similar vectors (filtering by `siteId`), retrieves matched IDs and metadata (including truncated titles) from Pinecone, filters by similarity score and title uniqueness, and returns the top results.
 * 6. Firestore Retrieval (`getRelatedQuestions`): Fetches pre-calculated related questions (stored in the `relatedQuestionsV2` field) for a given question ID from Firestore.
 * 7. Batch Update (`updateRelatedQuestionsBatch`): The main orchestration function. It reads a progress marker, fetches Firestore documents in batches (`getQuestionsBatch`), upserts their embeddings (`upsertEmbeddings`), finds related questions via Pinecone search (`findRelatedQuestionsPinecone`), updates the `relatedQuestionsV2` field in Firestore for each document, and updates the progress marker. Designed for periodic execution.
 * 8. Single Update (`updateRelatedQuestions`): Updates related questions for one specific document on demand, ensuring its embedding exists first.
 *
 * Key Dependencies:
 * - Environment Variables: OPENAI_API_KEY, PINECONE_API_KEY, SITE_ID, PINECONE_CLOUD, PINECONE_REGION.
 * - Firestore: Used for storing source questions/answers, progress tracking, and the calculated `relatedQuestionsV2` list.
 * - Pinecone: Used for vector storage and similarity search.
 * - OpenAI: Used for generating text embeddings.
 */

import { Pinecone, Index as PineconeIndex, ServerlessSpecCloudEnum } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import firebase from "firebase-admin"; // Import firebase for FieldPath
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/services/firebase";
import { getAnswersCollectionName } from "@/utils/server/firestoreUtils";
import { getEnvName } from "@/utils/env";
import { getAnswersByIds } from "@/utils/server/answersUtils";
import { Answer } from "@/types/answer";
import { RelatedQuestion } from "@/types/RelatedQuestion";
import {
  firestoreGet,
  firestoreSet,
  firestoreUpdate,
  firestoreQueryGet,
  firestoreBatchCommit,
} from "@/utils/server/firestoreRetryUtils";

// --- Client Initialization ---

// Global OpenAI client instance. Lazily initialized by initializeClients().
let openai: OpenAI | null = null;

// Global Pinecone client instance and index reference. Lazily initialized by initializeClients().
let pinecone: Pinecone | null = null;
let pineconeIndex: PineconeIndex | null = null;
// Stores the name of the currently active Pinecone index to ensure consistency.
let currentPineconeIndexName: string | null = null;

// Initialization flag to prevent redundant concurrent initializations.
let isInitializing = false;

/**
 * Initializes OpenAI and Pinecone clients if they haven't been already.
 * Ensures required API keys and SITE_ID environment variables are present.
 * Handles potential initialization errors and resets clients to allow retries.
 * This function is designed to be called before any operation requiring these clients.
 */
async function initializeClients() {
  // Avoid re-initialization if clients are already set up.
  if (pinecone && openai && pineconeIndex) return;
  // Prevent multiple concurrent initialization attempts.
  if (isInitializing) return;

  isInitializing = true;

  try {
    // Retrieve necessary credentials and configuration from environment variables.
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const siteId = process.env.SITE_ID; // Although not directly used for clients, it's crucial for operations.

    // Validate the presence of required environment variables.
    if (!openaiApiKey || !pineconeApiKey || !siteId) {
      console.error(
        "Missing required environment variables for Pinecone/OpenAI. Check OPENAI_API_KEY, PINECONE_API_KEY, SITE_ID."
      );
      throw new Error("Missing required environment variables for Pinecone/OpenAI integration.");
    }

    // Initialize OpenAI client if it doesn't exist.
    if (!openai) {
      openai = new OpenAI({ apiKey: openaiApiKey });
    }

    // Initialize Pinecone client if it doesn't exist.
    if (!pinecone) {
      pinecone = new Pinecone({
        apiKey: pineconeApiKey,
      });
      // Immediately attempt to get or create the Pinecone index after client setup.
      await getPineconeIndex();
    } else if (!pineconeIndex) {
      // If Pinecone client exists but index is not set (e.g., after a previous error), try again.
      await getPineconeIndex();
    }
  } catch (error) {
    console.error("Error during client initialization:", error);
    // Reset clients on failure to allow subsequent initialization attempts.
    openai = null;
    pinecone = null;
    pineconeIndex = null;
    currentPineconeIndexName = null;
    // Propagate the error to inform the caller about the failure.
    throw error;
  } finally {
    // Reset the initialization flag regardless of success or failure.
    isInitializing = false;
  }
}

// --- Pinecone Index Management ---

/**
 * Constructs the Pinecone index name based solely on the current environment ('dev' or 'prod').
 * This ensures environment separation for vector data.
 * @returns {string} The environment-specific Pinecone index name (e.g., "dev-related-questions").
 */
function getPineconeIndexName(): string {
  const envName = getEnvName(); // e.g., 'dev' or 'prod'
  // Standardized naming convention for the index.
  return `${envName}-related-questions`.toLowerCase();
}

// Constants defining the embedding model and its expected dimension.
// Crucial for index creation and vector upsert consistency.
// TODO: Make sure these constants always load from environment variables and never use defaults. It
// might be necessary to move these constants into functions where they are being used rather than
// having them at top level.
const embeddingModel = process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-large";
const embeddingDimension = parseInt(process.env.OPENAI_EMBEDDINGS_DIMENSION || "3072");

/**
 * Retrieves the Pinecone index instance, creating it if necessary.
 * Assumes the Pinecone client (`pinecone`) has been initialized.
 * Handles index creation, waits for it to become ready, and manages potential errors.
 * @returns {Promise<PineconeIndex>} A promise resolving to the Pinecone index instance.
 * @throws {Error} If the Pinecone client is not initialized or if index access/creation fails.
 */
async function getPineconeIndex(): Promise<PineconeIndex> {
  // Ensure the Pinecone client is available before proceeding.
  if (!pinecone) throw new Error("Pinecone client accessed before initialization.");

  const indexName = getPineconeIndexName();
  // Return the existing index instance if it's already set and matches the expected name.
  if (pineconeIndex && currentPineconeIndexName === indexName) {
    return pineconeIndex;
  }

  // Store the name of the index we intend to use.
  currentPineconeIndexName = indexName;

  try {
    // Check if the index already exists in the Pinecone project.
    const existingIndexes = await pinecone.listIndexes();
    const indexExists = existingIndexes.indexes?.some((index) => index.name === indexName);

    // If the index does not exist, create it.
    if (!indexExists) {
      // Retrieve Pinecone cloud and region settings from environment variables, defaulting if not set.
      const pineconeCloud = (process.env.PINECONE_CLOUD || "aws") as ServerlessSpecCloudEnum;
      const pineconeRegion = process.env.PINECONE_REGION || "us-west-2";

      // Create the index with the specified name, dimension, metric, and serverless configuration.
      await pinecone.createIndex({
        name: indexName,
        dimension: embeddingDimension, // Dimension must match the embedding model.
        metric: "cosine", // Cosine similarity is suitable for text embeddings.
        spec: {
          serverless: {
            // Defines the cloud provider and region for the serverless index.
            cloud: pineconeCloud,
            region: pineconeRegion,
          },
        },
      });

      // Wait for the newly created index to become ready.
      let indexDescription = await pinecone.describeIndex(indexName);
      const maxWaitTime = 5 * 60 * 1000; // Set a maximum wait time (5 minutes).
      const startTime = Date.now(); // Re-add startTime
      // Poll the index status until it's 'Ready' or the timeout is reached.
      while (indexDescription?.status?.state !== "Ready" && Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds.
        indexDescription = await pinecone.describeIndex(indexName);
      }

      // Check if the index became ready within the timeout period.
      if (indexDescription?.status?.state !== "Ready") {
        throw new Error(`Index ${indexName} did not become ready within the timeout period.`);
      }
    }

    // Get a reference to the index (either newly created or existing).
    pineconeIndex = pinecone.index(indexName);
    return pineconeIndex;
  } catch (error) {
    // Log and handle errors during index access or creation.
    console.error(`Error accessing or creating Pinecone index ${indexName}:`, error);
    // Reset index state on error.
    pineconeIndex = null;
    currentPineconeIndexName = null;
    throw error; // Re-throw the error to signal failure.
  }
}

// --- Database Utility ---

/**
 * Checks if the Firestore database client (`db`) is available.
 * @throws {Error} If the database client is not initialized.
 */
function checkDbAvailable(): void {
  if (!db) {
    throw new Error("Database not available");
  }
}

// --- Embedding Generation ---

/**
 * Generates vector embeddings for multiple text inputs in a single API call.
 * Much more efficient than making individual API calls for each text.
 * @param {string[]} texts - Array of text inputs to embed.
 * @returns {Promise<number[][]>} A promise resolving to an array of embedding vectors.
 * @throws {Error} If OpenAI client initialization fails or embedding generation fails.
 */
async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  // Ensure OpenAI client is ready
  await initializeClients();
  if (!openai) throw new Error("OpenAI client accessed before initialization.");

  // Filter out empty texts
  const validTexts = texts.filter((text) => text && text.trim().length > 0);
  if (validTexts.length === 0) {
    console.warn("Attempted to get embeddings for empty texts array.");
    return [];
  }

  try {
    // Clean the texts by replacing newlines
    const cleanedTexts = validTexts.map((text) => text.replace(/\n/g, " "));

    // Request embeddings for all texts in a single API call
    const response = await openai.embeddings.create({
      model: embeddingModel,
      input: cleanedTexts,
    });

    // Return the array of embedding vectors
    return response.data.map((item) => item.embedding);
  } catch (error) {
    console.error("Error getting batch embeddings from OpenAI:", error);
    throw error;
  }
}

/**
 * Generates a vector embedding for the given text using the configured OpenAI model.
 * Handles empty input and cleans the text before sending it to OpenAI.
 * @param {string} text - The input text to embed.
 * @returns {Promise<number[]>} A promise resolving to the embedding vector (array of numbers).
 * @throws {Error} If OpenAI client initialization fails or embedding generation fails.
 */
async function getEmbedding(text: string): Promise<number[]> {
  // Ensure OpenAI client is ready.
  await initializeClients();
  if (!openai) throw new Error("OpenAI client accessed before initialization.");

  // Handle empty or whitespace-only input gracefully.
  if (!text || text.trim().length === 0) {
    console.warn("Attempted to get embedding for empty text.");
    return []; // Return an empty array as embedding cannot be generated.
  }
  try {
    // Clean the text by replacing newlines, which can negatively affect embedding quality.
    const cleanedText = text.replace(/\n/g, " ");
    // Request the embedding from OpenAI API.
    const response = await openai.embeddings.create({
      model: embeddingModel, // Use the globally defined model.
      input: cleanedText,
    });
    // Return the generated embedding vector.
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error getting embedding from OpenAI:", error);
    // Rethrow the error for upstream handling.
    throw error;
  }
}

// --- Pinecone Data Operations ---

/**
 * Generates embeddings for a list of questions and upserts them into the Pinecone index.
 * Includes the `siteId` and a truncated `title` in the vector metadata for filtering and identification.
 * Handles potential errors during embedding generation and upserts vectors in batches.
 * @param {Answer[]} questions - An array of Answer objects containing questions to embed.
 * @param {number[][]} [providedEmbeddings] - Optional pre-computed embeddings matching the questions array.
 * @throws {Error} If Pinecone index is not available, SITE_ID is missing, or upsert fails.
 */
export async function upsertEmbeddings(questions: Answer[], providedEmbeddings?: number[][]): Promise<void> {
  console.log(`[DEBUG upsertEmbeddings] Called with ${questions.length} questions.`, {
    questionIds: questions.map((q) => q.id).join(", ") || "No IDs",
    hasProvidedEmbeddings: !!providedEmbeddings,
  });

  // Ensure Pinecone client and index are ready.
  await initializeClients();
  if (!pineconeIndex || !currentPineconeIndexName) {
    console.error("[DEBUG upsertEmbeddings] Pinecone index not available for upsert.");
    throw new Error("Pinecone index not available for upsert.");
  }

  // Retrieve the current SITE_ID for embedding metadata. This is crucial for multi-tenant filtering.
  const currentSiteId = process.env.SITE_ID;
  if (!currentSiteId) {
    console.error("[DEBUG upsertEmbeddings] SITE_ID environment variable is not set.");
    throw new Error("upsertEmbeddings: SITE_ID environment variable is not set.");
  }
  console.log(`[DEBUG upsertEmbeddings] Using SITE_ID: ${currentSiteId}`);

  // Filter out invalid questions
  const validQuestions = questions.filter((q) => q.id && q.question && typeof q.question === "string");

  if (validQuestions.length === 0) {
    console.warn("[DEBUG upsertEmbeddings] No valid questions to process for embeddings.");
    return;
  }
  console.log(`[DEBUG upsertEmbeddings] Processing ${validQuestions.length} valid questions.`);

  try {
    let embeddings: number[][];

    if (providedEmbeddings) {
      console.log(`[DEBUG upsertEmbeddings] Using ${providedEmbeddings.length} provided embeddings.`);
      // Validate provided embeddings
      if (providedEmbeddings.length !== validQuestions.length) {
        const errorMsg = `upsertEmbeddings: Mismatch between questions (${validQuestions.length}) and provided embeddings (${providedEmbeddings.length}).`;
        console.error(`[DEBUG upsertEmbeddings] ${errorMsg}`);
        throw new Error(errorMsg);
      }
      embeddings = providedEmbeddings;
    } else {
      console.log("[DEBUG upsertEmbeddings] Generating embeddings for valid questions.");
      // Generate embeddings if not provided
      const textsToEmbed = validQuestions.map((q) => q.question);
      // Timer for batch embeddings is within getBatchEmbeddings itself
      embeddings = await getBatchEmbeddings(textsToEmbed);
      console.log(`[DEBUG upsertEmbeddings] Generated ${embeddings.length} embeddings.`);
      // Basic validation after internal generation
      if (embeddings.length !== validQuestions.length) {
        const errorMsg = `upsertEmbeddings: Mismatch after internal generation between questions (${validQuestions.length}) and embeddings (${embeddings.length}).`;
        console.error(`[DEBUG upsertEmbeddings] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    // Prepare vectors for upserting
    const vectors = [];
    for (let i = 0; i < validQuestions.length; i++) {
      const q = validQuestions[i];
      const embedding = embeddings[i];

      // Only proceed if embedding generation was successful
      if (embedding && embedding.length > 0) {
        // Extract metadata for debugging
        const titleForMetadata = q.question.substring(0, 140);
        console.log(
          `[DEBUG upsertEmbeddings] Preparing vector for question ID: ${q.id}, title snippet: "${titleForMetadata}"`
        );

        // Construct the vector object for Pinecone
        vectors.push({
          id: q.id, // Use Firestore document ID as the vector ID
          values: embedding, // The generated embedding vector
          metadata: {
            // Include relevant metadata for filtering and display
            title: titleForMetadata, // Truncated title for potential display
            siteId: currentSiteId, // Site ID for filtering search results
          },
        });
      } else {
        console.warn(`[DEBUG upsertEmbeddings] Skipping vector for question ID: ${q.id} due to empty embedding.`);
      }
    }

    // If no valid vectors were generated, exit early.
    if (vectors.length === 0) {
      console.log("[DEBUG upsertEmbeddings] No valid embeddings generated for upsert in this batch.");
      return;
    }
    console.log(`[DEBUG upsertEmbeddings] Prepared ${vectors.length} vectors for upsert.`);

    // Upsert vectors to Pinecone in batches
    const batchSize = 100; // Pinecone recommends batch sizes of 100 or fewer
    console.log(`[DEBUG upsertEmbeddings] Upserting vectors in batches of ${batchSize}.`);
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      // Perform the upsert operation for the current batch
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(vectors.length / batchSize);
      console.log(
        `[DEBUG upsertEmbeddings] Processing batch ${batchNum}/${totalBatches}, size: ${batch.length}. IDs: ${batch.map((v) => v.id).join(", ")}`
      );

      // Add retry logic for Pinecone upsert
      const maxUpsertRetries = 3;
      let upsertRetryDelay = process.env.NODE_ENV === "test" ? 10 : 1000; // Start with shorter delay in test
      let upsertSuccess = false;

      for (let attempt = 1; attempt <= maxUpsertRetries; attempt++) {
        try {
          console.log(`[DEBUG upsertEmbeddings] Attempt ${attempt}/${maxUpsertRetries} to upsert batch ${batchNum}.`);
          const upsertResponse = await pineconeIndex.upsert(batch);
          console.log(
            `[DEBUG upsertEmbeddings] Batch ${batchNum} upsert attempt ${attempt} response:`,
            JSON.stringify(upsertResponse, null, 2)
          );

          // Add a small delay here to allow Pinecone a moment to process the upsert
          const verificationDelayMs = 500; // 500ms delay
          console.log(
            `[DEBUG upsertEmbeddings] Waiting ${verificationDelayMs}ms before verification fetch for batch ${batchNum}, attempt ${attempt}.`
          );
          await new Promise((resolve) => setTimeout(resolve, verificationDelayMs));

          // Verify the upsert by fetching the first vector
          if (batch.length > 0) {
            const firstId = batch[0].id;
            console.log(`[DEBUG upsertEmbeddings] Verifying upsert for batch ${batchNum} by fetching ID: ${firstId}.`);
            const verifyResponse = await pineconeIndex.fetch([firstId]);
            const record = verifyResponse.records[firstId];
            const { values, ...otherFields } = record || {};
            console.log(
              `[DEBUG upsertEmbeddings] Verification fetch response for ID ${firstId}:`,
              `Found record with ${values?.length || 0} values and metadata:`,
              JSON.stringify(otherFields, null, 2)
            );

            if (!verifyResponse.records[firstId]) {
              console.error(
                `[DEBUG upsertEmbeddings] VERIFICATION FAILED for batch ${batchNum} - ID ${firstId} not found in Pinecone after upsert attempt ${attempt}. Records found: ${Object.keys(verifyResponse.records).length}`
              );
              // Continue to retry if verification fails within attempts
            } else {
              console.log(`[DEBUG upsertEmbeddings] Verification SUCCESS for batch ${batchNum}, ID ${firstId} found.`);
              upsertSuccess = true;
              break; // Exit retry loop on successful verification
            }
          } else {
            // If batch was empty (should not happen with current logic but good to handle)
            console.log(`[DEBUG upsertEmbeddings] Batch ${batchNum} was empty, no verification needed.`);
            upsertSuccess = true;
            break;
          }
        } catch (upsertError: any) {
          console.error(
            `[DEBUG upsertEmbeddings] Error during upsert attempt ${attempt} for batch ${batchNum}:`,
            upsertError
          );
          // Check for retryable errors
          const errorMessage = String(upsertError?.message || upsertError);
          const causedBy = upsertError?.cause ? String(upsertError.cause?.message || upsertError.cause) : "";
          const isRetryableError =
            errorMessage.includes("getaddrinfo") ||
            errorMessage.includes("EBUSY") ||
            errorMessage.includes("ECONNRESET") ||
            errorMessage.includes("ETIMEDOUT") ||
            errorMessage.includes("failed to reach Pinecone") ||
            causedBy.includes("getaddrinfo") ||
            causedBy.includes("EBUSY");

          if (isRetryableError && attempt < maxUpsertRetries) {
            console.log(
              `[DEBUG upsertEmbeddings] Retrying upsert for batch ${batchNum}/${totalBatches} after ${upsertRetryDelay}ms (attempt ${attempt}/${maxUpsertRetries})...`
            );
            await new Promise((resolve) => setTimeout(resolve, upsertRetryDelay));
            upsertRetryDelay *= 2; // Exponential backoff
          } else {
            console.error(
              `[DEBUG upsertEmbeddings] Non-retryable error or max retries reached for batch ${batchNum} upsert (attempt ${attempt}/${maxUpsertRetries}):`,
              upsertError
            );
            // If verification failed on the last attempt, this is where we'd note it.
            // However, the error thrown here would be the upsertError, not a verification specific error.
            throw upsertError; // Re-throw to be caught by outer try/catch
          }
        }
      } // End of retry loop

      if (!upsertSuccess) {
        // This means all upsert attempts (including verification) failed for the batch
        const errorMsg = `[DEBUG upsertEmbeddings] All ${maxUpsertRetries} upsert/verification attempts failed for batch ${batchNum}/${totalBatches}. First ID in batch: ${batch.length > 0 ? batch[0].id : "N/A"}.`;
        console.error(errorMsg);
        throw new Error(
          errorMsg // More specific error
        );
      } else {
        console.log(`[DEBUG upsertEmbeddings] Batch ${batchNum}/${totalBatches} successfully upserted and verified.`);
      }
    }
    console.log("[DEBUG upsertEmbeddings] All batches processed.");
  } catch (error) {
    // Log and rethrow errors encountered during the Pinecone upsert operation
    console.error("[DEBUG upsertEmbeddings] Error during overall upsertEmbeddings process:", error);
    throw error;
  } finally {
    console.log("[DEBUG upsertEmbeddings] Exiting function.");
  }
}

// --- Related Questions Retrieval (Firestore) ---

/**
 * Fetches pre-computed related questions for a given question ID directly from Firestore.
 * This reads the `relatedQuestionsV2` field which should contain { id, title, similarity }.
 * @param {string} questionId - The ID of the question for which to fetch related questions.
 * @returns {Promise<Answer[]>} A promise resolving to an array of full Answer objects for related questions.
 */
export async function getRelatedQuestions(questionId: string): Promise<Answer[]> {
  // Ensure Firestore DB is available.
  checkDbAvailable();

  const docRef = db!.collection(getAnswersCollectionName()).doc(questionId);
  const doc = await docRef.get();

  // Handle cases where the source document doesn't exist.
  if (!doc.exists) {
    console.error(
      // Changed from warn based on user edit
      `QA document not found for getRelatedQuestions: ${questionId}`
    );
    return [];
  }

  const docData = doc.data();
  // Handle defensively in case data is missing despite document existence.
  if (!docData) {
    console.warn(`Document data undefined for existing doc: ${questionId}`);
    return [];
  }

  // Extract the stored related question IDs and filter out the source question itself.
  const relatedQuestionsInfo: RelatedQuestion[] = docData.relatedQuestionsV2 || []; // Assumes { id, title, similarity } structure.
  const relatedQuestionIds = relatedQuestionsInfo.map((q) => q.id).filter((id) => id !== questionId); // Exclude the source question ID.

  // If no related IDs found, return empty array.
  if (relatedQuestionIds.length === 0) {
    return [];
  }

  try {
    // Fetch the full details of the related questions using their IDs.
    const relatedQuestions = await getAnswersByIds(relatedQuestionIds);
    return relatedQuestions;
  } catch (error) {
    // Log errors during the fetching of full answer details.
    console.error(`Error fetching full answers for related IDs [${relatedQuestionIds.join(", ")}]:`, error);
    return []; // Return empty array on error.
  }
}

// --- Batch Processing ---

/**
 * Fetches a batch of questions from Firestore, starting after the specified lastProcessedId.
 * @param {string | null} lastProcessedId - The ID of the last successfully processed question, or null to start from the beginning.
 * @param {number} batchSize - The number of questions to fetch in this batch.
 * @returns {Promise<Answer[]>} A promise resolving to an array of Answer objects from Firestore.
 */
async function getQuestionsBatch(lastProcessedId: string | null, batchSize: number): Promise<Answer[]> {
  checkDbAvailable();

  try {
    // Build the base query for the answers collection.
    let query = db!
      .collection(getAnswersCollectionName())
      // Order by document ID for consistent pagination
      .orderBy(firebase.firestore.FieldPath.documentId());

    // If a lastProcessedId is provided, start the query after that document.
    if (lastProcessedId) {
      // Get a reference to the document to start after.
      const lastProcessedDoc = await firestoreGet(
        db!.collection(getAnswersCollectionName()).doc(lastProcessedId),
        "document get for cursor",
        `lastProcessedId: ${lastProcessedId}`
      );

      // Handle case where the lastProcessedId document no longer exists.
      if (!lastProcessedDoc.exists) {
        console.warn(`Last processed question ID ${lastProcessedId} no longer exists. Starting from the beginning.`);
      } else {
        // Add the startAfter cursor to the query.
        query = query.startAfter(lastProcessedDoc);
      }
    }

    // Limit the query to the specified batch size.
    query = query.limit(batchSize);

    // Execute the query with error handling
    const querySnapshot = await firestoreQueryGet(
      query,
      "batch query",
      `batchSize: ${batchSize}, after: ${lastProcessedId || "START"}`
    );

    // Extract the complete question data from the query results.
    const questions = querySnapshot.docs.map(
      (doc: firebase.firestore.QueryDocumentSnapshot) =>
        ({
          ...doc.data(),
          id: doc.id,
        }) as Answer
    );
    return questions;
  } catch (error) {
    console.error("Error during question batch retrieval:", error);
    throw error; // Re-throw the error to be handled by the caller.
  }
}

/**
 * Finds related questions for a single question using Pinecone vector search.
 * Generates an embedding for the input question text, queries Pinecone filtering by the current `siteId`,
 * includes metadata (truncated title) in the results, filters results by similarity score
 * and unique truncated title (compared to source's metadata title, if found), and returns the top 5 related questions.
 * @param {string} questionId - The ID of the source question (used to filter itself from results).
 * @param {string} questionText - The text of the source question to find related questions for.
 * @param {number} [resultsLimit=5] - The maximum number of related questions to return.
 * @returns {Promise<RelatedQuestion[]>} A promise resolving to an array of related questions ({ id, title, similarity }).
 * @throws {Error} If Pinecone index is not available or SITE_ID is missing.
 */
export async function findRelatedQuestionsPinecone(
  questionId: string,
  questionText: string,
  resultsLimit: number = 5
): Promise<RelatedQuestion[]> {
  // Ensure required clients and configuration are ready.
  await initializeClients();
  if (!pineconeIndex) throw new Error("Pinecone index not available for query.");

  const currentSiteId = process.env.SITE_ID;
  if (!currentSiteId) {
    throw new Error("findRelatedQuestionsPinecone: SITE_ID environment variable is not set.");
  }

  // Constants for filtering
  const topK = 20; // Request more initial candidates from Pinecone
  const similarityThreshold = 0.62; // Minimum similarity score
  const maxSourceMetaRetries = process.env.NODE_ENV === "test" ? 3 : 10; // Reduced retries in test
  const initialRetryDelay = process.env.NODE_ENV === "test" ? 10 : 500; // Much shorter delay in test

  let queryEmbedding: number[];
  try {
    queryEmbedding = await getEmbedding(questionText);
    if (queryEmbedding.length === 0) {
      console.warn(`Could not generate embedding for question ID ${questionId}. Skipping search.`);
      return [];
    }
  } catch (error) {
    console.error(`Embedding generation failed for query ${questionId}:`, error);
    return [];
  }

  try {
    // Fetch the source question's metadata with retries and exponential backoff
    let sourceMetadataTitle: string | null = null;
    let retryDelay = initialRetryDelay;

    let attempt = 1;
    for (attempt = 1; attempt <= maxSourceMetaRetries; attempt++) {
      try {
        const sourceFetchResponse = await pineconeIndex.fetch([questionId]);

        // Check if the questionId exists in the records
        if (!sourceFetchResponse.records[questionId]) {
          // Check if any records were returned
          const recordsCount = Object.keys(sourceFetchResponse.records).length;

          if (recordsCount > 0) {
            console.log(`DEBUG: Record keys in response: ${Object.keys(sourceFetchResponse.records).join(", ")}`);
          }
        } else {
          // Record exists, check metadata
          const sourceRecord = sourceFetchResponse.records[questionId];
          if (sourceRecord?.metadata?.title && typeof sourceRecord.metadata.title === "string") {
            sourceMetadataTitle = sourceRecord.metadata.title;
            break; // Exit retry loop on success
          }
        }

        if (attempt < maxSourceMetaRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay *= 2; // Exponential backoff
        }
      } catch (fetchError: any) {
        // Check if there's a cause property on the error
        if (fetchError?.cause) {
          console.error(`Error cause:`, fetchError.cause);
        }

        if (attempt < maxSourceMetaRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay *= 2; // Exponential backoff
        }
      }
    }

    // After all retries, log final status
    if (!sourceMetadataTitle) {
      // Try a direct upsert of the embedding to refresh the metadata
      try {
        const now = Timestamp.now();
        const minimalAnswer: Answer = {
          id: questionId,
          question: questionText,
          answer: "",
          timestamp: { _seconds: now.seconds, _nanoseconds: now.nanoseconds },
          likeCount: 0,
        };

        await upsertEmbeddings([minimalAnswer]);

        // Try one more fetch after refresh with a longer delay
        const finalDelayMs = process.env.NODE_ENV === "test" ? 10 : 5000; // Much shorter final delay in test
        await new Promise((resolve) => setTimeout(resolve, finalDelayMs));

        const finalFetchResponse = await pineconeIndex.fetch([questionId]);

        const refreshedRecord = finalFetchResponse.records[questionId];
        if (refreshedRecord?.metadata?.title && typeof refreshedRecord.metadata.title === "string") {
          sourceMetadataTitle = refreshedRecord.metadata.title;
        }
      } catch (refreshError) {
        console.error(`Error during embedding refresh:`, refreshError);
      }
    }

    // If we still don't have the source title after all retries, we'll proceed without it

    // Construct the Pinecone query object
    const pineconeQuery = {
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true,
      includeValues: false,
      filter: { siteId: { $eq: currentSiteId } },
    };

    // Add retry logic for Pinecone query
    const maxQueryRetries = process.env.NODE_ENV === "test" ? 2 : 3;
    let queryRetryDelay = process.env.NODE_ENV === "test" ? 10 : 1000; // Start with shorter delay in test
    let queryResponse;
    let querySuccess = false;

    for (let attempt = 1; attempt <= maxQueryRetries; attempt++) {
      try {
        queryResponse = await pineconeIndex.query(pineconeQuery);
        querySuccess = true;
        break;
      } catch (queryError: any) {
        const errorMessage = String(queryError?.message || queryError);
        const causedBy = queryError?.cause ? String(queryError.cause?.message || queryError.cause) : "";
        const isRetryableError =
          errorMessage.includes("getaddrinfo") ||
          errorMessage.includes("EBUSY") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("ETIMEDOUT") ||
          errorMessage.includes("failed to reach Pinecone") ||
          causedBy.includes("getaddrinfo") ||
          causedBy.includes("EBUSY");

        if (isRetryableError && attempt < maxQueryRetries) {
          await new Promise((resolve) => setTimeout(resolve, queryRetryDelay));
          queryRetryDelay *= 2;
        } else {
          console.error(
            `Error querying Pinecone for question ID ${questionId} (attempt ${attempt}/${maxQueryRetries}):`,
            queryError
          );
          throw queryError; // Re-throw to be caught by outer try/catch
        }
      }
    }

    if (!querySuccess || !queryResponse) {
      throw new Error(`All ${maxQueryRetries} Pinecone query attempts failed for ${questionId}`);
    }

    const matches = queryResponse.matches || [];

    // Process the matches: filter out source, apply similarity threshold, and strictly enforce title uniqueness
    const related: RelatedQuestion[] = [];
    const seenTitles = new Map<string, { index: number; similarity: number }>();

    for (const match of matches) {
      const metadataTitle = match.metadata?.title;

      // Apply filters: not self, score threshold, metadata title exists, and title doesn't match source's metadata title.
      if (
        match.id !== questionId &&
        match.score !== undefined &&
        match.score >= similarityThreshold &&
        metadataTitle &&
        typeof metadataTitle === "string" &&
        metadataTitle !== sourceMetadataTitle // Strict title uniqueness check
      ) {
        if (seenTitles.has(metadataTitle)) {
          // We've seen this title before - check if this one has a higher score
          const existingEntry = seenTitles.get(metadataTitle)!;
          if (match.score > existingEntry.similarity) {
            // This one has a higher score - replace the existing entry
            related[existingEntry.index] = {
              id: match.id,
              title: metadataTitle,
              similarity: match.score,
            };
            seenTitles.set(metadataTitle, {
              index: existingEntry.index,
              similarity: match.score,
            });
          }
        } else {
          // New unique title - add it
          const newIndex = related.length;
          related.push({
            id: match.id,
            title: metadataTitle,
            similarity: match.score,
          });
          seenTitles.set(metadataTitle, {
            index: newIndex,
            similarity: match.score,
          });
        }
      }
    }

    // Sort by similarity score and return top N results
    related.sort((a, b) => b.similarity - a.similarity);
    return related.slice(0, resultsLimit);
  } catch (error) {
    console.error(`Error querying Pinecone for question ID ${questionId}:`, error);
    throw error; // Re-throw to be handled by caller
  }
}

/**
 * Finds related questions using a pre-computed embedding.
 * Queries Pinecone filtering by the current `siteId`,
 * includes metadata (truncated title), filters results by similarity score
 * and unique truncated title, and returns the top N related questions.
 * Does NOT generate an embedding; assumes it's provided.
 *
 * @param {string} questionId - The ID of the source question.
 * @param {number[]} queryEmbedding - The pre-computed embedding vector for the source question.
 * @param {number} [resultsLimit=5] - The maximum number of related questions to return.
 * @returns {Promise<RelatedQuestion[]>} A promise resolving to an array of related questions.
 * @throws {Error} If Pinecone index not available or SITE_ID is missing.
 */
async function findRelatedQuestionsPineconeWithEmbedding(
  questionId: string,
  queryEmbedding: number[],
  resultsLimit: number = 5
): Promise<RelatedQuestion[]> {
  // Ensure required clients and configuration are ready.
  // No need to await initializeClients() here as it's called by the batch process before this.
  if (!pineconeIndex)
    throw new Error("findRelatedQuestionsPineconeWithEmbedding: Pinecone index not available for query.");

  const currentSiteId = process.env.SITE_ID;
  if (!currentSiteId) {
    throw new Error("findRelatedQuestionsPineconeWithEmbedding: SITE_ID environment variable is not set.");
  }

  // Constants for filtering
  const topK = 20; // Request more initial candidates from Pinecone
  const similarityThreshold = 0.62; // Minimum similarity score

  // Validate provided embedding
  if (!queryEmbedding || queryEmbedding.length === 0) {
    console.warn(
      `[findRelatedQuestionsPineconeWithEmbedding] Empty embedding provided for question ID ${questionId}. Skipping search.`
    );
    return [];
  }

  try {
    // Fetch the source question's metadata (specifically its truncated title) from Pinecone
    let sourceMetadataTitle: string | null = null;

    // Add retry logic for fetching source metadata
    const maxMetadataRetries = 3;
    let metadataRetryDelay = process.env.NODE_ENV === "test" ? 10 : 1000; // Start with shorter delay in test
    let metadataFetchSuccess = false;

    for (let attempt = 1; attempt <= maxMetadataRetries; attempt++) {
      try {
        const sourceFetchResponse = await pineconeIndex.fetch([questionId]);
        const sourceRecord = sourceFetchResponse.records[questionId];
        if (sourceRecord?.metadata?.title && typeof sourceRecord.metadata.title === "string") {
          sourceMetadataTitle = sourceRecord.metadata.title;
        } else {
          console.log(
            `Could not fetch or find metadata title for source question ${questionId} in Pinecone. Proceeding without exact title filtering.`
          );
        }
        metadataFetchSuccess = true;
        break; // Exit retry loop on success
      } catch (fetchError: any) {
        // Check for retryable errors (like DNS, connection, EBUSY)
        const errorMessage = String(fetchError?.message || fetchError);
        const causedBy = fetchError?.cause ? String(fetchError.cause?.message || fetchError.cause) : "";
        const isRetryableError =
          errorMessage.includes("getaddrinfo") ||
          errorMessage.includes("EBUSY") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("ETIMEDOUT") ||
          errorMessage.includes("failed to reach Pinecone") ||
          causedBy.includes("getaddrinfo") ||
          causedBy.includes("EBUSY");

        if (isRetryableError && attempt < maxMetadataRetries) {
          await new Promise((resolve) => setTimeout(resolve, metadataRetryDelay));
          metadataRetryDelay *= 2; // Exponential backoff
        } else {
          console.log(
            `Error fetching source question ${questionId} metadata from Pinecone (attempt ${attempt}/${maxMetadataRetries}): ${fetchError}. Proceeding without exact title filtering.`
          );
          break; // Exit retry loop on non-retryable error or max retries
        }
      }
    }

    if (!metadataFetchSuccess) {
      console.log(
        `All ${maxMetadataRetries} metadata fetch attempts failed for ${questionId}. Continuing without metadata.`
      );
    }

    // Construct the Pinecone query object
    const pineconeQuery = {
      vector: queryEmbedding, // Use the provided embedding
      topK: topK,
      includeMetadata: true,
      includeValues: false,
      filter: { siteId: { $eq: currentSiteId } },
    };

    // Add retry logic for Pinecone query
    const maxQueryRetries = process.env.NODE_ENV === "test" ? 2 : 3;
    let queryRetryDelay = process.env.NODE_ENV === "test" ? 10 : 1000; // Start with shorter delay in test
    let queryResponse;
    let querySuccess = false;

    for (let attempt = 1; attempt <= maxQueryRetries; attempt++) {
      try {
        queryResponse = await pineconeIndex.query(pineconeQuery);
        querySuccess = true;
        break;
      } catch (queryError: any) {
        // Check for retryable errors
        const errorMessage = String(queryError?.message || queryError);
        const causedBy = queryError?.cause ? String(queryError.cause?.message || queryError.cause) : "";
        const isRetryableError =
          errorMessage.includes("getaddrinfo") ||
          errorMessage.includes("EBUSY") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("ETIMEDOUT") ||
          errorMessage.includes("failed to reach Pinecone") ||
          causedBy.includes("getaddrinfo") ||
          causedBy.includes("EBUSY");

        if (isRetryableError && attempt < maxQueryRetries) {
          await new Promise((resolve) => setTimeout(resolve, queryRetryDelay));
          queryRetryDelay *= 2; // Exponential backoff
        } else {
          console.error(
            `[findRelatedQuestionsPineconeWithEmbedding] Error querying Pinecone for question ID ${questionId} (attempt ${attempt}/${maxQueryRetries}):`,
            queryError
          );
          throw queryError; // Re-throw to be caught by outer try/catch
        }
      }
    }

    if (!querySuccess || !queryResponse) {
      throw new Error(`All ${maxQueryRetries} Pinecone query attempts failed for ${questionId}`);
    }

    const matches = queryResponse.matches || [];

    // Process the matches
    const related: RelatedQuestion[] = [];
    const seenTitles = new Map<string, { index: number; similarity: number }>();

    for (const match of matches) {
      const metadataTitle = match.metadata?.title;

      if (
        match.id !== questionId &&
        match.score !== undefined &&
        match.score >= similarityThreshold &&
        metadataTitle &&
        typeof metadataTitle === "string"
      ) {
        if (!sourceMetadataTitle || metadataTitle !== sourceMetadataTitle) {
          if (seenTitles.has(metadataTitle)) {
            const existingEntry = seenTitles.get(metadataTitle)!;
            if (match.score > existingEntry.similarity) {
              related[existingEntry.index] = {
                id: match.id,
                title: metadataTitle,
                similarity: match.score,
              };
              seenTitles.set(metadataTitle, {
                index: existingEntry.index,
                similarity: match.score,
              });
            }
          } else {
            const newIndex = related.length;
            related.push({
              id: match.id,
              title: metadataTitle,
              similarity: match.score,
            });
            seenTitles.set(metadataTitle, {
              index: newIndex,
              similarity: match.score,
            });
          }
        }
      }
    }

    // Sort and slice
    related.sort((a, b) => b.similarity - a.similarity);
    return related.slice(0, resultsLimit);
  } catch (error) {
    console.error(
      `[findRelatedQuestionsPineconeWithEmbedding] Error querying Pinecone for question ID ${questionId}:`,
      error
    );
    return [];
  }
}

/**
 * Updates related questions for multiple documents in batches.
 * @param {number} batchSize - The size of each batch to process.
 * @returns {Promise<void>} A promise that resolves when the batch update is complete.
 * @throws {Error} If there are critical errors during the update process.
 */
export async function updateRelatedQuestionsBatch(batchSize: number): Promise<void> {
  // Ensure database and clients are ready before starting.
  checkDbAvailable();
  try {
    await initializeClients();
  } catch (initError) {
    console.error("updateRelatedQuestionsBatch: Aborting due to client initialization failure.", initError);
    return; // Cannot proceed without clients.
  }

  // Double-check Pinecone index availability after initialization attempt.
  if (!pineconeIndex) {
    console.error(
      "updateRelatedQuestionsBatch: Aborting because Pinecone index is not available after initialization."
    );
    return;
  }

  const envName = getEnvName();
  // SITE_ID is crucial for site-specific progress tracking as cron jobs run per deployment.
  const siteIdForProgress = process.env.SITE_ID;
  if (!siteIdForProgress) {
    console.error("updateRelatedQuestionsBatch: Aborting because SITE_ID is not set for progress tracking.");
    return;
  }
  // Construct a unique progress document ID incorporating environment and site ID.
  const progressDocId = `${envName}_${siteIdForProgress}_relatedQuestions_v2`;
  const progressDocRef = db!.collection("progress").doc(progressDocId);

  // --- Progress Tracking ---
  let lastProcessedId: string | null = null;
  try {
    // Attempt to read the last processed ID from the progress document.
    const progressDoc = await firestoreGet(progressDocRef, "progress document get", `progressDocId: ${progressDocId}`);

    lastProcessedId = progressDoc.exists ? progressDoc.data()?.lastProcessedId : null;
  } catch (error) {
    console.error("Error reading progress document:", error);
    // Decide whether to proceed without progress or halt. Proceeding might reprocess data.
    // @TODO: Consider making this a fatal error (fail on this case).
    console.warn("Proceeding without progress tracking information.");
  }

  // --- Fetch Initial Batch ---
  let questions: Answer[];
  try {
    questions = await getQuestionsBatch(lastProcessedId, batchSize);
  } catch (error) {
    console.error("Failed to fetch initial batch of questions:", error);
    return; // Cannot proceed without the first batch.
  }

  // --- Handle End of Collection ---
  // If the batch is empty and we had a lastProcessedId, it means we reached the end.
  if (!questions.length && lastProcessedId) {
    console.log("updateRelatedQuestionsBatch: Reached end of collection, resetting progress and starting over.");
    lastProcessedId = null; // Reset progress marker to null.
    try {
      // Persist the reset progress marker to Firestore.
      await firestoreSet(
        progressDocRef,
        { lastProcessedId: null },
        undefined,
        "progress reset",
        `progressDocId: ${progressDocId}`
      );

      // Fetch the first batch again from the beginning.
      questions = await getQuestionsBatch(null, batchSize);
    } catch (error) {
      console.error("Failed to fetch batch after resetting progress:", error);
      return; // Abort if fetching fails after reset.
    }
  } else if (!questions.length && !lastProcessedId) {
    // If the collection is entirely empty from the start.
    console.log("updateRelatedQuestionsBatch: No questions found in the collection to process.");
    return; // Nothing to do.
  }

  // --- Process Batch ---
  // 1. Generate ALL embeddings needed for this batch upfront.
  let allEmbeddings: number[][] = [];
  try {
    // Use restated question for embeddings if available, otherwise use original question
    const textsToEmbed = questions.map((q) => {
      const questionData = q as any;
      const textForEmbedding = questionData.restatedQuestion || q.question || "";
      if (questionData.restatedQuestion) {
        console.log(`Using restated question for ${q.id}: "${questionData.restatedQuestion}"`);
      }
      return textForEmbedding;
    });
    allEmbeddings = await getBatchEmbeddings(textsToEmbed);

    // Basic validation
    if (allEmbeddings.length !== questions.length) {
      throw new Error(
        `Mismatch between questions (${questions.length}) and generated embeddings (${allEmbeddings.length}). Potential API issue.`
      );
    }
  } catch (error) {
    console.error(`CRITICAL: Failed to generate initial embeddings for batch. Aborting.`, error);
    throw error; // Re-throw the error
  }

  // 2. Upsert Embeddings for the current batch, providing the generated embeddings.
  try {
    // Create a modified questions array that uses the same text that was embedded
    const questionsForUpsert = questions.map((q) => {
      const questionData = q as any;
      const textForEmbedding = questionData.restatedQuestion || q.question || "";
      return {
        ...q,
        question: textForEmbedding, // Use the same text that was embedded
      };
    });

    // Pass the pre-generated embeddings to upsertEmbeddings
    await upsertEmbeddings(questionsForUpsert, allEmbeddings);
  } catch (error) {
    console.error(
      "CRITICAL: Failed to upsert embeddings for batch. Aborting related question updates for this batch to prevent inconsistency.",
      error
    );
    throw error;
  }

  // 3. Find related questions via Pinecone (in parallel) and update Firestore (in batch)
  let updatedCount = 0;
  let errorCount = 0;

  // --- Parallel Pinecone Queries ---
  // NOTE: Linter may incorrectly flag allQueryEmbeddings here, but it's defined in the outer scope.
  const pineconePromises = questions.map((question, index) => {
    // Explicitly type the return structure for clarity within the promise
    type PromiseResult = { results: RelatedQuestion[]; questionId: string } | { error: any; questionId: string };

    // Linter error on next line is likely incorrect due to scope complexity.
    const queryEmbedding = allEmbeddings[index]; // Use the embeddings generated in Step 1

    // Use the same text that was used for embedding generation
    const questionData = question as any;
    const textForEmbedding = questionData.restatedQuestion || question.question || "";

    // Basic validation before creating the promise
    if (!question.id || !textForEmbedding || !queryEmbedding || queryEmbedding.length === 0) {
      console.warn(
        `Skipping Pinecone query for item ${question.id || "[NO_ID]"}: Missing data or failed query embedding.`
      );
      // Return a resolved promise with an explicit error indicator for this item
      return Promise.resolve<PromiseResult>({
        error: "skipped",
        questionId: question.id || "unknown",
      });
    }

    // Return the promise from findRelatedQuestionsPineconeWithEmbedding
    return findRelatedQuestionsPineconeWithEmbedding(question.id, queryEmbedding, 5)
      .then((results): PromiseResult => ({ results, questionId: question.id })) // Attach questionId for matching later
      .catch((error): PromiseResult => {
        // Catch errors from the findRelatedQuestions function itself
        console.error(`Error in findRelatedQuestionsPineconeWithEmbedding for ${question.id}:`, error);
        return { error: error, questionId: question.id };
      });
  });

  // Wait for all Pinecone queries to settle (either succeed or fail)
  const pineconeResults = await Promise.allSettled(pineconePromises);

  // --- Batched Firestore Updates ---
  const itemsToUpdate: { id: string; data: RelatedQuestion[] }[] = []; // Store successful updates
  const itemsWithErrors: string[] = []; // Store IDs of items that failed Pinecone query

  pineconeResults.forEach((result, index) => {
    const question = questions[index]; // Get the original question

    if (result.status === "fulfilled") {
      // Type guard needed here
      const value = result.value;
      if ("error" in value) {
        // Handle skipped or errored promises
        if (value.error !== "skipped") {
          console.error(`Pinecone query failed for ${value.questionId}:`, value.error);
          itemsWithErrors.push(value.questionId); // Track items with errors
        } else {
          // Also track skipped items if necessary, or just ignore
          console.log(`Pinecone query skipped for ${value.questionId}`);
        }
      } else if ("results" in value && value.questionId) {
        // Successfully found related questions
        itemsToUpdate.push({ id: value.questionId, data: value.results });
      } else {
        // Should not happen if structure is correct, but handle defensively
        console.error(
          `Fulfilled promise for index ${index} (associated question: ${question?.id || "UNKNOWN"}) missing questionId or results. Value:`,
          value
        );
        if (question?.id) {
          itemsWithErrors.push(question.id);
        }
      }
    } else {
      // Promise was rejected (unexpected error in the promise setup/settling itself)
      const failedQuestionId = questions[index]?.id || `unknown_at_index_${index}`;
      console.error(`Pinecone query promise rejected for ${failedQuestionId}:`, result.reason);
      itemsWithErrors.push(failedQuestionId);
    }
  });

  // Update error count based on collected errors
  errorCount = itemsWithErrors.length;

  // Add successful updates to Firestore in smaller batches
  const firestoreChunkSize = 400; // Keep below Firestore's 500 limit
  let lastSuccessfulChunkProcessedId: string | null = lastProcessedId; // Initialize with the ID we started this batch from

  for (let i = 0; i < itemsToUpdate.length; i += firestoreChunkSize) {
    const chunk = itemsToUpdate.slice(i, i + firestoreChunkSize);
    if (chunk.length === 0) continue; // Skip empty chunks (shouldn't happen with loop condition)

    const firestoreBatch = db!.batch();
    chunk.forEach(({ id, data }) => {
      const docRef = db!.collection(getAnswersCollectionName()).doc(id);
      firestoreBatch.update(docRef, { relatedQuestionsV2: data });
    });

    const chunkNumber = Math.floor(i / firestoreChunkSize) + 1;
    const totalChunks = Math.ceil(itemsToUpdate.length / firestoreChunkSize);
    const chunkLogPrefix = `Firestore Chunk ${chunkNumber}/${totalChunks} (${chunk.length} updates)`;

    // --- Retry Logic for Batch Commit ---
    let commitSuccessful = false;
    const maxRetries = 3;
    let retryDelay = process.env.NODE_ENV === "test" ? 10 : 1000; // Start with shorter delay in test

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await firestoreBatchCommit(firestoreBatch, "batch commit", `${chunk.length} documents in chunk ${chunkNumber}`);
        commitSuccessful = true;
        updatedCount += chunk.length; // Increment successful count only on success
        lastSuccessfulChunkProcessedId = chunk[chunk.length - 1].id; // Update progress marker *after* successful commit
        break; // Exit retry loop on success
      } catch (error: any) {
        console.error(`${chunkLogPrefix}: Commit attempt ${attempt} failed.`, error);
        // Check for specific retryable errors (like EBUSY or DEADLINE_EXCEEDED)
        const errorMessage = String(error?.message || error);
        if (
          (errorMessage.includes("EBUSY") ||
            errorMessage.includes("DEADLINE_EXCEEDED") ||
            errorMessage.includes("UNAVAILABLE")) &&
          attempt < maxRetries
        ) {
          console.log(`Retrying commit for chunk ${chunkNumber} after ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          retryDelay *= 2; // Exponential backoff
        } else {
          console.error(
            `CRITICAL: Non-retryable error or max retries reached for chunk ${chunkNumber}. ${chunk.length} documents in this chunk were NOT updated.`
          );
          errorCount += chunk.length; // Count all items in the failed chunk as errors
          // Optional: Decide whether to throw error and stop the whole batch process,
          // or just log and continue with the next chunk. Currently, it continues.
          // throw new Error(`Unrecoverable Firestore commit error for chunk ${chunkNumber}: ${error}`);
          break; // Exit retry loop on non-retryable error or max retries
        }
      }
    }
    // If commit ultimately failed after retries, ensure we reflect this
    if (!commitSuccessful) {
      console.warn(`Chunk ${chunkNumber} commit failed permanently after ${maxRetries} attempts.`);
      // errorCount was already incremented within the loop for the failed chunk
    } else {
      // --- Update Progress Marker After Successful Chunk Commit ---
      // Only update if the commit for this chunk was successful
      try {
        await firestoreSet(
          progressDocRef,
          {
            lastProcessedId: lastSuccessfulChunkProcessedId,
          },
          undefined,
          "progress update",
          `lastProcessedId: ${lastSuccessfulChunkProcessedId} (after chunk ${chunkNumber})`
        );
      } catch (progressError) {
        console.error(
          `Failed to update progress document after successful chunk ${chunkNumber}. Last successful ID was ${lastSuccessfulChunkProcessedId}. Continuing...`,
          progressError
        );
        // Log the error but continue processing other chunks. The next run *might* reprocess this chunk.
      }
    }
  } // End of chunk loop

  console.log(
    `Batch finished. Successfully updated related questions for ${updatedCount} items, encountered errors for ${errorCount} items (including commit failures and Pinecone query issues).`
  );
}

// --- Single Question Update ---

/**
 * Updates related questions for a specific question ID on demand.
 * Fetches the question text, ensures its embedding exists in Pinecone (upserting if necessary),
 * finds related questions via Pinecone (using the original findRelatedQuestionsPinecone),
 * logs before/after, and updates the Firestore document asynchronously.
 * @param {string} questionId - The ID of the question to update related questions for.
 * @returns {Promise<{ previous: RelatedQuestion[]; current: RelatedQuestion[] }>} A promise resolving to an object containing the previous and newly calculated lists of related questions.
 * @throws {Error} If client initialization fails, Pinecone index is unavailable, the question is not found, or embedding fails.
 */
export async function updateRelatedQuestions(
  questionId: string
): Promise<{ previous: RelatedQuestion[]; current: RelatedQuestion[] }> {
  // Ensure database and clients are ready.
  checkDbAvailable();
  try {
    await initializeClients();
  } catch (initError) {
    console.error("updateRelatedQuestions: Aborting due to client initialization failure.", initError);
    // Propagate error to the caller (e.g., API handler).
    throw new Error("Failed to initialize required services.");
  }

  // Double-check Pinecone index availability.
  if (!pineconeIndex) {
    throw new Error("updateRelatedQuestions: Pinecone index is not available after initialization.");
  }

  // 1. Fetch the target question text from Firestore.
  let questionText: string;
  let restatedQuestionText: string | null = null;
  let previousRelatedQuestions: RelatedQuestion[] = [];
  try {
    // Use firestoreGet for better error handling with retry logic for code 14 errors
    const questionDoc = await firestoreGet(
      db!.collection(getAnswersCollectionName()).doc(questionId),
      "document get",
      `questionId: ${questionId}`
    );

    // Handle case where the specified question document doesn't exist.
    if (!questionDoc.exists) {
      console.log(`DEBUG: Question document ${questionId} not found in Firestore`);
      throw new Error(`Question not found: ${questionId}`);
    }

    const questionData = questionDoc.data();

    // Ensure the question data and text are present.
    if (!questionData) {
      throw new Error(`Question data or text missing for ID: ${questionId}`);
    }

    if (!questionData.question) {
      console.log(
        `DEBUG: Question document ${questionId} missing 'question' field. Available fields:`,
        Object.keys(questionData).join(", ")
      );
      throw new Error(`Question data or text missing for ID: ${questionId}`);
    }

    questionText = questionData.question;
    // Get the restated question if available, otherwise use the original question
    restatedQuestionText = questionData.restatedQuestion || null;

    // Capture the current related questions before calculating new ones
    previousRelatedQuestions = questionData.relatedQuestionsV2 || [];
  } catch (error) {
    console.error(`Failed to fetch question ${questionId} from Firestore:`, error);
    throw error; // Re-throw original error.
  }

  // Use restated question for embeddings if available, otherwise use original question
  const textForEmbedding = restatedQuestionText || questionText;
  console.log(`Using ${restatedQuestionText ? "restated" : "original"} question for embeddings: "${textForEmbedding}"`);

  // 2. Ensure the embedding for this question exists in Pinecone.
  // This involves generating and upserting the embedding. If it already exists, upsert updates it.
  try {
    // Construct a minimal Answer object required by upsertEmbeddings.
    const now = Timestamp.now();
    const minimalAnswer: Answer = {
      id: questionId,
      question: textForEmbedding, // Use the text for embedding (restated or original)
      answer: "", // Not needed for embedding.
      // Firestore timestamp structure.
      timestamp: { _seconds: now.seconds, _nanoseconds: now.nanoseconds },
      likeCount: 0, // Add default likeCount
    };
    // Call upsertEmbeddings with a single-item array.
    // Timer is inside upsertEmbeddings
    await upsertEmbeddings([minimalAnswer]);
  } catch (error) {
    console.error(`Failed to upsert embedding for ${questionId} before finding related:`, error);
    // Throw a specific error indicating potential inaccuracy if embedding failed.
    throw new Error(
      `Failed to update/verify embedding for ${questionId}. Cannot guarantee accurate related questions.`
    );
  }

  // 3. Find related questions using Pinecone search (now with new logic).
  // Timer is inside findRelatedQuestionsPinecone
  const currentRelatedQuestions = await findRelatedQuestionsPinecone(
    questionId,
    textForEmbedding, // Use the text for embedding (restated or original)
    5 // Explicitly pass the desired final limit (5)
  );

  // 4. Update the Firestore document with proper error handling
  try {
    // Use firestoreUpdate for better error handling with retry logic for code 14 errors
    await firestoreUpdate(
      db!.collection(getAnswersCollectionName()).doc(questionId),
      {
        relatedQuestionsV2: currentRelatedQuestions, // Overwrite with the newly found list.
      },
      "document update",
      `questionId: ${questionId}`
    );
  } catch (error) {
    // Log but continue since we have the calculated results
    console.error(`Error updating Firestore for ${questionId}:`, error);
    console.warn(`Returning calculated results despite Firestore update failure for ${questionId}`);
  }

  // Return the previous and current lists of related questions.
  return {
    previous: previousRelatedQuestions,
    current: currentRelatedQuestions,
  };
}
