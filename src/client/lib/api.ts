import { session } from "./stores.svelte";

const BASE = "/api";

async function request(path: string, options: RequestInit = {}) {
  const sess = session.value;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(sess ? { Authorization: `Bearer ${sess.access_token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  // Auth
  signup: (body: Record<string, unknown>) =>
    request("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: Record<string, unknown>) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body) }),

  // Profile
  getProfile: () => request("/profile"),
  updateProfile: (body: Record<string, unknown>) =>
    request("/profile", { method: "PATCH", body: JSON.stringify(body) }),

  // Conversations
  getConversations: () => request("/conversations"),
  createConversation: (body: Record<string, unknown>) =>
    request("/conversations", { method: "POST", body: JSON.stringify(body) }),
  joinConversation: (invite_code: string) =>
    request("/conversations/join", { method: "POST", body: JSON.stringify({ invite_code }) }),
  updateLanguages: (conversationId: string, body: Record<string, string>) =>
    request(`/conversations/${conversationId}/languages`, { method: "PATCH", body: JSON.stringify(body) }),

  // Messages
  getMessages: (conversationId: string, params?: Record<string, string>) => {
    const qs = params ? new URLSearchParams(params).toString() : "";
    return request(`/messages/${conversationId}${qs ? "?" + qs : ""}`);
  },
  sendMessage: (conversationId: string, raw_text: string) =>
    request(`/messages/${conversationId}`, { method: "POST", body: JSON.stringify({ raw_text }) }),

  // Review
  getDueReview: (language: string) => request(`/review/due/${language}`),
  reviewVocabulary: (vocabId: string, quality: number) =>
    request(`/review/vocabulary/${vocabId}`, { method: "POST", body: JSON.stringify({ quality }) }),
  reviewGrammar: (gapId: string, quality: number) =>
    request(`/review/grammar/${gapId}`, { method: "POST", body: JSON.stringify({ quality }) }),
};
