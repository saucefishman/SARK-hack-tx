// The only data access layer for the app. Typed with @sark/shared DTOs.
import type {
  FriendDetailResponse,
  FriendsResponse,
  ReviewAnswerBody,
  ReviewAnswerResponse,
  ReviewListResponse,
  PaybackResponse,
} from "@sark/shared";
import Constants from "expo-constants";
import { mockApi } from "../mocks";

// On a phone, "localhost" is the phone itself. Default to the host that served the
// JS bundle (the dev machine's LAN IP, e.g. "192.168.1.5:8081") on port 3000.
function defaultApiUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host || "localhost"}:3000`;
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL || defaultApiUrl();
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

export const getPayback = (id: string): Promise<PaybackResponse> => {
  if (USE_MOCKS) return Promise.reject(new Error("Connect the demo backend to load payback ideas."));
  return request(`/friends/${encodeURIComponent(id)}/payback`);
};

export const dismissPayback = (id: string): Promise<PaybackResponse> => {
  if (USE_MOCKS) return Promise.reject(new Error("Connect the demo backend to dismiss a plan."));
  return request(`/payback/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: JSON.stringify({}) });
};
