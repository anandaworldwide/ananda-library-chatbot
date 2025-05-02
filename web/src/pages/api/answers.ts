// This file handles API requests for fetching and deleting answers.
// It provides functionality to retrieve answers with pagination, sorting, and filtering options,
// as well as deleting individual answers with proper authentication.

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '@/services/firebase';
import { getSudoCookie } from '@/utils/server/sudoCookieUtils';
import { getAnswersCollectionName } from '@/utils/server/firestoreUtils';
import {
  getTotalDocuments,
  getAnswersByIds,
} from '@/utils/server/answersUtils';
import { Answer } from '@/types/answer';
import { Document } from 'langchain/document';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

// **TIMEOUT DEBUGGING START** - Performance tracking utility
const perfDebug = {
  enabled: true,
  startTime: 0,
  markers: {} as Record<string, number>,
  start: function () {
    this.startTime = Date.now();
    this.markers = {};
  },
  mark: function (label: string) {
    if (!this.enabled) return;
    this.markers[label] = Date.now() - this.startTime;
    console.log(`[PERF-DEBUG] ${label}: ${this.markers[label]}ms`);
  },
  summary: function () {
    if (!this.enabled) return {};
    return {
      totalTime: Date.now() - this.startTime,
      markers: this.markers,
    };
  },
};
// **TIMEOUT DEBUGGING END**

// 6/23/24: likedOnly filtering not being used in UI but leaving here for potential future use

// Retrieves answers based on specified criteria (page, limit, liked status, and sort order)
// Returns an array of answers and the total number of pages
async function getAnswers(
  page: number,
  limit: number,
  likedOnly: boolean,
  sortBy: string,
): Promise<{ answers: Answer[]; totalPages: number }> {
  // **TIMEOUT DEBUGGING START**
  perfDebug.start();
  perfDebug.mark('getAnswers:start');

  // Check if db is available
  if (!db) {
    throw new Error('Database not available');
  }

  // Log query parameters for debugging
  console.log(
    `[PERF-DEBUG] Query params: page=${page}, limit=${limit}, likedOnly=${likedOnly}, sortBy=${sortBy}`,
  );

  // Initialize the query with sorting options
  perfDebug.mark('buildQuery:start');
  // **TIMEOUT DEBUGGING END**

  let answersQuery = db
    .collection(getAnswersCollectionName())
    .orderBy(sortBy === 'mostPopular' ? 'likeCount' : 'timestamp', 'desc');

  // Add secondary sorting by timestamp for 'mostPopular' option
  if (sortBy === 'mostPopular') {
    answersQuery = answersQuery.orderBy('timestamp', 'desc');
  }

  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('buildQuery:end');

  // Calculate pagination details
  perfDebug.mark('getTotalDocuments:start');
  // **TIMEOUT DEBUGGING END**

  const totalDocs = await getTotalDocuments();

  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('getTotalDocuments:end');

  console.log(`[PERF-DEBUG] Total documents: ${totalDocs}`);
  // **TIMEOUT DEBUGGING END**

  const totalPages = Math.max(1, Math.ceil(totalDocs / limit)); // Ensure at least 1 page
  const offset = (page - 1) * limit;

  // Apply pagination to the query
  answersQuery = answersQuery.offset(offset).limit(limit);

  // Filter for liked answers if specified
  if (likedOnly) {
    answersQuery = answersQuery.where('likeCount', '>', 0);
  }

  // Execute the query and process the results
  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('executeQuery:start');
  // **TIMEOUT DEBUGGING END**

  const answersSnapshot = await answersQuery.get();

  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('executeQuery:end');

  console.log(
    `[PERF-DEBUG] Query returned ${answersSnapshot.docs.length} documents`,
  );

  perfDebug.mark('processResults:start');
  // **TIMEOUT DEBUGGING END**

  const answers = answersSnapshot.docs.map((doc) => {
    const data = doc.data();
    let sources: Document[] = [];

    // Parse sources, handling potential errors
    try {
      sources = data.sources ? (JSON.parse(data.sources) as Document[]) : [];
    } catch (e) {
      // Very early sources were stored in non-JSON so recognize those and only log an error for other cases
      if (!data.sources.trim().substring(0, 50).includes('Sources:')) {
        console.error('Error parsing sources:', e);
        console.log("data.sources: '" + data.sources + "'");
        if (!data.sources || data.sources.length === 0) {
          console.log('data.sources is empty or null');
        }
      }
    }

    // Construct and return the Answer object
    return {
      id: doc.id,
      question: data.question,
      answer: data.answer,
      timestamp: data.timestamp,
      sources: sources as Document<Record<string, unknown>>[],
      vote: data.vote,
      collection: data.collection,
      ip: data.ip,
      likeCount: data.likeCount || 0,
      relatedQuestionsV2: data.relatedQuestionsV2 || [],
      related_questions: data.related_questions,
      adminAction: data.adminAction,
      adminActionTimestamp: data.adminActionTimestamp,
      history: data.history || undefined,
      feedbackReason: data.feedbackReason,
      feedbackComment: data.feedbackComment,
      feedbackTimestamp: data.feedbackTimestamp,
    } as Answer;
  });

  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('processResults:end');

  perfDebug.mark('getAnswers:end');
  console.log(
    `[PERF-DEBUG] getAnswers total time: ${perfDebug.summary().totalTime}ms`,
  );
  // **TIMEOUT DEBUGGING END**

  return { answers, totalPages };
}

