import type { FiloDocumentJson } from "./stores.svelte";
import type { WorkbenchAnalyzeResponse } from "./api-contracts";

export interface WorkbenchTextPayload {
  text: string;
  sourceLanguage: string;
  targetLanguage?: string;
  title?: string;
  autoAnalyze?: boolean;
  filoDoc?: FiloDocumentJson | null;
}

export interface SavedWorkbenchState extends WorkbenchTextPayload {
  workbenchId: string;
  result: WorkbenchAnalyzeResponse | null;
  savedAt: string;
}

const SESSION_PREFIX = "langouste.workbench.";
const MAX_RECENT_WORKBENCH_STATES = 8;
export const SAVED_WORKBENCH_STORAGE_KEY = `${SESSION_PREFIX}latest.v1`;
export const RECENT_WORKBENCH_STORAGE_KEY = `${SESSION_PREFIX}recent.v1`;

export function routeForWorkbenchPayload(input: WorkbenchTextPayload): string {
  const payload = normalizePayload(input);
  const saved = saveWorkbenchState({ ...payload, result: null });
  if (saved) return saved.workbenchId;

  const id = createPayloadId();
  if (canUseSessionStorage()) {
    sessionStorage.setItem(`${SESSION_PREFIX}${id}`, JSON.stringify(payload));
    return `payload=${encodeURIComponent(id)}`;
  }

  const params = new URLSearchParams();
  params.set("text", payload.text);
  params.set("source_language", payload.sourceLanguage);
  if (payload.targetLanguage) params.set("target_language", payload.targetLanguage);
  if (payload.title) params.set("title", payload.title);
  if (payload.autoAnalyze) params.set("auto", "1");
  return params.toString();
}

export function saveWorkbenchState(
  input: WorkbenchTextPayload & { result?: WorkbenchAnalyzeResponse | null },
): SavedWorkbenchState | null {
  if (!canUseLocalStorage()) return null;
  const payload = normalizeSavedState(input);
  if (!payload) return null;
  try {
    localStorage.setItem(SAVED_WORKBENCH_STORAGE_KEY, JSON.stringify(payload));
    saveRecentWorkbenchStates(upsertRecentWorkbenchState(payload, loadRecentWorkbenchStates()));
  } catch {
    // Storage can be unavailable in private windows or restricted browser contexts.
  }
  return payload;
}

export function loadSavedWorkbenchState(): SavedWorkbenchState | null {
  if (!canUseLocalStorage()) return null;
  try {
    const stored = localStorage.getItem(SAVED_WORKBENCH_STORAGE_KEY);
    if (!stored) return null;
    const payload = parseSavedStateJson(stored);
    if (!payload) {
      localStorage.removeItem(SAVED_WORKBENCH_STORAGE_KEY);
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function clearSavedWorkbenchState(): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(SAVED_WORKBENCH_STORAGE_KEY);
  } catch {
    // Ignore storage failures; clearing is best-effort.
  }
}

export function loadRecentWorkbenchStates(): SavedWorkbenchState[] {
  if (!canUseLocalStorage()) return [];
  try {
    const stored = localStorage.getItem(RECENT_WORKBENCH_STORAGE_KEY);
    const recent = stored ? parseRecentStateJson(stored) : [];
    const latest = loadSavedWorkbenchState();
    return sortRecentWorkbenchStates(
      latest ? upsertRecentWorkbenchState(latest, recent) : recent,
    ).slice(0, MAX_RECENT_WORKBENCH_STATES);
  } catch {
    return [];
  }
}

export function loadSavedWorkbenchStateById(workbenchId: string): SavedWorkbenchState | null {
  const id = normalizeWorkbenchId(workbenchId);
  if (!id) return null;
  return loadRecentWorkbenchStates().find((state) => state.workbenchId === id) ?? null;
}

export function parseWorkbenchRoute(route: string): WorkbenchTextPayload | null {
  const params = new URLSearchParams(route.startsWith("?") ? route.slice(1) : route);
  const payloadId = params.get("payload");
  if (payloadId && canUseSessionStorage()) {
    const stored = sessionStorage.getItem(`${SESSION_PREFIX}${payloadId}`);
    if (stored) return parsePayloadJson(stored);
  }

  const text = params.get("text")?.trim() ?? "";
  const sourceLanguage = params.get("source_language") ?? params.get("source") ?? "";
  if (!text || !sourceLanguage) return null;
  return normalizePayload({
    text,
    sourceLanguage,
    targetLanguage: params.get("target_language") ?? params.get("target") ?? undefined,
    title: params.get("title") ?? undefined,
    autoAnalyze: params.get("auto") === "1" || params.get("auto_analyze") === "1",
  });
}

function parsePayloadJson(value: string): WorkbenchTextPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<WorkbenchTextPayload>;
    if (typeof payload.text !== "string" || typeof payload.sourceLanguage !== "string") {
      return null;
    }
    return normalizePayload({
      text: payload.text,
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      title: payload.title,
      autoAnalyze: payload.autoAnalyze,
      filoDoc: parseFiloDocumentJson(payload.filoDoc),
    });
  } catch {
    return null;
  }
}

