import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewAnswerBody } from "@sark/shared";
import { answerReview, getFriend, getFriends, getReview } from "./client";

export const useFriends = () => useQuery({ queryKey: ["friends"], queryFn: getFriends });

export const useFriend = (id: string) =>
  useQuery({ queryKey: ["friend", id], queryFn: () => getFriend(id), enabled: !!id });

export const useReview = () => useQuery({ queryKey: ["review"], queryFn: getReview });

export function useAnswerReview(onSaved?: () => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewAnswerBody }) => answerReview(id, body),
    onSuccess: async () => {
      // Let native cards finish their successful-save exit before refetch removes them.
      if (onSaved) await onSaved();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["friends"] }),
        qc.invalidateQueries({ queryKey: ["friend"] }),
        qc.invalidateQueries({ queryKey: ["review"] }),
      ]);
    },
  });
}
