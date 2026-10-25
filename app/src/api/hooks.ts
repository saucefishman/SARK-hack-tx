import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventEditBody, ReviewAnswerBody } from "@sark/shared";
import { answerReview, getFriend, getFriends, getReview, getPayback, dismissPayback, editEvent } from "./client";

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
        qc.invalidateQueries({ queryKey: ["payback"] }),
      ]);
    },
  });
}

export const usePayback = (id: string) =>
  useQuery({ queryKey: ["payback", id], queryFn: () => getPayback(id), enabled: !!id });

export function useDismissPayback(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dismissPayback,
    onSuccess: async (data) => {
      qc.setQueryData(["payback", id], data);
      await qc.invalidateQueries({ queryKey: ["friends"] });
    },
  });
}

export function useEditEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EventEditBody }) => editEvent(id, body),
    onSuccess: async () => {
      await Promise.all(["friends", "friend", "review", "payback"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
    },
  });
}