function normalizePayload(input: WorkbenchTextPayload): WorkbenchTextPayload {
  return {
    text: input.text.trim(),
    sourceLanguage: input.sourceLanguage.trim(),
    targetLanguage: input.targetLanguage?.trim() || undefined,
    title: input.title?.trim() || undefined,
    autoAnalyze: input.autoAnalyze ?? false,
    filoDoc: input.filoDoc ?? null,
  };
}

function normalizeSavedState(
  input: WorkbenchTextPayload & { result?: WorkbenchAnalyzeResponse | null },
): SavedWorkbenchState | null {
  const payload = normalizePayload(input);
  if (!payload.text || !payload.sourceLanguage) return null;
  const result = parseWorkbenchResult(input.result, payload.text, payload.targetLanguage);
  const filoDoc = result?.document ?? parseFiloDocumentJson(payload.filoDoc);
  if (filoDoc && filoDoc.text !== payload.text) return null;

  return {
    ...payload,
    workbenchId: workbenchIdForPayload(payload),
    filoDoc,
    result,
    savedAt: new Date().toISOString(),
  };
}

function parseSavedStateJson(value: string): SavedWorkbenchState | null {
  try {
    return parseSavedStateValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseSavedStateValue(value: unknown): SavedWorkbenchState | null {
  const payload = value as Partial<SavedWorkbenchState>;
  if (typeof payload.text !== "string" || typeof payload.sourceLanguage !== "string") {
    return null;
  }
  const base = normalizePayload({
    text: payload.text,
    sourceLanguage: payload.sourceLanguage,
    targetLanguage: payload.targetLanguage,
    title: payload.title,
    autoAnalyze: payload.autoAnalyze,
    filoDoc: parseFiloDocumentJson(payload.filoDoc),
  });
  const result = parseWorkbenchResult(payload.result, base.text, base.targetLanguage);
  const filoDoc = result?.document ?? parseFiloDocumentJson(base.filoDoc);
  if (filoDoc && filoDoc.text !== base.text) return null;
  return {
    ...base,
    workbenchId: normalizeWorkbenchId(payload.workbenchId) ?? workbenchIdForPayload(base),
    filoDoc,
    result,
    savedAt: typeof payload.savedAt === "string" ? payload.savedAt : new Date(0).toISOString(),
  };
}

function parseRecentStateJson(value: string): SavedWorkbenchState[] {
  try {
    const payload = JSON.parse(value);
    if (!Array.isArray(payload)) {
      localStorage.removeItem(RECENT_WORKBENCH_STORAGE_KEY);
      return [];
    }
    const states = payload
      .map((candidate) => parseSavedStateValue(candidate))
      .filter((candidate): candidate is SavedWorkbenchState => !!candidate);
    if (states.length !== payload.length) {
      saveRecentWorkbenchStates(states);
    }
    return sortRecentWorkbenchStates(states);
  } catch {
    localStorage.removeItem(RECENT_WORKBENCH_STORAGE_KEY);
    return [];
  }
}

function upsertRecentWorkbenchState(
  state: SavedWorkbenchState,
  existing: SavedWorkbenchState[],
): SavedWorkbenchState[] {
  const key = recentWorkbenchStateKey(state);
  return [
    state,
    ...existing.filter((candidate) => recentWorkbenchStateKey(candidate) !== key),
  ].slice(0, MAX_RECENT_WORKBENCH_STATES);
}

function sortRecentWorkbenchStates(states: SavedWorkbenchState[]): SavedWorkbenchState[] {
  return states.slice().sort((left, right) => savedAtMs(right.savedAt) - savedAtMs(left.savedAt));
}

function recentWorkbenchStateKey(state: SavedWorkbenchState): string {
  return state.workbenchId;
}

function workbenchIdForPayload(payload: WorkbenchTextPayload): string {
  return `w-${hashString(
    [payload.sourceLanguage.trim(), payload.targetLanguage?.trim() ?? "", payload.text.trim()].join(
      "\u0000",
    ),
  )}`;
}

function normalizeWorkbenchId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^w-[a-z0-9]+$/i.test(id) ? id : null;
}

function hashString(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const char = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function savedAtMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function saveRecentWorkbenchStates(states: SavedWorkbenchState[]): void {
  const bounded = states.slice(0, MAX_RECENT_WORKBENCH_STATES);
  if (bounded.length === 0) {
    localStorage.removeItem(RECENT_WORKBENCH_STORAGE_KEY);
    return;
  }
  for (let size = bounded.length; size > 0; size -= 1) {
    try {
      localStorage.setItem(RECENT_WORKBENCH_STORAGE_KEY, JSON.stringify(bounded.slice(0, size)));
      return;
    } catch {
      // Large analyzed documents can exceed localStorage quota; keep the freshest subset.
    }
  }
}

function parseWorkbenchResult(
  value: unknown,
  text: string,
  targetLanguage?: string,
): WorkbenchAnalyzeResponse | null {
  const result = value as Partial<WorkbenchAnalyzeResponse> | null | undefined;
  const document = parseFiloDocumentJson(result?.document);
  if (!document || document.text !== text) return null;
  const fallback = summarizeDocument(document, targetLanguage);
  const summary = result?.summary as Partial<WorkbenchAnalyzeResponse["summary"]> | undefined;
  return {
    document,
    summary: {
      words: numberValue(summary?.words) ?? fallback.words,
      sentences: numberValue(summary?.sentences) ?? fallback.sentences,
      phrases: numberValue(summary?.phrases) ?? fallback.phrases,
      targetLanguage:
        typeof summary?.targetLanguage === "string" && summary.targetLanguage.trim()
          ? summary.targetLanguage.trim()
          : fallback.targetLanguage,
    },
  };
}

function summarizeDocument(
  document: FiloDocumentJson,
  targetLanguage?: string,
): WorkbenchAnalyzeResponse["summary"] {
  return {
    words: annotationCount(document, "word"),
    sentences: annotationCount(document, "sentence"),
    phrases: annotationCount(document, "phrase"),
    targetLanguage: targetLanguage?.trim() || "en",
  };
}

function annotationCount(document: FiloDocumentJson, tierId: string): number {
  return document.tiers.find((tier) => tier.id === tierId)?.annotations.length ?? 0;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseFiloDocumentJson(value: unknown): FiloDocumentJson | null {
  const document = value as FiloDocumentJson | null | undefined;
  if (
    !document ||
    typeof document.id !== "string" ||
    typeof document.text !== "string" ||
    typeof document.byteLength !== "number" ||
    !document.metadata ||
    typeof document.metadata !== "object" ||
    !Array.isArray(document.tiers)
  ) {
    return null;
  }
  return document;
}

function createPayloadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}
