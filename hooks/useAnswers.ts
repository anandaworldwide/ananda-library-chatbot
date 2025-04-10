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

// Query keys for React Query cache
export const queryKeys = {
  answers: (page?: number, sortBy?: string) =>
    ['answers', page, sortBy].filter(Boolean),
  downvotedAnswers: () => ['downvotedAnswers'],
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
      const response = await queryFetch(
        `/api/answers?page=${page}&limit=10&sortBy=${sortBy}`,
        {
          method: 'GET',
        },
      );

      if (!response.ok) {
        const error = new Error('Failed to fetch answers') as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
};

/**
 * Hook for fetching downvoted answers
 */
export function useDownvotedAnswers(options?: {
  enabled?: boolean;
  onSuccess?: (data: Answer[]) => void;
  onError?: (error: Error) => void;
}) {
  return useQuery({
    queryKey: queryKeys.downvotedAnswers(),
    queryFn: async () => {
      const response = await queryFetch('/api/downvotedAnswers');

      if (!response.ok) {
        const error = new Error(
          'Failed to fetch downvoted answers',
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    ...options,
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
