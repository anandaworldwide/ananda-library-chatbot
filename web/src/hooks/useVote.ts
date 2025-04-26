/**
 * React Query mutation hook for voting on answers
 *
 * This hook provides a standardized way to submit votes with:
 * - Automatic authentication via JWT
 * - Error handling
 * - Optimistic updates
 * - Automatic cache invalidation
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryFetch } from '@/utils/client/reactQueryConfig';
import { getOrCreateUUID } from '@/utils/client/uuid';
import { logEvent } from '@/utils/client/analytics';
import { Answer } from '@/types/answer';
import { queryKeys } from './useAnswers';

interface VoteParams {
  docId: string;
  vote: 1 | 0 | -1; // 1 for upvote, 0 for neutral, -1 for downvote
}

/**
 * Hook for voting on an answer
 *
 * @returns Mutation object with submit function and status
 */
export function useVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ docId, vote }: VoteParams) => {
      const response = await queryFetch('/api/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ docId, vote }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(
          errorData.error || 'Failed to submit vote',
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return response.json();
    },

    // Optimistically update the answer in the cache
    onMutate: async ({ docId, vote }: VoteParams) => {
      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.answers() });

      // Snapshot the previous value
      const previousAnswers = queryClient.getQueryData(queryKeys.answers());

      // Optimistically update the cache
      queryClient.setQueriesData(
        { queryKey: queryKeys.answers() },
        (old: any) => {
          if (!old?.answers) return old;

          return {
            ...old,
            answers: old.answers.map((answer: Answer) =>
              answer.id === docId ? { ...answer, vote } : answer,
            ),
          };
        },
      );

      // Return a context object with the snapshot
      return { previousAnswers };
    },

    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (error, variables, context) => {
      console.error('Error voting:', error);

      if (context?.previousAnswers) {
        queryClient.setQueriesData(
          { queryKey: queryKeys.answers() },
          context.previousAnswers,
        );
      }
    },

    // After success or error, invalidate affected queries to refetch fresh data
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.answers() });
    },
  });
}

/**
 * implementation for useLike hook with UUID handling
 */
export function useLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      answerId,
      like,
    }: {
      answerId: string;
      like: boolean;
    }) => {
      const uuid = getOrCreateUUID();

      // Log attempt for debugging
      console.log(`Like attempt: ${answerId}, like: ${like}, uuid: ${uuid}`);

      const response = await queryFetch('/api/like', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answerId,
          uuid,
          like,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Like API error response:', errorData);
        const error = new Error(
          errorData.error ||
            errorData.message ||
            'Failed to update like status',
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      return response.json();
    },

    // Optimistically update the likes count
    onMutate: async ({ answerId, like }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.answers() });

      const previousAnswers = queryClient.getQueryData(queryKeys.answers());

      queryClient.setQueriesData(
        { queryKey: queryKeys.answers() },
        (old: any) => {
          if (!old?.answers) return old;

          return {
            ...old,
            answers: old.answers.map((answer: Answer) =>
              answer.id === answerId
                ? {
                    ...answer,
                    likeCount: like
                      ? (answer.likeCount || 0) + 1
                      : Math.max(0, (answer.likeCount || 0) - 1),
                  }
                : answer,
            ),
          };
        },
      );

      return { previousAnswers };
    },

    onError: (error, variables, context) => {
      console.error('Error updating like status:', error);

      // Log analytics error event
      logEvent('like_error', 'Error', variables.answerId);

      if (context?.previousAnswers) {
        queryClient.setQueriesData(
          { queryKey: queryKeys.answers() },
          context.previousAnswers,
        );
      }
    },

    onSuccess: (data, variables) => {
      // Log analytics success event
      logEvent('like_answer', 'Engagement', variables.answerId);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.answers() });
    },
  });
}
