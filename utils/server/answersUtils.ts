import { db } from '@/services/firebase';
import firebase from 'firebase-admin';
import { getChatLogsCollectionName } from '@/utils/server/firestoreUtils';
import { getEnvName } from '@/utils/env';
import {
  getFromCache,
  setInCache,
  CACHE_EXPIRATION,
} from '@/utils/server/redisUtils';
import { Answer } from '@/types/answer';
import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';

export async function getAnswersByIds(ids: string[]): Promise<Answer[]> {
  const answers: Answer[] = [];
  const chunkSize = 10;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      const snapshot = await db
        .collection(getChatLogsCollectionName())
        .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
        .get();
      snapshot.forEach((doc) => {
        const data = doc.data() as Omit<Answer, 'id'>;
        data.sources = parseAndRemoveWordsFromSources(
          data.sources as string | Document<DocMetadata>[] | undefined,
        );

        const relatedQuestions = data.relatedQuestionsV2 || [];

        // Suppress related_questions if it is returned from Firestore - abandoned data
        if ('related_questions' in data) {
          delete data.related_questions;
        }

        answers.push({
          id: doc.id,
          ...data,
          relatedQuestionsV2: relatedQuestions,
        });
      });
    } catch (error) {
      console.error('Error fetching chunk: ', error);
      throw error; // Rethrow the error to be caught in the handler
    }
  }

  return answers;
}

export function parseAndRemoveWordsFromSources(
  sources: string | Document<DocMetadata>[] | undefined,
): Document<DocMetadata>[] {
  console.log(
    'parseAndRemoveWordsFromSources: Input sources type:',
    typeof sources,
  );
  console.log(
    'parseAndRemoveWordsFromSources: Input sources:',
    JSON.stringify(sources, null, 2),
  );

  if (!sources) {
    console.log('parseAndRemoveWordsFromSources: Sources is undefined or null');
    return [];
  }

  let parsedSources: Document<DocMetadata>[] = [];
  if (typeof sources === 'string') {
    console.log('parseAndRemoveWordsFromSources: Sources is a string');
    // TODO: Remove this after confirming that sources is always an array
    if (process.env.NODE_ENV === 'development') {
      console.assert(
        typeof sources !== 'string',
        'Sources should not be a string in development',
      );
      if (typeof sources === 'string') {
        throw new Error('Sources is a string in development');
      }
    }
    try {
      const tempSources = JSON.parse(sources);
      console.log(
        'parseAndRemoveWordsFromSources: Parsed sources:',
        JSON.stringify(tempSources, null, 2),
      );
      parsedSources = Array.isArray(tempSources) ? tempSources : [];
      console.log(
        'parseAndRemoveWordsFromSources: Is parsed sources an array:',
        Array.isArray(parsedSources),
      );
    } catch (error) {
      console.error(
        'parseAndRemoveWordsFromSources: Error parsing sources:',
        error,
      );
    }
  } else if (Array.isArray(sources)) {
    console.log('parseAndRemoveWordsFromSources: Sources is already an array');
    parsedSources = sources;
  }

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

function getCacheKeyForDocumentCount(): string {
  const envName = getEnvName();
  const siteId = process.env.SITE_ID || 'default';
  return `${envName}_${siteId}_answers_count`;
}

export async function getTotalDocuments(): Promise<number> {
  const cacheKey = getCacheKeyForDocumentCount();

  // Try to get the count from cache
  const cachedCount = await getFromCache<string>(cacheKey);
  if (cachedCount !== null) {
    return parseInt(cachedCount, 10);
  }

  // If not in cache, count the documents
  let count = 0;
  const stream = db.collection(getChatLogsCollectionName()).stream();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    count++;
  }

  // Cache the result
  await setInCache(cacheKey, count.toString(), CACHE_EXPIRATION);

  return count;
}
