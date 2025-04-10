// TODO: store keywords in firestore rather than regenerating every time

import { TfIdf } from 'natural';
import rake from 'node-rake';
import { db } from '@/services/firebase';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import { getEnvName } from '@/utils/env';
import { getAnswersByIds } from '@/utils/server/answersUtils';
import { Answer } from '@/types/answer';
import {
  getFromCache,
  setInCache,
  deleteFromCache,
  CACHE_EXPIRATION,
} from '@/utils/server/redisUtils';
import { RelatedQuestion } from '@/types/RelatedQuestion';

// Check if db is available
function checkDbAvailable(): void {
  if (!db) {
    throw new Error('Database not available');
  }
}

// Maximum size for cache chunks (in bytes)
const MAX_CHUNK_SIZE = 1000000; // Upstash max is 1MB, so we stay well under that.

/**
 * Safely store data in cache, handling large values by splitting into chunks as needed
 */
async function safeSetInCache(
  key: string,
  value: string | number | boolean | object | null,
  expiration?: number,
) {
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_CHUNK_SIZE) {
    console.warn(
      `Cache value for key ${key} exceeds ${MAX_CHUNK_SIZE} bytes. Splitting into chunks.`,
    );
    const chunks = [];
    let chunkIndex = 0;
    while (chunkIndex * MAX_CHUNK_SIZE < serialized.length) {
      chunks.push(
        serialized.slice(
          chunkIndex * MAX_CHUNK_SIZE,
          (chunkIndex + 1) * MAX_CHUNK_SIZE,
        ),
      );
      chunkIndex++;
    }

    // Delete the non-chunked version if it exists
    await deleteFromCache(key);

    await setInCache(`${key}_chunk_count`, chunks.length, expiration);
    for (let i = 0; i < chunks.length; i++) {
      await setInCache(`${key}_chunk_${i}`, chunks[i], expiration);
    }
  } else {
    // Delete any existing chunks if we're now storing a non-chunked version
    const existingChunkCount = await getFromCache<number>(`${key}_chunk_count`);
    if (existingChunkCount) {
      await deleteFromCache(`${key}_chunk_count`);
      for (let i = 0; i < existingChunkCount; i++) {
        await deleteFromCache(`${key}_chunk_${i}`);
      }
    }

    await setInCache(key, value, expiration);
  }
}

/**
 * Safely retrieve data from cache, handling both chunked and non-chunked data
 */
async function safeGetFromCache<T>(key: string): Promise<T | null> {
  // First, try to get the value as if it's not chunked
  const value = await getFromCache<T>(key);
  if (value) return value;

  // If not found, check if it's chunked
  const chunkCount = await getFromCache<number>(`${key}_chunk_count`);
  if (!chunkCount) return null;

  // Reconstruct the value from chunks
  let serialized = '';
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await getFromCache<string>(`${key}_chunk_${i}`);
    if (!chunk) return null;
    serialized += chunk;
  }

  return JSON.parse(serialized) as T;
}

/**
 * Generate keywords from text using RAKE algorithm, with error handling
 */
function safeRakeGenerate(text: string, questionId: string): string[] {
  try {
    // Remove all punctuation and non-alphanumeric characters except spaces
    const cleanedText = text
      .replace(/[^\w\s]|_/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanedText) {
      console.warn(
        `Empty text after cleaning for question ID ${questionId}. Original text: "${text}"`,
      );
      return [];
    }
    const keywords = rake.generate(cleanedText);
    if (!keywords || !Array.isArray(keywords)) {
      console.warn(
        `Invalid keywords generated for question ID ${questionId}. Text: "${text}"`,
      );
      return [];
    }
    return keywords;
  } catch (error) {
    console.error(
      `Error generating keywords for question ID ${questionId}. Text: "${text}"`,
      error,
    );
    return [];
  }
}

/**
 * Get the cache key for keywords based on environment and site ID
 */
function getCacheKeyForKeywords(): string {
  const envName = getEnvName();
  const siteId = process.env.SITE_ID;
  return `${envName}_${siteId}_keywords_cache_v2`;
}

/**
 * Fetch related questions for a given question ID
 */
export async function getRelatedQuestions(
  questionId: string,
): Promise<Answer[]> {
  // Check if db is available
  checkDbAvailable();

  const doc = await db!
    .collection(getAnswersCollectionName())
    .doc(questionId)
    .get();
  if (!doc.exists) {
    throw new Error('QA document not found');
  }

  const docData = doc.data();
  if (!docData) {
    throw new Error('Document data is undefined');
  }

  const relatedQuestionIds = docData.relatedQuestionsV2 || [];
  const relatedQuestions = await getAnswersByIds(relatedQuestionIds);
  return relatedQuestions;
}

/**
 * Fetch a batch of questions from the database
 */
