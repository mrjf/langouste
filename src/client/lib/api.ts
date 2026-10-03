import { session } from "./stores.svelte";
import type { SelfCorrectedSpan } from "../../types/index.ts";
import type {
  AgentConnectorPayload,
  ApiClient,
  CreateConversationRequest,
  ExplainErrorsRequest,
  ItemType,
  JsonObject,
  UpdateLanguagesRequest,
  WorkbenchAnalyzeRequest,
  WorkbenchInteractionRequest,
} from "./api-contracts";

const BASE = "/api";

function profileItemQuery(language?: string): string {
  return language ? `?${new URLSearchParams({ language }).toString()}` : "";
}

const SINGLE_USER =
  (import.meta.env.VITE_SINGLE_USER as string | undefined)?.toLowerCase() === "true";

/** Refresh the fixed single-user session. Multi-user JWTs require login again. */
async function refreshSession(): Promise<boolean> {
  if (SINGLE_USER) {
    try {
      const res = await fetch(`${BASE}/auth/local`, { method: "POST" });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data?.session?.access_token) return false;
      session.value = data.session;
      localStorage.setItem(
        "langouste_session",
        JSON.stringify({ session: data.session, user: data.user }),
      );
      console.log("[API] Single-user session refreshed via /auth/local");
      return true;
    } catch (err) {
      console.error("[API] /auth/local refresh failed:", err);
      return false;
    }
  }

  console.warn("[API] Could not refresh session, clearing");
  localStorage.removeItem("langouste_session");
  session.value = null;
  return false;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const sess = session.value;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(sess ? { Authorization: `Bearer ${sess.access_token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
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

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server error: ${res.status} (no JSON body)`);
  }
  if (!res.ok) {
    console.error(`[API] ${method} ${path} → ${res.status}`, data);
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  console.log(`[API] ${method} ${path} → ${res.status}`);
  return data as T;
}

/** Authenticated JSON transport for feature modules that own their contracts. */
export function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options);
}

