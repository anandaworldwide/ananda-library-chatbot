/**
 * React Query mutation hook for voting on answers
 *
 * This hook provides a standardized way to submit votes with:
 * - Automatic authentication via JWT
 * - Error handling
 * - Optimistic updates
 * - Automatic cache invalidation
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryFetch } from "@/utils/client/reactQueryConfig";
import { Answer } from "@/types/answer";
import { queryKeys } from "./useAnswers";

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
      const response = await queryFetch("/api/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ docId, vote }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error || "Failed to submit vote") as Error & { status?: number };
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
      queryClient.setQueriesData({ queryKey: queryKeys.answers() }, (old: any) => {
        if (!old?.answers) return old;

        return {
          ...old,
          answers: old.answers.map((answer: Answer) => (answer.id === docId ? { ...answer, vote } : answer)),
        };
      });

      // Return a context object with the snapshot
      return { previousAnswers };
    },

    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (error, variables, context) => {
      console.error("Error voting:", error);

      if (context?.previousAnswers) {
        queryClient.setQueriesData({ queryKey: queryKeys.answers() }, context.previousAnswers);
      }
    },

    // After success or error, invalidate affected queries to refetch fresh data
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.answers() });
    },
  });
}
