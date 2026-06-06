import type { FiloDocumentJson, FiloSourceJson } from "./stores.svelte";

export interface FiloTextDocumentOptions {
  id?: string;
  role?: string;
  language?: string;
  kind?: string;
  source?: FiloSourceJson;
  metadata?: Record<string, unknown>;
}

export interface FiloSourceSummary {
  id: string;
  kind: string;
  label: string;
  provider?: string;
  module?: string;
  url?: string;
}

export interface FiloSourceActionInput {
  document?: FiloDocumentJson | null;
  text?: string | number | null;
  source?: FiloSourceJson;
  role?: string;
  language?: string;
  includeDocument?: boolean;
}

export const UI_COPY_SOURCE: FiloSourceJson = {
  id: "langouste.ui.copy",
  kind: "human",
  label: "Langouste UI copy",
  module: "src/client",
};

export const UI_RUNTIME_FALLBACK_SOURCE: FiloSourceJson = {
  id: "langouste.ui.runtime-fallback",
  kind: "fallback",
  label: "Runtime DOM text fallback",
  module: "src/client",
};

const encoder = new TextEncoder();

export function filoTextDocument(
  value: string | number | null | undefined,
  options: FiloTextDocumentOptions = {},
): FiloDocumentJson {
  const text = stringValue(value);
  const source = options.source ?? UI_COPY_SOURCE;
  const byteLength = encoder.encode(text).length;
  const hash = stableHash(`${source.id}\n${options.role ?? "text"}\n${text}`);
  const kind = options.kind ?? "ui.text";
  const role = options.role ?? "text";

  return {
    id: options.id ?? `ui-text:${hash}`,
    text,
    byteLength,
    metadata: {
      kind: "ui.text-document",
      role,
      sources: [source],
      ...options.metadata,
    },
    tiers: [
      {
        id: "ui.text",
        kind,
        description: "Visible UI text",
        source: source.id,
        sourceInfo: source,
        metadata: { role, language: options.language ?? "en" },
        annotations: [
          {
            id: `ui-text:${hash}:full`,
            tierId: "ui.text",
            kind,
            start: 0,
            end: byteLength,
            source: source.id,
            sourceInfo: source,
            payload: {
              text,
              role,
              language: options.language ?? "en",
              source: source.id,
            },
          },
        ],
      },
    ],
  };
}

export function sourceSummariesForDocument(
  document: FiloDocumentJson | null | undefined,
  fallbackSource?: FiloSourceJson,
): FiloSourceSummary[] {
  const summaries = new Map<string, FiloSourceSummary>();

  if (fallbackSource) addSourceSummary(summaries, fallbackSource);
  if (!document) return [...summaries.values()];

  const metadataSources = document.metadata?.sources;
  if (Array.isArray(metadataSources)) {
    for (const source of metadataSources) addSourceSummary(summaries, source);
  }

  for (const tier of document.tiers ?? []) {
    addSourceSummary(summaries, tier.sourceInfo ?? tier.source);
    for (const annotation of tier.annotations ?? []) {
      addSourceSummary(summaries, annotation.sourceInfo ?? annotation.source);
      const payload = annotation.payload ?? {};
      addSourceSummary(summaries, payload.source);
      addSourceSummary(summaries, payload.provider);
      addSourceSummary(summaries, payload.dictionarySource);
      addSourceSummary(summaries, payload.glossSource);
    }
  }

  return [...summaries.values()];
}

export function serializeFiloDocument(document: FiloDocumentJson): string {
  return JSON.stringify(document);
}

export function serializeSourceSummaries(summaries: FiloSourceSummary[]): string {
  return JSON.stringify(summaries);
}

export function filoSource(node: HTMLElement, input: FiloSourceActionInput) {
  applyFiloSourceAttributes(node, input);
  return {
    update(next: FiloSourceActionInput) {
      applyFiloSourceAttributes(node, next);
    },
    destroy() {
      node.removeAttribute("data-filo-document");
      node.removeAttribute("data-filo-document-id");
      node.removeAttribute("data-filo-preview");
      node.removeAttribute("data-filo-sources");
    },
  };
}

export function applyFiloSourceAttributes(node: HTMLElement, input: FiloSourceActionInput): void {
  const text = stringValue(input.text ?? node.textContent);
  const document =
    input.document ??
    filoTextDocument(text, {
      role: input.role,
      language: input.language,
      source: input.source ?? UI_COPY_SOURCE,
    });
  const summaries = sourceSummariesForDocument(document, input.source);
  node.dataset.filoDocumentId = document.id;
  node.dataset.filoPreview = text || document.text;
  node.dataset.filoSources = serializeSourceSummaries(summaries);

  if (input.includeDocument ?? !input.document) {
    node.dataset.filoDocument = serializeFiloDocument(document);
  } else {
    node.removeAttribute("data-filo-document");
  }
}

export function fallbackDocumentForVisibleText(text: string): FiloDocumentJson {
  return filoTextDocument(text, {
    role: "visible-dom-fallback",
    source: UI_RUNTIME_FALLBACK_SOURCE,
  });
}

function addSourceSummary(summaries: Map<string, FiloSourceSummary>, source: unknown): void {
  const summary = normalizeSourceSummary(source);
  if (!summary || summaries.has(summary.id)) return;
  summaries.set(summary.id, summary);
}

function normalizeSourceSummary(source: unknown): FiloSourceSummary | null {
  if (typeof source === "string") {
    const id = source.trim();
    if (!id) return null;
    return {
      id,
      kind: kindForSourceId(id),
      label: labelForSourceId(id),
    };
  }

  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  const id = stringValue(record.id).trim();
  if (!id) return null;
  return {
    id,
    kind: stringValue(record.kind) || kindForSourceId(id),
    label: stringValue(record.label) || labelForSourceId(id),
    provider: optionalString(record.provider),
    module: optionalString(record.module),
    url: optionalString(record.url),
  };
}

function kindForSourceId(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes("wiktionary") || lower.includes("dictionary") || lower.includes("dict")) {
    return "dictionary";
  }
  if (lower.includes("translat") || lower.includes("claude-provider") || lower.includes("google")) {
    return "translator";
  }
  if (lower.includes("lit") || lower.includes("ipa") || lower.includes("phonetic")) {
    return "transliterator";
  }
  if (lower.includes("spell")) return "spellcheck";
  if (lower.includes("agent") || lower.includes("claude") || lower.includes("openclaw")) {
    return "agent";
  }
  if (lower.includes("ui.copy") || lower.includes("human")) return "human";
  if (lower.includes("fallback")) return "fallback";
  return "system";
}

function labelForSourceId(id: string): string {
  return id
    .split(/[.:_-]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text || undefined;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