export const api: ApiClient = {
  // Auth
  signup: (body: JsonObject) =>
    request("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  login: (body: JsonObject) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  localSession: () => request("/auth/local", { method: "POST" }),

  // Profile
  getProfile: () => request("/profile"),
  updateProfile: (body: JsonObject) =>
    request("/profile", { method: "PATCH", body: JSON.stringify(body) }),

  // Conversations
  getConversations: () => request("/conversations"),
  createConversation: (body: CreateConversationRequest) =>
    request("/conversations", { method: "POST", body: JSON.stringify(body) }),
  updateLanguages: (conversationId: string, body: UpdateLanguagesRequest) =>
    request(`/conversations/${conversationId}/languages`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  /** Mark a conversation read for the current user (clears its unread badge). */
  markConversationRead: (conversationId: string) =>
    request(`/conversations/${conversationId}/read`, {
      method: "PATCH",
      body: JSON.stringify({}),
    }),

  // Messages
  getMessages: (conversationId: string, params?: Record<string, string>) => {
    const qs = params ? new URLSearchParams(params).toString() : "";
    return request(`/messages/${conversationId}${qs ? `?${qs}` : ""}`);
  },
  checkMessage: (conversationId: string, text: string, language?: string) =>
    request(`/messages/${conversationId}/check`, {
      method: "POST",
      body: JSON.stringify({ text, language }),
    }),
  explainErrors: (conversationId: string, body: ExplainErrorsRequest) =>
    request(`/messages/${conversationId}/explain`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sendMessage: (
    conversationId: string,
    text: string,
    language: string,
    intent?: string,
    selfCorrectedSpans?: SelfCorrectedSpan[],
  ) =>
    request(`/messages/${conversationId}`, {
      method: "POST",
      body: JSON.stringify({ text, language, intent, self_corrected_spans: selfCorrectedSpans }),
    }),
  translateMessages: (conversationId: string, languages: string[]) =>
    request(`/messages/${conversationId}/translate`, {
      method: "POST",
      body: JSON.stringify({ languages }),
    }),

  /** Fetch synthesised audio for a message+language. Returns a blob URL the
   *  caller is responsible for revoking. Throws if the server returns non-200. */
  fetchMessageAudio: async (
    conversationId: string,
    messageId: string,
    lang: string,
  ): Promise<string> => {
    const sess = session.value;
    const headers: Record<string, string> = sess
      ? { Authorization: `Bearer ${sess.access_token}` }
      : {};
    const url = `${BASE}/messages/${conversationId}/${messageId}/audio?lang=${encodeURIComponent(lang)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let msg = `Audio request failed: ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {
        // body wasn't JSON — keep the status line
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // Agent connectors
  getAgentConnectors: () => request("/agent-connectors"),
  createAgentConnector: (body: AgentConnectorPayload) =>
    request("/agent-connectors", { method: "POST", body: JSON.stringify(body) }),
  updateAgentConnector: (connectorId: string, body: Partial<AgentConnectorPayload>) =>
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
  getProfileLanguages: () => request("/profile/languages"),
  getLanguageStats: (language: string) => request(`/profile/stats/${language}`),
  getReadingInteractions: (language: string, limit = 12) =>
    request(
      `/profile/reading-interactions/${encodeURIComponent(language)}?limit=${Math.min(Math.max(limit, 1), 200)}`,
    ),
  getDimensionItems: (language: string, dimension: string, params?: Record<string, string>) => {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
    return request(`/profile/dimension/${language}/${dimension}${qs}`);
  },
  getProfileItem: (itemType: ItemType, itemId: string, language?: string) =>
    request(`/profile/item/${itemType}/${encodeURIComponent(itemId)}${profileItemQuery(language)}`),
  getProfileItemReference: (itemType: ItemType, itemId: string, language?: string) =>
    request(
      `/profile/item/${itemType}/${encodeURIComponent(itemId)}/reference${profileItemQuery(language)}`,
    ),
  fetchProfileItemAudio: async (itemType: ItemType, itemId: string, language?: string) => {
    const sess = session.value;
    const headers: Record<string, string> = sess
      ? { Authorization: `Bearer ${sess.access_token}` }
      : {};
    const res = await fetch(
      `${BASE}/profile/item/${itemType}/${encodeURIComponent(itemId)}/audio${profileItemQuery(language)}`,
      { headers },
    );
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // body wasn't JSON — keep the status line
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  lookupDictionary: (term: string, language: string, options?: { recordSeen?: boolean }) => {
    const params = new URLSearchParams({ term, language });
    if (options?.recordSeen) params.set("record_seen", "1");
    return request(`/dictionary?${params.toString()}`);
  },
  translateDictionary: (term: string, sourceLanguage: string, targetLanguage: string) =>
    request(
      `/dictionary/translations?${new URLSearchParams({
        term,
        source_language: sourceLanguage,
        target_language: targetLanguage,
      }).toString()}`,
    ),
  fetchDictionaryAudio: async (term: string, language: string) => {
    const sess = session.value;
    const headers: Record<string, string> = sess
      ? { Authorization: `Bearer ${sess.access_token}` }
      : {};
    const res = await fetch(
      `${BASE}/dictionary/audio?${new URLSearchParams({ term, language }).toString()}`,
      { headers },
    );
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // body wasn't JSON — keep the status line
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  analyzeWorkbench: (body: WorkbenchAnalyzeRequest) =>
    request("/workbench/analyze", { method: "POST", body: JSON.stringify(body) }),
  fetchWorkbenchAudio: async (text: string, language?: string) => {
    const sess = session.value;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(sess ? { Authorization: `Bearer ${sess.access_token}` } : {}),
    };
    const res = await fetch(`${BASE}/workbench/audio`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, language }),
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // body wasn't JSON — keep the status line
      }
      throw new Error(msg);
    }
    const blob = await res.blob();
    return {
      url: URL.createObjectURL(blob),
      audioId: res.headers.get("X-Langouste-Audio-Id"),
      contentType: blob.type || res.headers.get("Content-Type") || "audio/mpeg",
      byteLength: blob.size,
    };
  },
  recordWorkbenchInteraction: (body: WorkbenchInteractionRequest) =>
    request("/workbench/interactions", { method: "POST", body: JSON.stringify(body) }),

  // Audio drills
  getAudioDrills: () => request("/audio-drills"),
  getAudioDrill: (id: string) => request(`/audio-drills/${encodeURIComponent(id)}`),
  createTopicAudioDrill: (body) =>
    request("/audio-drills/topic", { method: "POST", body: JSON.stringify(body) }),
  saveAudioDrillLesson: (id: string, lesson) =>
    request(`/audio-drills/${encodeURIComponent(id)}/lesson`, {
      method: "PUT",
      body: JSON.stringify({ lesson }),
    }),

  // Exercises
  getExerciseSession: (
    language: string,
    limit = 8,
    options: {
      targetLexemes?: string[];
      targetConceptIds?: string[];
      targetGrammarTags?: string[];
      exerciseKinds?: string[];
      deterministicOnly?: boolean;
    } = {},
  ) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.targetLexemes?.length) params.set("lexeme", options.targetLexemes.join(","));
    if (options.targetConceptIds?.length) params.set("concept", options.targetConceptIds.join(","));
    if (options.targetGrammarTags?.length)
      params.set("grammar", options.targetGrammarTags.join(","));
    if (options.exerciseKinds?.length) params.set("kind", options.exerciseKinds.join(","));
    if (options.deterministicOnly != null) {
      params.set("deterministic", options.deterministicOnly ? "1" : "0");
    }
    return request(`/exercises/session/${encodeURIComponent(language)}?${params}`);
  },
  submitExerciseAttempt: (attemptId: string, body: { answer: string }) =>
    request(`/exercises/attempts/${encodeURIComponent(attemptId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getExerciseHistory: (language: string, limit = 20) =>
    request(`/exercises/history/${encodeURIComponent(language)}?limit=${limit}`),

  // Resources
  getLanguageResources: () => request("/resources"),
  searchCorpus: (query, options = {}) => {
    const params = new URLSearchParams({ q: query });
    if (options.language) params.set("language", options.language);
    if (options.sourceType) params.set("source_type", options.sourceType);
    if (options.limit != null) params.set("limit", String(options.limit));
    if (options.includeDocument) params.set("include_document", "true");
    return request(`/corpus/search?${params}`);
  },

  // Review
  getDueReview: (language: string) => request(`/review/due/${language}`),
  getFSRSConfig: (language: string) => request(`/review/fsrs/${language}`),
  updateFSRSConfig: (language: string, body: JsonObject) =>
    request(`/review/fsrs/${language}`, { method: "PATCH", body: JSON.stringify(body) }),
  tuneFSRSConfig: (language: string, body: JsonObject = {}) =>
    request(`/review/fsrs/${language}/tune`, { method: "POST", body: JSON.stringify(body) }),
  reviewVocabulary: (vocabId: string, quality: number) =>
    request(`/review/vocabulary/${vocabId}`, { method: "POST", body: JSON.stringify({ quality }) }),
  reviewGrammar: (gapId: string, quality: number) =>
    request(`/review/grammar/${gapId}`, { method: "POST", body: JSON.stringify({ quality }) }),
};
