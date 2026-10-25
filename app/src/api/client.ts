// The only data access layer for the app. Typed with @sark/shared DTOs.
import type {
  FriendDetailResponse,
  FriendsResponse,
  ReviewAnswerBody,
  ReviewAnswerResponse,
  ReviewListResponse,
} from "@sark/shared";
import { mockApi } from "../mocks";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS === "1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${path}`);
  return (await res.json()) as T;
}

export const getFriends = (): Promise<FriendsResponse> =>
  USE_MOCKS ? mockApi.getFriends() : request("/friends");

export const getFriend = (id: string): Promise<FriendDetailResponse> =>
  USE_MOCKS ? mockApi.getFriend(id) : request(`/friends/${encodeURIComponent(id)}`);

export const getReview = (): Promise<ReviewListResponse> =>
  USE_MOCKS ? mockApi.getReview() : request("/review");

export const answerReview = (id: string, body: ReviewAnswerBody): Promise<ReviewAnswerResponse> =>
  USE_MOCKS
    ? mockApi.answerReview(id, body)
    : request(`/review/${encodeURIComponent(id)}/answer`, { method: "POST", body: JSON.stringify(body) });
