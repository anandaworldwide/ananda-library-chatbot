/**
 * @fileoverview Manages related question functionality using OpenAI embeddings and Pinecone vector search.
 *
 * Core Workflow:
 * 1. Initialization (`initializeClients`): Sets up OpenAI and Pinecone clients, checking for API keys (OPENAI_API_KEY, PINECONE_API_KEY) and SITE_ID env vars.
 * 2. Pinecone Index Management (`getPineconeIndexName`, `getPineconeIndex`): Creates or retrieves an environment-specific Pinecone index (e.g., `dev-related-questions`) with the correct dimension (`embeddingDimension`) for the chosen OpenAI model (`embeddingModel`).
 * 3. Embedding Generation (`getEmbedding`): Takes text, cleans it, and uses the OpenAI client to generate a vector embedding.
 * 4. Vector Upsert (`upsertEmbeddings`): Takes `Answer` objects, generates embeddings for their questions, and upserts them into Pinecone in batches. Includes `siteId` and truncated `title` in metadata.
 * 5. Vector Search (`findRelatedQuestionsPinecone`): Embeds a query question, searches Pinecone for similar vectors (filtering by `siteId`), retrieves matched IDs, fetches their titles from Firestore (`getAnswerTitle`), and returns the top results.
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

import {
  Pinecone,
  Index as PineconeIndex,
  ServerlessSpecCloudEnum,
} from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import firebase from 'firebase-admin'; // Import firebase for FieldPath
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '@/services/firebase';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import { getEnvName } from '@/utils/env';
import { getAnswersByIds, getAnswerTitle } from '@/utils/server/answersUtils';
import { Answer } from '@/types/answer';
import { RelatedQuestion } from '@/types/RelatedQuestion';

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
  console.log('Initializing OpenAI and Pinecone clients...');

  try {
    // Retrieve necessary credentials and configuration from environment variables.
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const pineconeApiKey = process.env.PINECONE_API_KEY;
    const siteId = process.env.SITE_ID; // Although not directly used for clients, it's crucial for operations.

    // Validate the presence of required environment variables.
    if (!openaiApiKey || !pineconeApiKey || !siteId) {
      console.error(
        'Missing required environment variables for Pinecone/OpenAI. Check OPENAI_API_KEY, PINECONE_API_KEY, SITE_ID.',
      );
      throw new Error(
        'Missing required environment variables for Pinecone/OpenAI integration.',
      );
    }

    // Initialize OpenAI client if it doesn't exist.
    if (!openai) {
      openai = new OpenAI({ apiKey: openaiApiKey });
      console.log('OpenAI client initialized.');
    }

    // Initialize Pinecone client if it doesn't exist.
    if (!pinecone) {
      pinecone = new Pinecone({
        apiKey: pineconeApiKey,
      });
      console.log('Pinecone client initialized.');
      // Immediately attempt to get or create the Pinecone index after client setup.
      await getPineconeIndex();
    } else if (!pineconeIndex) {
      // If Pinecone client exists but index is not set (e.g., after a previous error), try again.
      console.log('Pinecone client existed, ensuring index is ready...');
      await getPineconeIndex();
    }

    console.log('OpenAI and Pinecone clients ready.');
  } catch (error) {
    console.error('Error during client initialization:', error);
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
const embeddingModel = 'text-embedding-3-large';
const embeddingDimension = 3072; // Must match the output dimension of the embeddingModel.

/**
 * Retrieves the Pinecone index instance, creating it if necessary.
 * Assumes the Pinecone client (`pinecone`) has been initialized.
 * Handles index creation, waits for it to become ready, and manages potential errors.
 * @returns {Promise<PineconeIndex>} A promise resolving to the Pinecone index instance.
 * @throws {Error} If the Pinecone client is not initialized or if index access/creation fails.
 */