async function getQuestionsBatch(
  envName: string,
  lastProcessedId: string | null,
  batchSize: number,
): Promise<Answer[]> {
  // Check if db is available
  checkDbAvailable();

  console.log(
    `Starting getQuestionsBatch with envName: ${envName}, lastProcessedId: ${lastProcessedId}, batchSize: ${batchSize}`,
  );

  let query = db!
    .collection(getAnswersCollectionName())
    .orderBy('timestamp', 'desc')
    .limit(batchSize);
  if (lastProcessedId) {
    const lastDoc = await db!
      .collection(getAnswersCollectionName())
      .doc(lastProcessedId)
      .get();
    query = query.startAfter(lastDoc);
  }

  const snapshot = await query.get();

  if (snapshot.empty) {
    console.warn('No documents found in the batch query.');
  }

  const questions: Answer[] = snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as Answer,
  );

  return questions;
}

/**
 * Update related questions for a batch of questions
 */
export async function updateRelatedQuestionsBatch(batchSize: number) {
  // Check if db is available
  checkDbAvailable();

  // We may not have a full set of keywords, but by the second full pass-through,
  // we should have a pretty good set of keywords.
  const envName = getEnvName();
  const progressDocRef = db!
    .collection('progress')
    .doc(`${envName}_relatedQuestions`);
  const progressDoc = await progressDocRef.get();
  const lastProcessedId = progressDoc.exists
    ? progressDoc.data()?.lastProcessedId
    : null;

  let questions: Answer[] = await getQuestionsBatch(
    envName,
    lastProcessedId,
    batchSize,
  );
  if (!questions.length) {
    // we were at the end, so start over
    console.log(
      'updateRelatedQuestionsBatch: At the end of the collection, starting over...',
    );
    questions = await getQuestionsBatch(envName, null, batchSize);
  }

  await extractAndStoreKeywords(questions);

  let allKeywords;
  try {
    allKeywords = await fetchKeywords();
  } catch (error) {
    console.error(
      "updateRelatedQuestionsBatch: Can't process; error fetching keywords:",
      error,
    );
    return;
  }

  for (const question of questions) {
    if (!question.question) {
      console.warn(
        `Skipping question ID ${question.id} due to missing 'question' field`,
      );
      continue;
    }

    const text = question.question;
    const rakeKeywords = safeRakeGenerate(text, question.id);

    const relatedQuestions = await findRelatedQuestionsUsingKeywords(
      rakeKeywords,
      allKeywords,
      0.1,
      question.id,
      question.question,
    );
    await db!
      .collection(getAnswersCollectionName())
      .doc(question.id)
      .update({
        relatedQuestionsV2: relatedQuestions.slice(0, 5).map((q) => ({
          id: q.id,
          title: q.title,
          similarity: q.similarity,
        })),
      });
  }

  if (questions.length > 0) {
    const lastQuestion = questions[questions.length - 1];
    await progressDocRef.set({ lastProcessedId: lastQuestion.id });
  }
}

// export async function fetchAllQuestions() {
//   const questions: { id: string, question: string }[] = [];
//   const snapshot = await db.collection(getChatLogsCollectionName())
//     .get();
//   snapshot.forEach(doc => {
//     questions.push({ id: doc.id, question: doc.data().question });
//   });
//   return questions;
// }

function removeNonAscii(text: string): string {
  return text.replace(/[^\x00-\x7F]/g, '');
}

/**
 * Extract keywords from questions and store them in Firestore and cache
 */
export async function extractAndStoreKeywords(questions: Answer[]) {
  // Check if db is available
  checkDbAvailable();

  const tfidf = new TfIdf();
  const batch = db!.batch();
  const envName = getEnvName();

  // Fetch existing cache
  const cacheKey = getCacheKeyForKeywords();
  let cachedKeywords:
    | { id: string; keywords: string[]; title: string }[]
    | null = await safeGetFromCache(cacheKey);
  if (!cachedKeywords) {
    cachedKeywords = [];
  }

  // Create a map for faster lookup
  const cachedKeywordsMap = new Map(
    cachedKeywords.map((item) => [item.id, item]),
  );

  for (const q of questions) {
    try {
      if (!q.question || typeof q.question !== 'string') {
        console.warn(
          `Skipping question ID ${q.id} due to invalid question format`,
        );
        continue;
      }
      const cleanedQuestion = removeNonAscii(q.question);
      if (!cleanedQuestion || cleanedQuestion.trim() === '') {
        console.warn(
          `Skipping question ID ${q.id} after removing non-ASCII characters: ${q.question}`,
        );
        continue;
      }
      const rakeKeywords = safeRakeGenerate(cleanedQuestion, q.id);
      tfidf.addDocument(cleanedQuestion);
      const tfidfKeywords = tfidf
        .listTerms(tfidf.documents.length - 1)
        .map((term) => term.term);
      const keywords = Array.from(new Set(rakeKeywords.concat(tfidfKeywords)));

      // Add keywords to Firestore
      const keywordDocRef = db!.collection(`${envName}_keywords`).doc(q.id);
      batch.set(keywordDocRef, { keywords, title: q.question });

      // Update or add keywords to cache map
      cachedKeywordsMap.set(q.id, { id: q.id, keywords, title: q.question });
    } catch (error) {
      console.error(
        `Error generating keywords for question ID ${q.id} with text "${q.question}":`,
        error,
      );
    }
  }

  await batch.commit();

  // Convert map back to array and update the cache
  const updatedCachedKeywords = Array.from(cachedKeywordsMap.values());
  await safeSetInCache(cacheKey, updatedCachedKeywords);
}