// Deletes an answer by its ID
async function deleteAnswerById(id: string): Promise<void> {
  // Check if db is available
  if (!db) {
    throw new Error('Database not available');
  }

  try {
    await db.collection(getAnswersCollectionName()).doc(id).delete();
  } catch (error) {
    console.error('Error deleting answer: ', error);
    throw error;
  }
}

// Create a custom handler that applies different auth requirements based on the method
async function apiHandler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

  // For GET requests, no authentication is required
  if (method === 'GET') {
    return await handleGetRequest(req, res);
  }

  // For DELETE requests, authentication is required - will be handled by withJwtAuth
  if (method === 'DELETE') {
    return await handleDeleteRequest(req, res);
  }

  // For unsupported methods
  res.setHeader('Allow', ['GET', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}

// For GET requests, don't require authentication
const getHandler = withApiMiddleware(apiHandler, { skipAuth: true });

// For DELETE requests, require authentication
const deleteHandler = withApiMiddleware(withJwtAuth(apiHandler));

// Export the main handler that routes based on method
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

  if (method === 'GET') {
    return getHandler(req, res);
  }

  if (method === 'DELETE') {
    return deleteHandler(req, res);
  }

  // For other methods, use the unauthenticated handler to return 405
  return getHandler(req, res);
}

// Main handler function for the API endpoint
async function handleGetRequest(req: NextApiRequest, res: NextApiResponse) {
  // **TIMEOUT DEBUGGING START**
  perfDebug.start();
  perfDebug.mark('handleGetRequest:start');

  // Log request info for debugging purposes
  console.log(`[PERF-DEBUG] Request URL: ${req.url}`);
  console.log(`[PERF-DEBUG] Request query: ${JSON.stringify(req.query)}`);
  console.log(`[PERF-DEBUG] Environment: ${process.env.NODE_ENV}`);
  console.log(`[PERF-DEBUG] Site ID: ${process.env.SITE_ID || 'not set'}`);
  // **TIMEOUT DEBUGGING END**

  // Apply rate limiting
  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('rateLimiter:start');
  // **TIMEOUT DEBUGGING END**

  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 requests per 5 minutes
    name: 'answers-api',
  });

  // **TIMEOUT DEBUGGING START**
  perfDebug.mark('rateLimiter:end');
  // **TIMEOUT DEBUGGING END**

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  try {
    const { answerIds } = req.query;

    if (answerIds) {
      // Handle fetching specific answers by IDs
      // **TIMEOUT DEBUGGING START**
      perfDebug.mark('getAnswersByIds:start');
      // **TIMEOUT DEBUGGING END**

      if (typeof answerIds !== 'string') {
        return res.status(400).json({
          message: 'answerIds parameter must be a comma-separated string.',
        });
      }
      const idsArray = answerIds.split(',');

      // **TIMEOUT DEBUGGING START**
      console.log(`[PERF-DEBUG] Fetching ${idsArray.length} specific answers`);
      // **TIMEOUT DEBUGGING END**

      const answers = await getAnswersByIds(idsArray);

      // **TIMEOUT DEBUGGING START**
      perfDebug.mark('getAnswersByIds:end');
      // **TIMEOUT DEBUGGING END**

      if (answers.length === 0) {
        return res.status(404).json({ message: 'Answer not found.' });
      }

      // **TIMEOUT DEBUGGING START**
      perfDebug.mark('handleGetRequest:end');
      // **TIMEOUT DEBUGGING END**

      res.status(200).json(answers);
    } else {
      // Handle fetching answers with pagination and filtering
      const { page, limit, likedOnly, sortBy } = req.query;
      const pageNumber = parseInt(page as string) || 1; // Default to page 1 if not provided
      const limitNumber = parseInt(limit as string) || 10;
      const likedOnlyFlag = likedOnly === 'true';
      const sortByValue = (sortBy as string) || 'mostRecent';

      // **TIMEOUT DEBUGGING START** - Safety net for timeouts
      const operationTimeout = setTimeout(() => {
        // If we're about to timeout, log that info and return partial data
        console.error(`[PERF-DEBUG] Operation about to timeout for ${req.url}`);

        // Return partial data to prevent gateway timeout
        // It's better to return something than to timeout completely
        res.status(206).json({
          answers: [],
          totalPages: 1,
          _debug: {
            timeout: true,
            message: 'Operation was about to timeout - returning empty results',
            siteId: process.env.SITE_ID,
          },
        });
      }, 13000); // Set to 13 seconds to ensure we respond before the vercel 15s timeout
      // **TIMEOUT DEBUGGING END**

      try {
        // **TIMEOUT DEBUGGING START**
        perfDebug.mark('getAnswers:call:start');
        // **TIMEOUT DEBUGGING END**

        const { answers, totalPages } = await getAnswers(
          pageNumber,
          limitNumber,
          likedOnlyFlag,
          sortByValue,
        );

        // **TIMEOUT DEBUGGING START**
        perfDebug.mark('getAnswers:call:end');

        // Clear the timeout since we completed successfully
        clearTimeout(operationTimeout);

        perfDebug.mark('handleGetRequest:end');
        const perfSummary = perfDebug.summary();
        console.log(
          `[PERF-DEBUG] Total API execution time: ${perfSummary.totalTime}ms`,
        );

        // Add performance data in development mode
        const responseData = {
          answers,
          totalPages,
          ...(process.env.NODE_ENV === 'development'
            ? {
                _debug: {
                  executionTime: perfSummary.totalTime,
                  markers: perfSummary.markers,
                },
              }
            : {}),
        };
        // **TIMEOUT DEBUGGING END**

        res.status(200).json(responseData);
      } catch (error: unknown) {
        // **TIMEOUT DEBUGGING START**
        // Clear the timeout to prevent duplicate responses
        clearTimeout(operationTimeout);

        // Error handling for GET requests
        console.error('Error fetching answers: ', error);
        if (error instanceof Error) {
          console.error(
            `[PERF-DEBUG] Error details: ${error.stack || error.message}`,
          );

          // Is this a timeout or connection error?
          if (
            error.message.includes('timed out') ||
            error.message.includes('timeout')
          ) {
            // This is a timeout error - return a more specific status
            return res.status(408).json({
              message: 'Request timed out while processing',
              error: error.message,
              siteId: process.env.SITE_ID,
            });
          }
          // **TIMEOUT DEBUGGING END**

          if ('code' in error && error.code === 8) {
            res.status(429).json({
              message: 'Error: Quota exceeded. Please try again later.',
            });
          } else if (error.message === 'Database not available') {
            res.status(503).json({ message: 'Database not available' });
          } else {
            res.status(500).json({
              message: 'Error fetching answers',
              error: error.message,
            });
          }
        } else {
          res.status(500).json({ message: 'An unknown error occurred' });
        }
      }
    }
  } catch (error: unknown) {
    // Error handling for GET requests
    console.error('Error fetching answers: ', error);
    if (error instanceof Error) {
      console.error(
        `[PERF-DEBUG] Error details: ${error.stack || error.message}`,
      );
      if ('code' in error && error.code === 8) {
        res.status(429).json({
          message: 'Error: Quota exceeded. Please try again later.',
        });
      } else if (error.message === 'Database not available') {
        res.status(503).json({ message: 'Database not available' });
      } else {
        res
          .status(500)
          .json({ message: 'Error fetching answers', error: error.message });
      }
    } else {
      res.status(500).json({ message: 'An unknown error occurred' });
    }
  }
}

// Deletes an answer by its ID
async function handleDeleteRequest(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Handle deleting an answer
    const { answerId } = req.query;
    if (!answerId || typeof answerId !== 'string') {
      return res
        .status(400)
        .json({ message: 'answerId parameter is required.' });
    }

    // Check for sudo permissions before allowing deletion
    // This is sufficient for deleting answers; siteAuth cookie is not required
    const sudo = getSudoCookie(req, res);
    if (!sudo.sudoCookieValue) {
      return res.status(403).json({ message: `Forbidden: ${sudo.message}` });
    }

    await deleteAnswerById(answerId);
    res.status(200).json({ message: 'Answer deleted successfully.' });
  } catch (error: unknown) {
    // Error handling for DELETE requests
    console.error('Handler: Error deleting answer: ', error);
    if (error instanceof Error) {
      if (error.message === 'Database not available') {
        res.status(503).json({ message: 'Database not available' });
      } else {
        res
          .status(500)
          .json({ message: 'Error deleting answer', error: error.message });
      }
    } else {
      res.status(500).json({
        message: 'Error deleting answer',
        error: 'An unknown error occurred',
      });
    }
  }
}
