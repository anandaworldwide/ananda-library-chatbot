import type { NextApiRequest, NextApiResponse } from 'next';
import {
  updateRelatedQuestionsBatch,
  updateRelatedQuestions,
} from '@/utils/server/relatedQuestionsUtils';
import { withApiMiddleware } from '@/utils/server/apiMiddleware';
import { withJwtAuth } from '@/utils/server/jwtUtils';
import { RelatedQuestion } from '@/types/RelatedQuestion';
import { genericRateLimiter } from '@/utils/server/genericRateLimiter';

// Set maximum vercel duration to 300 seconds (5 minutes).
export const config = { maxDuration: 300 };

// Error types to help categorize and handle errors
const ERROR_TYPES = {
  TIMEOUT: 'timeout',
  FIRESTORE: 'firestore',
  NOT_FOUND: 'not_found',
  VALIDATION: 'validation',
  UNKNOWN: 'unknown',
};

/**
 * Map error to a standardized error type
 * @param error - The error to categorize
 * @returns Error type and message
 */
function categorizeError(error: unknown): { type: string; message: string } {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (
    errorMessage.includes('deadline') ||
    errorMessage.includes('timed out') ||
    errorMessage.includes('DEADLINE_EXCEEDED') ||
    errorMessage.includes('timeout')
  ) {
    return {
      type: ERROR_TYPES.TIMEOUT,
      message: `Operation timed out: ${errorMessage}`,
    };
  }

  if (errorMessage.includes('firestore')) {
    return {
      type: ERROR_TYPES.FIRESTORE,
      message: `Firestore error: ${errorMessage}`,
    };
  }

  if (
    errorMessage.includes('not found') ||
    errorMessage.includes('does not exist')
  ) {
    return {
      type: ERROR_TYPES.NOT_FOUND,
      message: errorMessage,
    };
  }

  return {
    type: ERROR_TYPES.UNKNOWN,
    message: errorMessage,
  };
}

/**
 * Middleware that allows either JWT authentication or Vercel cron requests
 * @param handler The API route handler to wrap
 * @returns A wrapped handler that checks for either valid JWT or Vercel cron
 */
function withJwtOrCronAuth(
  handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void,
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const userAgent = req.headers['user-agent'] || '';
    const isVercelCron = userAgent.startsWith('vercel-cron/');

    if (isVercelCron) {
      // Allow Vercel cron requests through
      return handler(req, res);
    } else {
      // For all other requests, require JWT authentication
      return withJwtAuth(handler)(req, res);
    }
  };
}

/**
 * API handler for managing related questions.
 * Supports batch updates (GET) and individual question updates (POST).
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{
    message: string;
    relatedQuestions?: RelatedQuestion[];
    error?: string;
    errorType?: string;
    operationId?: string;
  }>,
) {
  // Apply rate limiting. This method is called when a new question answer pair is added and it is
  // also called by a periodic cron job because the cron job can't do JWT tokens we keep the rate
  // limit very low here for security.
  const isAllowed = await genericRateLimiter(req, res, {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 50, // 50 requests per 5 minutes
    name: 'related-questions-api',
  });

  if (!isAllowed) {
    return; // Response is already sent by the rate limiter
  }

  if (req.method === 'GET') {
    // Handle batch update of related questions
    const { updateBatch } = req.query;

    // Validate updateBatch parameter
    if (!updateBatch || typeof updateBatch !== 'string') {
      return res.status(400).json({
        message: 'updateBatch parameter is required and must be a string.',
        errorType: ERROR_TYPES.VALIDATION,
      });
    }

    const batchSize = parseInt(updateBatch);
    if (isNaN(batchSize)) {
      return res.status(400).json({
        message: 'updateBatch must be a valid number.',
        errorType: ERROR_TYPES.VALIDATION,
      });
    }

    try {
      // Start a timeout that will respond early if operation approaches Vercel's limit
      // This prevents the function from failing completely with a 504
      const timeoutPromise = new Promise<void>((_, reject) => {
        // Set timeout to 280 seconds (slightly below the 300 second max)
        const timeoutMs = 280 * 1000;
        setTimeout(() => {
          reject(
            new Error(`API timeout safety triggered after ${timeoutMs}ms`),
          );
        }, timeoutMs);
      });

      // Race between the actual operation and the timeout
      const batchPromise = updateRelatedQuestionsBatch(batchSize);
      await Promise.race([batchPromise, timeoutPromise]);

      return res.status(200).json({
        message: 'Related questions batch update successful',
      });
    } catch (error: unknown) {
      // Handle and log errors during batch update
      const { type, message } = categorizeError(error);

      // Log detailed error information
      console.error(`Error updating related questions:`, {
        errorType: type,
        errorMessage: message,
        error,
        batchSize,
        timestamp: new Date().toISOString(),
      });

      // Determine appropriate status code
      const statusCode =
        type === ERROR_TYPES.TIMEOUT
          ? 503
          : type === ERROR_TYPES.NOT_FOUND
            ? 404
            : 500;

      return res.status(statusCode).json({
        message: 'Error updating related questions',
        error: message,
        errorType: type,
      });
    }
  } else if (req.method === 'POST') {
    // Handle update of related questions for a single document
    const { docId } = req.body;

    // Validate docId parameter
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({
        message: 'docId is required and must be a string.',
        errorType: ERROR_TYPES.VALIDATION,
      });
    }

    try {
      // Update related questions for the specified document
      const result = await updateRelatedQuestions(docId);
      return res.status(200).json({
        message: 'Related questions updated successfully',
        relatedQuestions: result.current,
      });
    } catch (error: unknown) {
      // Handle and log errors during individual update
      const { type, message } = categorizeError(error);

      console.error(`Error updating related questions for document ${docId}:`, {
        errorType: type,
        errorMessage: message,
        error,
        docId,
        timestamp: new Date().toISOString(),
      });

      // Determine appropriate status code
      const statusCode =
        type === ERROR_TYPES.TIMEOUT
          ? 503
          : type === ERROR_TYPES.NOT_FOUND
            ? 404
            : 500;

      return res.status(statusCode).json({
        message: 'Error updating related questions',
        error: message,
        errorType: type,
      });
    }
  } else {
    // Handle unsupported HTTP methods
    res.status(405).json({
      message: 'Method not allowed',
    });
  }
}

// Apply API middleware, skipping its default auth check and relying solely on withJwtOrCronAuth
export default withApiMiddleware(withJwtOrCronAuth(handler), {
  skipAuth: true,
});
