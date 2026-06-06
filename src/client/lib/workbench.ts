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
  result: WorkbenchAnalyzeResponse | null;
  savedAt: string;
}

const SESSION_PREFIX = "langouste.workbench.";
export const SAVED_WORKBENCH_STORAGE_KEY = `${SESSION_PREFIX}latest.v1`;

export function routeForWorkbenchPayload(input: WorkbenchTextPayload): string {
  const payload = normalizePayload(input);
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
): void {
  if (!canUseLocalStorage()) return;
  const payload = normalizeSavedState(input);
  if (!payload) return;
  try {
    localStorage.setItem(SAVED_WORKBENCH_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in private windows or restricted browser contexts.
  }
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
    filoDoc,
    result,
    savedAt: new Date().toISOString(),
  };
}

function parseSavedStateJson(value: string): SavedWorkbenchState | null {
  try {
    const payload = JSON.parse(value) as Partial<SavedWorkbenchState>;
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
      filoDoc,
      result,
      savedAt: typeof payload.savedAt === "string" ? payload.savedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
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