async function getPineconeIndex(): Promise<PineconeIndex> {
  // Ensure the Pinecone client is available before proceeding.
  if (!pinecone)
    throw new Error('Pinecone client accessed before initialization.');

  const indexName = getPineconeIndexName();
  // Return the existing index instance if it's already set and matches the expected name.
  if (pineconeIndex && currentPineconeIndexName === indexName) {
    return pineconeIndex;
  }

  // Store the name of the index we intend to use.
  currentPineconeIndexName = indexName;
  console.log(`Attempting to access Pinecone index: ${indexName}`);

  try {
    // Check if the index already exists in the Pinecone project.
    const existingIndexes = await pinecone.listIndexes();
    const indexExists = existingIndexes.indexes?.some(
      (index) => index.name === indexName,
    );

    // If the index does not exist, create it.
    if (!indexExists) {
      console.log(
        `Creating Pinecone index: ${indexName} with dimension ${embeddingDimension}...`,
      );
      // Retrieve Pinecone cloud and region settings from environment variables, defaulting if not set.
      const pineconeCloud = (process.env.PINECONE_CLOUD ||
        'aws') as ServerlessSpecCloudEnum;
      const pineconeRegion = process.env.PINECONE_REGION || 'us-west-2';
      console.log(
        `Using Pinecone Serverless spec: Cloud=${pineconeCloud}, Region=${pineconeRegion}`,
      );

      // Create the index with the specified name, dimension, metric, and serverless configuration.
      await pinecone.createIndex({
        name: indexName,
        dimension: embeddingDimension, // Dimension must match the embedding model.
        metric: 'cosine', // Cosine similarity is suitable for text embeddings.
        spec: {
          serverless: {
            // Defines the cloud provider and region for the serverless index.
            cloud: pineconeCloud,
            region: pineconeRegion,
          },
        },
      });

      // Wait for the newly created index to become ready.
      console.log(`Waiting for index ${indexName} to initialize...`);
      let indexDescription = await pinecone.describeIndex(indexName);
      const maxWaitTime = 5 * 60 * 1000; // Set a maximum wait time (5 minutes).
      const startTime = Date.now();
      // Poll the index status until it's 'Ready' or the timeout is reached.
      while (
        indexDescription?.status?.state !== 'Ready' &&
        Date.now() - startTime < maxWaitTime
      ) {
        console.log(
          `Index status: ${indexDescription?.status?.state || 'Unknown'}. Waiting...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds.
        indexDescription = await pinecone.describeIndex(indexName);
      }

      // Check if the index became ready within the timeout period.
      if (indexDescription?.status?.state === 'Ready') {
        console.log(`Index ${indexName} created and ready.`);
      } else {
        throw new Error(
          `Index ${indexName} did not become ready within the timeout period.`,
        );
      }
    } else {
      // If the index already exists, log that it will be used.
      console.log(`Using existing Pinecone index: ${indexName}`);
    }

    // Get a reference to the index (either newly created or existing).
    pineconeIndex = pinecone.index(indexName);
    return pineconeIndex;
  } catch (error) {
    // Log and handle errors during index access or creation.
    console.error(
      `Error accessing or creating Pinecone index ${indexName}:`,
      error,
    );
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
    throw new Error('Database not available');
  }
}

// --- Embedding Generation ---

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
  if (!openai) throw new Error('OpenAI client accessed before initialization.');

  // Handle empty or whitespace-only input gracefully.
  if (!text || text.trim().length === 0) {
    console.warn('Attempted to get embedding for empty text.');
    return []; // Return an empty array as embedding cannot be generated.
  }
  try {
    // Clean the text by replacing newlines, which can negatively affect embedding quality.
    const cleanedText = text.replace(/\n/g, ' ');
    // Request the embedding from OpenAI API.
    const response = await openai.embeddings.create({
      model: embeddingModel, // Use the globally defined model.
      input: cleanedText,
    });
    // Return the generated embedding vector.
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error getting embedding from OpenAI:', error);
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
 * @throws {Error} If Pinecone index is not available, SITE_ID is missing, or upsert fails.
 */
async function upsertEmbeddings(questions: Answer[]): Promise<void> {
  // Ensure Pinecone client and index are ready.
  await initializeClients();
  if (!pineconeIndex || !currentPineconeIndexName)
    throw new Error('Pinecone index not available for upsert.');

  // Retrieve the current SITE_ID for embedding metadata. This is crucial for multi-tenant filtering.
  const currentSiteId = process.env.SITE_ID;
  if (!currentSiteId) {
    throw new Error(
      'upsertEmbeddings: SITE_ID environment variable is not set.',
    );
  }

  // Prepare vectors for upserting.
  const vectors = [];
  for (const q of questions) {
    // Basic validation for question data.
    if (!q.id || !q.question || typeof q.question !== 'string') {
      console.warn(`Skipping upsert for invalid question data: ID=${q.id}`);
      continue; // Skip invalid entries.
    }
    try {
      // Generate embedding for the question text.
      // Note: This performs sequential embedding generation. Consider batching OpenAI API calls for better performance on large datasets.
      const embedding = await getEmbedding(q.question);
      // Only proceed if embedding generation was successful.
      if (embedding.length > 0) {
        // Construct the vector object for Pinecone.
        vectors.push({
          id: q.id, // Use Firestore document ID as the vector ID.
          values: embedding, // The generated embedding vector.
          metadata: {
            // Include relevant metadata for filtering and display.
            title: q.question.substring(0, 140), // Truncated title for potential display.
            siteId: currentSiteId, // Site ID for filtering search results.
          },
        });
      }
    } catch (error) {
      // Log errors during embedding generation but continue with other questions.
      console.error(
        `Failed to generate embedding for question ID ${q.id}:`,
        error,
      );
    }
  }

  // If no valid vectors were generated, exit early.
  if (vectors.length === 0) {
    console.log('No valid embeddings generated for upsert in this batch.');
    return;
  }

  console.log(
    `Attempting to upsert ${vectors.length} vectors into Pinecone index: ${currentPineconeIndexName}`,
  );

  try {
    // Upsert vectors to Pinecone in batches to avoid exceeding request size limits.
    const batchSize = 100; // Pinecone recommends batch sizes of 100 or fewer.
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      // Perform the upsert operation for the current batch.
      await pineconeIndex.upsert(batch);
      console.log(
        `Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)} (size: ${batch.length}) into Pinecone.`,
      );
    }
  } catch (error) {
    // Log and rethrow errors encountered during the Pinecone upsert operation.
    console.error('Error upserting embeddings to Pinecone:', error);
    throw error;
  }
}

// --- Related Questions Retrieval (Firestore) ---

/**
 * Fetches pre-computed related questions for a given question ID directly from Firestore.
 * This reads the `relatedQuestionsV2` field which should contain { id, title, similarity }.
 * @param {string} questionId - The ID of the question for which to fetch related questions.
 * @returns {Promise<Answer[]>} A promise resolving to an array of full Answer objects for related questions.
 */
export async function getRelatedQuestions(
  questionId: string,
): Promise<Answer[]> {
  // Ensure Firestore DB is available.
  checkDbAvailable();

  const docRef = db!.collection(getAnswersCollectionName()).doc(questionId);
  const doc = await docRef.get();

  // Handle cases where the source document doesn't exist.
  if (!doc.exists) {
    console.error(
      // Changed from warn based on user edit
      `QA document not found for getRelatedQuestions: ${questionId}`,
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
  const relatedQuestionsInfo: RelatedQuestion[] =
    docData.relatedQuestionsV2 || []; // Assumes { id, title, similarity } structure.
  const relatedQuestionIds = relatedQuestionsInfo
    .map((q) => q.id)
    .filter((id) => id !== questionId); // Exclude the source question ID.

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
    console.error(
      `Error fetching full answers for related IDs [${relatedQuestionIds.join(', ')}]:`,
      error,
    );
    return []; // Return empty array on error.
  }
}

// --- Batch Processing ---

/**
 * Fetches a batch of question documents from Firestore for processing.
 * Uses Firestore pagination based on the document ID (`startAfter`).
 * @param {string | null} lastProcessedId - The ID of the last document processed in the previous batch, or null to start from the beginning.
 * @param {number} batchSize - The maximum number of documents to fetch.
 * @returns {Promise<Answer[]>} A promise resolving to an array of fetched Answer objects.
 * @throws {Error} If Firestore query fails.
 */
async function getQuestionsBatch(
  lastProcessedId: string | null,
  batchSize: number,
): Promise<Answer[]> {
  // Ensure Firestore DB is available.
  checkDbAvailable();
  const answersCollection = getAnswersCollectionName();

  console.log(
    `Fetching question batch. Collection: ${answersCollection}, Start After ID: ${lastProcessedId}, Size: ${batchSize}`,
  );

  // Construct the Firestore query.
  let query = db!
    .collection(answersCollection)
    // Order by document ID for consistent pagination.
    .orderBy(firebase.firestore.FieldPath.documentId())
    .limit(batchSize); // Limit the number of documents fetched.

  // If `lastProcessedId` is provided, start the query after that document.
  if (lastProcessedId) {
    query = query.startAfter(lastProcessedId);
  }

  try {
    const snapshot = await query.get();

    // If the query returns no documents, log and return empty array.
    if (snapshot.empty) {
      console.log('No more documents found in the batch query.');
      return [];
    }

    // Map Firestore documents to Answer objects.
    const questions: Answer[] = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Answer,
    );
    console.log(`Fetched ${questions.length} questions.`);
    return questions;
  } catch (error) {
    // Log and propagate errors during Firestore query execution.
    console.error('Error executing batch query in getQuestionsBatch:', error);
    throw error;
  }
}

/**
 * Finds related questions for a single question using Pinecone vector search.
 * Generates an embedding for the input question text, queries Pinecone filtering by the current `siteId`,
 * fetches titles for the resulting matches from Firestore, and returns the top related questions.
 * @param {string} questionId - The ID of the source question (used to filter itself from results).
 * @param {string} questionText - The text of the source question to find related questions for.
 * @param {number} [topK=6] - The number of results to fetch from Pinecone (slightly more than needed to account for self-filtering).
 * @returns {Promise<RelatedQuestion[]>} A promise resolving to an array of related questions ({ id, title, similarity }).
 * @throws {Error} If Pinecone index is not available or SITE_ID is missing.
 */
async function findRelatedQuestionsPinecone(
  questionId: string,
  questionText: string,
  topK: number = 6, // Fetch topK (e.g., 6) to ensure topK-1 (e.g., 5) results after self-filtering.
): Promise<RelatedQuestion[]> {
  // Ensure required clients and configuration are ready.
  await initializeClients();
  if (!pineconeIndex)
    throw new Error('Pinecone index not available for query.');

  const currentSiteId = process.env.SITE_ID;
  if (!currentSiteId) {
    throw new Error(
      'findRelatedQuestionsPinecone: SITE_ID environment variable is not set.',
    );
  }

  let queryEmbedding: number[];
  try {
    // Generate the embedding for the input question text.
    queryEmbedding = await getEmbedding(questionText);
    // Handle cases where embedding generation fails.
    if (queryEmbedding.length === 0) {
      console.warn(
        `Could not generate embedding for question ID ${questionId}. Skipping search.`,
      );
      return [];
    }
  } catch (error) {
    console.error(
      `Embedding generation failed for query ${questionId}:`,
      error,
    );
    return []; // Cannot perform search without the query embedding.
  }

  console.log(
    `Querying Pinecone for questions related to ID: ${questionId}, filtering for siteId: ${currentSiteId}`,
  );
  try {
    // Construct the Pinecone query object.
    const pineconeQuery = {
      vector: queryEmbedding, // The embedding of the source question.
      topK: topK, // Number of nearest neighbors to retrieve.
      includeMetadata: false, // Metadata (like title) is fetched from Firestore later for freshness.
      includeValues: false, // Vector values are not needed in the response.
      // Filter results to only include vectors matching the current siteId.
      filter: { siteId: { $eq: currentSiteId } },
    };

    // Execute the query against the Pinecone index.
    const queryResponse = await pineconeIndex.query(pineconeQuery);

    const matches = queryResponse.matches || [];
    console.log(
      `Pinecone returned ${matches.length} potential matches for ${questionId}.`,
    );

    // Process the matches: filter out the source question and prepare for title fetching.
    const related: RelatedQuestion[] = [];
    const idsToFetch: string[] = []; // Store IDs of potential related questions.
    const scores: { [id: string]: number } = {}; // Store similarity scores keyed by ID.

    for (const match of matches) {
      // Exclude the source question itself from the results.
      if (match.id !== questionId && match.score !== undefined) {
        idsToFetch.push(match.id);
        scores[match.id] = match.score; // Pinecone score represents similarity (cosine).
      }
    }

    // If no relevant matches remain after filtering, return empty array.
    if (idsToFetch.length === 0) {
      console.log(
        `No relevant matches found for ${questionId} after filtering self.`,
      );
      return [];
    }

    // Fetch titles for the identified related question IDs from Firestore.
    console.log(
      `Fetching titles from Firestore for ${idsToFetch.length} related IDs...`,
    );
    const titlesMap = new Map<string, string>();
    // Fetch titles individually.
    // @TODO: Optimize by implementing batch title fetching in getAnswerTitle or a new utility function.
    for (const id of idsToFetch) {
      try {
        const title = await getAnswerTitle(id); // Assumes getAnswerTitle fetches one title.
        if (title) {
          titlesMap.set(id, title);
        } else {
          // Log if a title couldn't be found for a matched ID.
          console.warn(`Could not find title for related question ID: ${id}`);
        }
      } catch (error) {
        // Log errors during title fetching but continue with others.
        console.error(`Error fetching title for related ID ${id}:`, error);
      }
    }

    // Construct the final list of related questions using the fetched titles and stored scores.
    for (const id of idsToFetch) {
      const title = titlesMap.get(id);
      // Only include questions for which a title was successfully fetched.
      if (title) {
        related.push({
          id: id,
          title: title,
          similarity: scores[id],
        });
      }
    }

    // Sort the final list by similarity score in descending order.
    related.sort((a, b) => b.similarity - a.similarity);
    console.log(
      `Found ${related.length} related questions for ${questionId} after fetching titles.`,
    );
    // Return the top N related questions (e.g., 5 if topK was 6).
    return related.slice(0, topK - 1);
  } catch (error) {
    // Log and handle errors during the Pinecone query process.
    console.error(
      `Error querying Pinecone for question ID ${questionId}:`,
      error,
    );
    return []; // Return empty array on query failure.
  }
}

/**
 * Orchestrates the batch update process for related questions.
 * Fetches questions in batches, upserts their embeddings to Pinecone,
 * finds related questions for each using Pinecone, updates the results in Firestore,
 * and manages progress tracking using a dedicated Firestore document.
 * @param {number} batchSize - The number of questions to process in each batch.
 * @throws {Error} If client initialization fails, Pinecone index is unavailable, or critical errors occur during processing.
 */
export async function updateRelatedQuestionsBatch(
  batchSize: number,
): Promise<void> {
  // Ensure database and clients are ready before starting.
  checkDbAvailable();
  try {
    await initializeClients();
  } catch (initError) {
    console.error(
      'updateRelatedQuestionsBatch: Aborting due to client initialization failure.',
      initError,
    );
    return; // Cannot proceed without clients.
  }

  // Double-check Pinecone index availability after initialization attempt.
  if (!pineconeIndex) {
    console.error(
      'updateRelatedQuestionsBatch: Aborting because Pinecone index is not available after initialization.',
    );
    return;
  }

  const envName = getEnvName();
  // SITE_ID is crucial for site-specific progress tracking as cron jobs run per deployment.
  const siteIdForProgress = process.env.SITE_ID;
  if (!siteIdForProgress) {
    console.error(
      'updateRelatedQuestionsBatch: Aborting because SITE_ID is not set for progress tracking.',
    );
    return;
  }
  // Construct a unique progress document ID incorporating environment and site ID.
  const progressDocId = `${envName}_${siteIdForProgress}_relatedQuestions_v2`;
  const progressDocRef = db!.collection('progress').doc(progressDocId);

  // --- Progress Tracking ---
  let lastProcessedId: string | null = null;
  try {
    // Attempt to read the last processed ID from the progress document.
    const progressDoc = await progressDocRef.get();
    lastProcessedId = progressDoc.exists
      ? progressDoc.data()?.lastProcessedId
      : null;
    console.log(
      `Starting batch update. Progress Doc ID: ${progressDocId}. Last processed question ID: ${lastProcessedId}`,
    );
  } catch (error) {
    console.error('Error reading progress document:', error);
    // Decide whether to proceed without progress or halt. Proceeding might reprocess data.
    // @TODO: Consider making this a fatal error (fail on this case).
    console.warn('Proceeding without progress tracking information.');
  }

  // --- Fetch Initial Batch ---
  let questions: Answer[];
  try {
    questions = await getQuestionsBatch(lastProcessedId, batchSize);
  } catch (error) {
    console.error('Failed to fetch initial batch of questions:', error);
    return; // Cannot proceed without the first batch.
  }

  // --- Handle End of Collection ---
  // If the batch is empty and we had a lastProcessedId, it means we reached the end.
  if (!questions.length && lastProcessedId) {
    console.log(
      'updateRelatedQuestionsBatch: Reached end of collection, resetting progress and starting over.',
    );
    lastProcessedId = null; // Reset progress marker to null.
    try {
      // Persist the reset progress marker to Firestore.
      await progressDocRef.set({ lastProcessedId: null });
      // Fetch the first batch again from the beginning.
      questions = await getQuestionsBatch(null, batchSize);
    } catch (error) {
      console.error('Failed to fetch batch after resetting progress:', error);
      return; // Abort if fetching fails after reset.
    }
  } else if (!questions.length && !lastProcessedId) {
    // If the collection is entirely empty from the start.
    console.log(
      'updateRelatedQuestionsBatch: No questions found in the collection to process.',
    );
    return; // Nothing to do.
  }

  // --- Process Batch ---
  // 1. Upsert Embeddings for the current batch.
  console.log(`Upserting embeddings for ${questions.length} questions...`);
  try {
    await upsertEmbeddings(questions);
  } catch (error) {
    console.error(
      'CRITICAL: Failed to upsert embeddings for batch. Aborting related question updates for this batch to prevent inconsistency.',
      error,
    );
    // Re-throw the error to be caught by the API handler
    throw error;
    // It's risky to proceed finding related questions if embeddings might be missing/stale.
  }

  // 2. Find related questions via Pinecone and update Firestore for each item in the batch.
  console.log(`Finding related questions for ${questions.length} questions...`);
  let updatedCount = 0;
  let errorCount = 0;
  for (const question of questions) {
    // Skip items with missing essential data.
    if (!question.id || !question.question) {
      console.warn(
        `Skipping related questions update for item with missing ID or question text.`,
      );
      continue;
    }

    try {
      // Find related questions using Pinecone search.
      const relatedQuestions = await findRelatedQuestionsPinecone(
        question.id,
        question.question,
        6, // Request 6 to get top 5 after self-filtering.
      );

      // Update the corresponding Firestore document with the new list of related questions.
      // This overwrites the existing `relatedQuestionsV2` field.
      await db!.collection(getAnswersCollectionName()).doc(question.id).update({
        relatedQuestionsV2: relatedQuestions,
      });
      updatedCount++;
    } catch (error) {
      // Log errors during individual question processing but continue with the batch.
      console.error(
        `Failed to find/update related questions for ${question.id}:`,
        error,
      );
      errorCount++;
    }
  }
  console.log(
    `Batch finished. Updated related questions for ${updatedCount} items, encountered errors for ${errorCount} items.`,
  );

  // 3. Update Progress Marker.
  // Only update if the batch actually contained questions.
  if (questions.length > 0) {
    const lastQuestionInBatch = questions[questions.length - 1];
    // Ensure the last question has an ID.
    if (lastQuestionInBatch?.id) {
      console.log(
        `Updating progress marker to last processed ID: ${lastQuestionInBatch.id}`,
      );
      try {
        // Persist the ID of the last successfully processed question in this batch.
        await progressDocRef.set({ lastProcessedId: lastQuestionInBatch.id });
      } catch (error) {
        // Log errors during progress update, but don't necessarily halt the entire process.
        console.error('Failed to update progress document:', error);
      }
    } else {
      console.warn(
        'Last question in batch had no ID, progress marker not updated.',
      );
    }
  } else {
    console.log(
      'No questions processed in this batch, progress marker not updated.',
    );
  }
}

// --- Single Question Update ---

/**
 * Updates related questions for a specific question ID on demand.
 * Fetches the question text, ensures its embedding exists in Pinecone (upserting if necessary),
 * finds related questions via Pinecone, and updates the Firestore document asynchronously.
 * @param {string} questionId - The ID of the question to update related questions for.
 * @returns {Promise<RelatedQuestion[]>} A promise resolving to the newly calculated list of related questions.
 * @throws {Error} If client initialization fails, Pinecone index is unavailable, the question is not found, or embedding fails.
 */
export async function updateRelatedQuestions(
  questionId: string,
): Promise<RelatedQuestion[]> {
  // Ensure database and clients are ready.
  checkDbAvailable();
  try {
    await initializeClients();
  } catch (initError) {
    console.error(
      'updateRelatedQuestions: Aborting due to client initialization failure.',
      initError,
    );
    // Propagate error to the caller (e.g., API handler).
    throw new Error('Failed to initialize required services.');
  }

  // Double-check Pinecone index availability.
  if (!pineconeIndex) {
    throw new Error(
      'updateRelatedQuestions: Pinecone index is not available after initialization.',
    );
  }

  // 1. Fetch the target question text from Firestore.
  console.log(`Updating related questions for single ID: ${questionId}`);
  let questionText: string;
  try {
    const questionDoc = await db!
      .collection(getAnswersCollectionName())
      .doc(questionId)
      .get();
    // Handle case where the specified question document doesn't exist.
    if (!questionDoc.exists) {
      throw new Error(`Question not found: ${questionId}`);
    }
    const questionData = questionDoc.data();
    // Ensure the question data and text are present.
    if (!questionData || !questionData.question) {
      throw new Error(`Question data or text missing for ID: ${questionId}`);
    }
    questionText = questionData.question;
  } catch (error) {
    console.error(
      `Failed to fetch question ${questionId} from Firestore:`,
      error,
    );
    throw error; // Re-throw original error.
  }

  // 2. Ensure the embedding for this question exists in Pinecone.
  // This involves generating and upserting the embedding. If it already exists, upsert updates it.
  console.log(`Ensuring embedding exists in Pinecone for ${questionId}...`);
  try {
    // Construct a minimal Answer object required by upsertEmbeddings.
    const now = Timestamp.now();
    const minimalAnswer: Answer = {
      id: questionId,
      question: questionText,
      answer: '', // Not needed for embedding.
      // Firestore timestamp structure.
      timestamp: { _seconds: now.seconds, _nanoseconds: now.nanoseconds },
      likeCount: 0, // Add default likeCount
    };
    // Call upsertEmbeddings with a single-item array.
    await upsertEmbeddings([minimalAnswer]);
    console.log(`Ensured embedding exists for ${questionId}.`);
  } catch (error) {
    console.error(
      `Failed to upsert embedding for ${questionId} before finding related:`,
      error,
    );
    // Throw a specific error indicating potential inaccuracy if embedding failed.
    throw new Error(
      `Failed to update/verify embedding for ${questionId}. Cannot guarantee accurate related questions.`,
    );
  }

  // 3. Find related questions using Pinecone search.
  console.log(`Finding related questions via Pinecone for ${questionId}...`);
  const relatedQuestions = await findRelatedQuestionsPinecone(
    questionId,
    questionText,
    6, // Request 6 to get top 5 after filtering self.
  );

  // 4. Update the Firestore document asynchronously (fire and forget).
  // This allows the function to return the calculated list quickly without waiting for the DB write.
  console.log(
    `Updating Firestore asynchronously for ${questionId} with ${relatedQuestions.length} related questions.`,
  );
  db!
    .collection(getAnswersCollectionName())
    .doc(questionId)
    .update({
      relatedQuestionsV2: relatedQuestions, // Overwrite with the newly found list.
    })
    .then(() => {
      // Log success of the async update.
      console.log(`Firestore update successful for ${questionId}`);
    })
    .catch((error) => {
      // Log any errors during the async Firestore update.
      console.error(
        `Error during asynchronous Firestore update for ${questionId}:`,
        error,
      );
      // Note: This error occurs after the function has already returned. Consider more robust error handling if needed.
    });

  // Return the calculated list of related questions immediately.
  return relatedQuestions;
}
