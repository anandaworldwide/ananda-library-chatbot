/**
 * React Query hook for fetching answers with JWT authentication
 * Provides pagination and sorting functionality
 */

import {
  useQuery,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';
import { queryFetch } from '@/utils/client/reactQueryConfig';
import { Answer } from '@/types/answer';
import { fetchWithAuth } from '@/utils/client/tokenManager';

// Query keys for React Query cache
export const queryKeys = {
  answers: (page?: number, sortBy?: string) =>
    ['answers', page, sortBy].filter(Boolean),
  downvotedAnswers: (page?: number) =>
    ['downvotedAnswers', page].filter(Boolean),
  relatedQuestions: (docId?: string) =>
    ['relatedQuestions', docId].filter(Boolean),
};

// Response type for the answers query
export interface AnswersResponse {
  answers: Answer[];
  totalPages: number;
  currentPage: number;
}

type AnswersQueryKey = ReturnType<typeof queryKeys.answers>;

// **TIMEOUT DEBUGGING START**
// Custom timeout error with additional context
export class TimeoutError extends Error {
  status?: number;
  timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

// Helper to add timeout to fetch operations
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000, // Default 30s timeout
): Promise<Response> {
  const controller = new AbortController();
  const { signal } = controller;

  // Create a timeout that aborts the fetch
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    // Add the abort signal to the fetch options
    const response = await queryFetch(url, {
      ...options,
      signal,
    });

    // Clear the timeout if the fetch completes
    clearTimeout(timeout);
    return response;
  } catch (error) {
    // Clear the timeout to prevent memory leaks
    clearTimeout(timeout);

    // Check if this was an abort error (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`Request timed out after ${timeoutMs}ms:`, url);
      throw new TimeoutError(
        `Request timed out after ${timeoutMs}ms`,
        timeoutMs,
      );
    }

    // Rethrow other errors
    throw error;
  }
}
// **TIMEOUT DEBUGGING END**

/**
 * Hook for fetching paginated answers
 *
 * @param page - Current page number
 * @param sortBy - Sort method (mostRecent or mostUpvoted)
 * @param options - Additional React Query options
 */
export const useAnswers = (
  page: number = 1,
  sortBy: string = 'mostRecent',
  options?: Omit<
    UseQueryOptions<AnswersResponse, Error, AnswersResponse, AnswersQueryKey>,
    'queryKey' | 'queryFn'
  >,
): UseQueryResult<AnswersResponse, Error> => {
  return useQuery<AnswersResponse, Error, AnswersResponse, AnswersQueryKey>({
    queryKey: queryKeys.answers(page, sortBy),
    queryFn: async () => {
      // **TIMEOUT DEBUGGING START**
      const startTime = Date.now();
      const url = `/api/answers?page=${page}&limit=10&sortBy=${sortBy}`;

      console.log(`[API-DEBUG] Fetching answers: ${url}`);

      try {
        // Use fetchWithTimeout to handle timeouts with custom timeout of 25 seconds
        // This is under the 30s Lambda timeout but gives us control over error handling
        const response = await fetchWithTimeout(url, { method: 'GET' }, 25000);

        // Add timing information
        const duration = Date.now() - startTime;
        console.log(`[API-DEBUG] Fetch completed in ${duration}ms for ${url}`);
        // **TIMEOUT DEBUGGING END**

        if (!response.ok) {
          // **TIMEOUT DEBUGGING START**
          const errorData = await response.json().catch(() => ({}));
          const error = new Error(
            errorData.message || `Failed to fetch answers (${response.status})`,
          ) as Error & {
            status?: number;
          };
          // **TIMEOUT DEBUGGING END**

          error.status = response.status;
          throw error;
        }

        return response.json();
        // **TIMEOUT DEBUGGING START**
      } catch (error) {
        // Add debugging context to errors
        const duration = Date.now() - startTime;
        console.error(
          `[API-DEBUG] Fetch failed after ${duration}ms for ${url}`,
          error,
        );

        if (error instanceof TimeoutError) {
          console.error(
            `[API-DEBUG] Request timed out: ${url} (${error.timeoutMs}ms timeout)`,
          );
          // We can also log additional information about the environment here
          console.error(`[API-DEBUG] Environment: ${process.env.NODE_ENV}`);
          console.error(
            `[API-DEBUG] Site ID: ${process.env.NEXT_PUBLIC_SITE_ID || 'unknown'}`,
          );
        }

        // Re-throw the error for React Query to handle
        throw error;
      }
      // **TIMEOUT DEBUGGING END**
    },
    // **TIMEOUT DEBUGGING START**
    // Increase retry delay for timeouts
    retryDelay: (attemptIndex, error) => {
      // For timeouts, use longer delays
      if (error instanceof TimeoutError) {
        return Math.min(1000 * 3 ** attemptIndex, 60000); // Exponential backoff, max 60s
      }
      // For other errors, use default behavior
      return Math.min(1000 * 2 ** attemptIndex, 30000);
    },
    // Decrease retry count for timeouts to avoid long waits
    retry: (failureCount, error) => {
      // For timeouts, only retry once to avoid cascade issues
      if (error instanceof TimeoutError) {
        return failureCount < 1;
      }
      // For other errors, use default behavior
      if (error instanceof Error && 'status' in error) {
        const status = (error as Error & { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 401) {
          return false;
        }
      }
      return failureCount < 3;
    },
    // More reasonable stale time for production
    staleTime:
      process.env.NODE_ENV === 'production' ? 2 * 60 * 1000 : 5 * 60 * 1000, // 2 minutes in production, 5 in dev
    // **TIMEOUT DEBUGGING END**
    ...options,
  });
};

/**
 * Hook for fetching downvoted answers
 */
export function useDownvotedAnswers(page: number = 1) {
  return useQuery({
    queryKey: queryKeys.downvotedAnswers(page),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `/api/downvotedAnswers?page=${page}`,
      );
      if (!response.ok) {
        const error = new Error(
          'Failed to fetch downvoted answers',
        ) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });
}

/**
 * Hook for fetching related questions
 */
export function useRelatedQuestions(
  docId: string,
  options?: {
    enabled?: boolean;
    onSuccess?: (data: any) => void;
    onError?: (error: Error) => void;
  },
) {
  return useQuery({
    queryKey: queryKeys.relatedQuestions(docId),
    queryFn: async () => {
      const response = await queryFetch('/api/relatedQuestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });

      if (!response.ok) {
        const error = new Error(
          'Failed to fetch related questions',
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
    staleTime: 60 * 60 * 1000, // Consider data fresh for 1 hour
    ...options,
  });
}
