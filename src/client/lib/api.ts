import { session } from "./stores.svelte";
import { getSupabase } from "./supabase";

const BASE = "/api";

/** Try to refresh the Supabase session and update the store. */
async function refreshSession(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    // Try refreshSession first
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      session.value = data.session as any;
      localStorage.setItem(
        "langouste_session",
        JSON.stringify({ session: data.session, user: data.user }),
      );
      console.log("[API] Session refreshed successfully");
      return true;
    }

    // Fallback: try re-setting session from stored refresh token
    const stored = localStorage.getItem("langouste_session");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.session?.refresh_token) {
        const { data: retryData, error: retryError } = await supabase.auth.setSession({
          access_token: parsed.session.access_token,
          refresh_token: parsed.session.refresh_token,
        });
        if (!retryError && retryData.session) {
          session.value = retryData.session as any;
          localStorage.setItem(
            "langouste_session",
            JSON.stringify({ session: retryData.session, user: retryData.user }),
          );
          console.log("[API] Session restored via setSession");
          return true;
        }
      }
    }
  } catch (err) {
    console.error("[API] Session refresh failed:", err);
  }

  // All refresh attempts failed — clear stale session
  console.warn("[API] Could not refresh session, clearing");
  localStorage.removeItem("langouste_session");
  session.value = null;
  return false;
}

async function request(path: string, options: RequestInit = {}) {
  const sess = session.value;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(sess ? { Authorization: `Bearer ${sess.access_token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const method = options.method ?? "GET";
  console.log(`[API] ${method} ${path}`);

  let res = await fetch(`${BASE}${path}`, { ...options, headers });

  // Auto-refresh on 401 and retry once
  if (res.status === 401 && sess) {
    console.log(`[API] 401 on ${path}, refreshing session...`);
    const refreshed = await refreshSession();
    if (refreshed) {
      headers.Authorization = `Bearer ${session.value!.access_token}`;
      res = await fetch(`${BASE}${path}`, { ...options, headers });
    }
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server error: ${res.status} (no JSON body)`);
  }
  if (!res.ok) {
    console.error(`[API] ${method} ${path} → ${res.status}`, data);
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  console.log(`[API] ${method} ${path} → ${res.status}`);
  return data;
}

export const api = {
  // Auth
  signup: (body: Record<string, unknown>) =>
    request("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: Record<string, unknown>) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  localSession: () => request("/auth/local", { method: "POST" }),

  // Profile
  getProfile: () => request("/profile"),
  updateProfile: (body: Record<string, unknown>) =>
    request("/profile", { method: "PATCH", body: JSON.stringify(body) }),

  // Conversations
  getConversations: () => request("/conversations"),
  createConversation: (body: Record<string, unknown>) =>
    request("/conversations", { method: "POST", body: JSON.stringify(body) }),
  updateLanguages: (conversationId: string, body: Record<string, unknown>) =>
    request(`/conversations/${conversationId}/languages`, { method: "PATCH", body: JSON.stringify(body) }),

  // Messages
  getMessages: (conversationId: string, params?: Record<string, string>) => {
    const qs = params ? new URLSearchParams(params).toString() : "";
    return request(`/messages/${conversationId}${qs ? "?" + qs : ""}`);
  },
  checkMessage: (conversationId: string, text: string, language?: string) =>
    request(`/messages/${conversationId}/check`, {
      method: "POST",
      body: JSON.stringify({ text, language }),
    }),
  explainErrors: (conversationId: string, body: { text: string; errors: any[]; language: string; intent?: string }) =>
    request(`/messages/${conversationId}/explain`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sendMessage: (conversationId: string, text: string, language: string, intent?: string) =>
    request(`/messages/${conversationId}`, {
      method: "POST",
      body: JSON.stringify({ text, language, intent }),
    }),
  translateMessages: (conversationId: string, languages: string[]) =>
    request(`/messages/${conversationId}/translate`, { method: "POST", body: JSON.stringify({ languages }) }),

  // Agent connectors
  getAgentConnectors: () => request("/agent-connectors"),
  createAgentConnector: (body: Record<string, unknown>) =>
    request("/agent-connectors", { method: "POST", body: JSON.stringify(body) }),
  updateAgentConnector: (connectorId: string, body: Record<string, unknown>) =>
    request(`/agent-connectors/${connectorId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAgentConnector: (connectorId: string) =>
    request(`/agent-connectors/${connectorId}`, { method: "DELETE" }),
  testAgentConnector: (connectorId: string) =>
    request(`/agent-connectors/${connectorId}/test`, { method: "POST" }),
  setConversationConnector: (conversationId: string, agentConnectorId: string) =>
    request(`/conversations/${conversationId}/connector`, {
      method: "PATCH",
      body: JSON.stringify({ agent_connector_id: agentConnectorId }),
    }),

  // Profile stats
  getLanguageStats: (language: string) => request(`/profile/stats/${language}`),
  getDimensionItems: (language: string, dimension: string, params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/profile/dimension/${language}/${dimension}${qs}`);
  },
  getProfileItem: (itemType: "vocabulary" | "grammar", itemId: string) =>
    request(`/profile/item/${itemType}/${itemId}`),

  // Review
  getDueReview: (language: string) => request(`/review/due/${language}`),
  reviewVocabulary: (vocabId: string, quality: number) =>
    request(`/review/vocabulary/${vocabId}`, { method: "POST", body: JSON.stringify({ quality }) }),
  reviewGrammar: (gapId: string, quality: number) =>
    request(`/review/grammar/${gapId}`, { method: "POST", body: JSON.stringify({ quality }) }),
};
