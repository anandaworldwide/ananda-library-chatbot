/**
 * React Query hook for fetching answers with JWT authentication.
 * Provides pagination and sorting functionality.
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
      const url = `/api/answers?page=${page}&limit=10&sortBy=${sortBy}`;
      const response = await queryFetch(url, { method: 'GET' });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(
          errorData.message || `Failed to fetch answers (${response.status})`,
        ) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
    // More reasonable stale time for production
    staleTime:
      process.env.NODE_ENV === 'production' ? 2 * 60 * 1000 : 5 * 60 * 1000,
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