/**
 * Fetch keywords from cache or Firestore
 */
export async function fetchKeywords(): Promise<
  { id: string; keywords: string[]; title: string }[]
> {
  // Check if db is available
  checkDbAvailable();

  const cacheKey = getCacheKeyForKeywords();
  const cachedKeywords =
    await safeGetFromCache<{ id: string; keywords: string[]; title: string }[]>(
      cacheKey,
    );
  if (cachedKeywords) {
    return cachedKeywords;
  }

  const keywords: { id: string; keywords: string[]; title: string }[] = [];
  const envName = getEnvName();
  const snapshot = await db!.collection(`${envName}_keywords`).get();
  snapshot.forEach((doc) => {
    const data = doc.data();
    keywords.push({ id: doc.id, keywords: data.keywords, title: data.title });
  });

  await safeSetInCache(cacheKey, keywords, CACHE_EXPIRATION);

  return keywords;
}

/**
 * Calculate Jaccard similarity between two sets of keywords
 */
function calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>) {
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Update related questions for a specific question ID
 */
export async function updateRelatedQuestions(
  questionId: string,
): Promise<RelatedQuestion[]> {
  // Check if db is available
  checkDbAvailable();

  // Fetch the specific question by questionId
  const questionDoc = await db!
    .collection(getAnswersCollectionName())
    .doc(questionId)
    .get();
  if (!questionDoc.exists) {
    throw new Error('Question not found');
  }
  const newQuestion = { id: questionDoc.id, ...questionDoc.data() } as {
    id: string;
    question: string;
  };

  let allKeywords: { id: string; keywords: string[]; title: string }[];
  try {
    allKeywords = await fetchKeywords();
  } catch (error) {
    console.error(
      "updateRelatedQuestions: Can't process; error fetching keywords:",
      error,
    );
    throw error;
  }

  // Extract keywords from the specific question
  const newQuestionKeywords = rake.generate(newQuestion.question);
  const combinedKeywords = allKeywords.map((k) => ({
    id: k.id,
    keywords: k.id === questionId ? newQuestionKeywords : k.keywords,
    title: k.id === questionId ? newQuestion.question : k.title,
  }));

  // Use the combined keywords to find related questions
  const relatedQuestions = await findRelatedQuestionsUsingKeywords(
    newQuestionKeywords,
    combinedKeywords,
    0.1,
    questionId,
    newQuestion.question,
  );

  const relatedQuestionsV2: RelatedQuestion[] = relatedQuestions
    .slice(0, 5)
    .map((q) => ({
      id: q.id,
      title: q.title,
      similarity: q.similarity ?? 0, // Provide a default value if similarity is undefined
    }));

  // Update the question with the new related questions, without waiting for the update to complete
  db!.collection(getAnswersCollectionName()).doc(questionId).update({
    relatedQuestionsV2,
  });

  return relatedQuestionsV2;
}

/**
 * Find related questions using keyword similarity
 */
export async function findRelatedQuestionsUsingKeywords(
  newQuestionKeywords: string[],
  keywords: { id: string; keywords: string[]; title: string }[],
  threshold: number,
  questionId: string,
  questionTitle: string,
) {
  try {
    const questionKeywordsSet = new Set<string>(newQuestionKeywords);
    const relatedQuestions = keywords
      .filter((k) => k.id !== questionId && k.title !== questionTitle) // Exclude same title
      .map((k) => ({
        id: k.id,
        title: k.title,
        similarity: calculateJaccardSimilarity(
          questionKeywordsSet,
          new Set<string>(k.keywords),
        ),
      }))
      .filter((k) => k.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    // Filter out duplicates, keeping only the highest-ranking one
    const uniqueRelatedQuestions = [];
    const seenTitles = new Set<string>();
    for (const question of relatedQuestions) {
      if (!seenTitles.has(question.title)) {
        uniqueRelatedQuestions.push(question);
        seenTitles.add(question.title);
      }
    }

    return uniqueRelatedQuestions;
  } catch (error) {
    console.error(
      `Error finding related questions for question ID: ${questionId}`,
      error,
    );
    return [];
  }
}
