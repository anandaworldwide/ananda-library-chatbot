// This file contains utility functions for handling answers and related operations

import { db } from '@/services/firebase';
import firebase from 'firebase-admin';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import { getEnvName } from '@/utils/env';
import {
  getFromCache,
  setInCache,
  CACHE_EXPIRATION,
} from '@/utils/server/redisUtils';
import { Answer } from '@/types/answer';
import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';

// Fetches answers from Firestore based on an array of IDs
// Uses batching to optimize database queries
export async function getAnswersByIds(ids: string[]): Promise<Answer[]> {
  // Check if db is available
  if (!db) {
    throw new Error('Database not available');
  }

  const answers: Answer[] = [];
  const chunkSize = 10; // Process IDs in batches of 10
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      const snapshot = await db
        .collection(getAnswersCollectionName())
        .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
        .get();
      snapshot.forEach((doc) => {
        const data = doc.data() as Omit<Answer, 'id'>;
        // Parse and clean up sources data
        data.sources = parseAndRemoveWordsFromSources(
          data.sources as string | Document<DocMetadata>[] | undefined,
        );

        const relatedQuestions = data.relatedQuestionsV2 || [];

        // Remove deprecated 'related_questions' field if present
        if ('related_questions' in data) {
          delete data.related_questions;
        }

        answers.push({
          id: doc.id,
          ...data,
          relatedQuestionsV2: relatedQuestions,
          // Explicitly include feedback fields from data if they exist
          feedbackReason: data.feedbackReason,
          feedbackComment: data.feedbackComment,
          feedbackTimestamp: data.feedbackTimestamp,
        });
      });
    } catch (error) {
      console.error('Error fetching chunk: ', error);
      throw error; // Rethrow the error to be caught in the handler
    }
  }

  return answers;
}

// Parses and cleans up the sources data, removing unnecessary information
export function parseAndRemoveWordsFromSources(
  sources: string | Document<DocMetadata>[] | undefined,
): Document<DocMetadata>[] {
  if (!sources) {
    return [];
  }

  let parsedSources: Document<DocMetadata>[] = [];
  if (typeof sources === 'string') {
    try {
      const tempSources = JSON.parse(sources);
      parsedSources = Array.isArray(tempSources) ? tempSources : [];
    } catch (error) {
      console.error(
        'parseAndRemoveWordsFromSources: Error parsing sources:',
        error,
      );
    }
  } else if (Array.isArray(sources)) {
    parsedSources = sources;
  }

  // Remove 'full_info' from metadata and return cleaned up sources
  return parsedSources.map(({ pageContent, metadata }) => {
    const cleanedMetadata = { ...metadata };
    if (cleanedMetadata && 'full_info' in cleanedMetadata) {
      delete cleanedMetadata.full_info;
    }
    return {
      pageContent,
      metadata: cleanedMetadata as DocMetadata,
    };
  });
}

// Generates a unique cache key for document count based on environment and site ID
function getCacheKeyForDocumentCount(): string {
  const envName = getEnvName();
  const siteId = process.env.SITE_ID || 'default';
  return `${envName}_${siteId}_answers_count`;
}

// Retrieves the total number of documents in the answers collection
// Uses caching to improve performance for repeated calls
export async function getTotalDocuments(): Promise<number> {
  const cacheKey = getCacheKeyForDocumentCount();

  // **TIMEOUT DEBUGGING START**
  const startTime = Date.now();

  try {
    // **TIMEOUT DEBUGGING END**
    // Try to get the count from cache
    const cachedCount = await getFromCache<string>(cacheKey);
    if (cachedCount !== null) {
      return parseInt(cachedCount, 10);
    }

    // Check if db is available
    if (!db) {
      throw new Error('Database not available');
    }

    // **TIMEOUT DEBUGGING START**
    // Log the site and collection for debugging
    console.log(
      `[PERF-DEBUG] Getting total documents for collection: ${getAnswersCollectionName()}`,
    );
    console.log(`[PERF-DEBUG] Site ID: ${process.env.SITE_ID || 'default'}`);
    // **TIMEOUT DEBUGGING END**

    // Use the optimized count() method directly instead of streaming
    // Logs show this is much faster than the streaming approach
    try {
      // **TIMEOUT DEBUGGING START**
      console.log('[PERF-DEBUG] Using direct count method');
      const countStart = Date.now();
      // **TIMEOUT DEBUGGING END**

      const snapshot = await db
        .collection(getAnswersCollectionName())
        .count()
        .get();
      const count = snapshot.data().count;

      // **TIMEOUT DEBUGGING START**
      console.log(
        `[PERF-DEBUG] Direct count: ${count} documents in ${Date.now() - countStart}ms`,
      );
      // **TIMEOUT DEBUGGING END**

      // Cache the result for future use
      await setInCache(cacheKey, count.toString(), CACHE_EXPIRATION);

      return count;
    } catch (error) {
      // **TIMEOUT DEBUGGING START**
      console.error('[PERF-DEBUG] Direct count method failed:', error);

      // Fall back to the streaming method with timeout protection only if direct count fails
      console.log('[PERF-DEBUG] Falling back to streaming count with timeout');
      let count = 0;

      // Safety timeout - in case stream gets stuck
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Document counting operation timed out after 10s'));
        }, 10000); // 10 second safety timeout
      });

      // Actual document counting operation
      const countPromise = (async () => {
        const stream = db.collection(getAnswersCollectionName()).stream();
        // Count documents using a stream to handle large collections efficiently
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of stream) {
          count++;
        }
        return count;
      })();

      // Race the counting operation against the timeout
      count = await Promise.race([countPromise, timeoutPromise]);

      console.log(
        `[PERF-DEBUG] Counted ${count} documents in ${Date.now() - startTime}ms`,
      );
      // **TIMEOUT DEBUGGING END**

      // Cache the result for future use
      await setInCache(cacheKey, count.toString(), CACHE_EXPIRATION);

      return count;
    }
    // **TIMEOUT DEBUGGING START**
  } catch (error) {
    console.error(
      `[PERF-DEBUG] Error counting documents after ${Date.now() - startTime}ms:`,
      error,
    );

    // If all else fails, return 0 to prevent API timeout
    console.log('[PERF-DEBUG] Returning default count of 0 to prevent timeout');
    return 0;
  }
  // **TIMEOUT DEBUGGING END**
}
