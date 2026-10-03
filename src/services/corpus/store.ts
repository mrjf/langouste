import type { FiloDocumentJson } from "filo";
import type { Database, Filter } from "../../lib/db/index.ts";

export interface CorpusDocumentContext {
  ownerId: string;
  sourceType: "message" | "workbench" | "audio" | "audio_drill" | "reading" | "import";
  sourceId?: string | null;
  conversationId?: string | null;
  language?: string | null;
  title?: string | null;
}

export interface CorpusDocumentRow {
  document_id: string;
  owner_id: string;
  source_type: CorpusDocumentContext["sourceType"];
  source_id: string | null;
  conversation_id: string | null;
  language: string | null;
  title: string | null;
  text: string;
  annotation_text: string;
  tier_ids: string[];
  filo_doc: FiloDocumentJson;
  created_at: string;
  updated_at: string;
  search_score?: number;
}

export interface CorpusSearchOptions {
  ownerId: string;
  language?: string;
  sourceType?: CorpusDocumentContext["sourceType"];
  limit?: number;
  includeDocument?: boolean;
}

/**
 * Persist the complete Filo JSON document and a denormalized FTS projection.
 * The JSON is the source of truth; annotation_text is rebuildable index data.
 */
export async function indexFiloDocument(
  db: Database,
  document: FiloDocumentJson,
  context: CorpusDocumentContext,
): Promise<CorpusDocumentRow> {
  const row = corpusDocumentRow(document, context);
  return db.upsert<CorpusDocumentRow>("corpus_documents", row, ["owner_id", "document_id"]);
}

export async function findOwnedCorpusDocument(
  db: Database,
  ownerId: string,
  documentId: string,
  sourceType?: CorpusDocumentContext["sourceType"],
): Promise<CorpusDocumentRow | null> {
  return db.selectOne<CorpusDocumentRow>("corpus_documents", {
    filters: [
      { op: "eq", column: "owner_id", value: ownerId },
      { op: "eq", column: "document_id", value: documentId },
      ...(sourceType ? [{ op: "eq" as const, column: "source_type", value: sourceType }] : []),
    ],
  });
}

export async function listOwnedReadingDocuments(
  db: Database,
  ownerId: string,
  limit = 100,
): Promise<CorpusDocumentRow[]> {
  return db.select<CorpusDocumentRow>("corpus_documents", {
    filters: [
      { op: "eq", column: "owner_id", value: ownerId },
      { op: "eq", column: "source_type", value: "reading" },
    ],
    order: [{ column: "updated_at", ascending: false }],
    limit: Math.min(Math.max(limit, 1), 200),
  });
}

export function corpusDocumentRow(
  document: FiloDocumentJson,
  context: CorpusDocumentContext,
): Omit<CorpusDocumentRow, "created_at" | "search_score"> {
  const metadata = document.metadata as Record<string, unknown>;
  const now = new Date().toISOString();
  return {
    document_id: document.id,
    owner_id: context.ownerId,
    source_type: context.sourceType,
    source_id: context.sourceId ?? null,
    conversation_id: context.conversationId ?? null,
    language: context.language ?? stringValue(metadata.language) ?? null,
    title: context.title ?? stringValue(metadata.title) ?? null,
    text: document.text,
    annotation_text: annotationSearchText(document),
    tier_ids: document.tiers.map((tier) => tier.id),
    filo_doc: document,
    updated_at: now,
  };
}

export async function searchCorpus(
  db: Database,
  query: string,
  options: CorpusSearchOptions,
): Promise<CorpusDocumentRow[]> {
  if (!db.fullTextSearch) {
    throw new Error("The configured database does not support corpus full-text search");
  }
  const filters: Filter[] = [{ op: "eq", column: "owner_id", value: options.ownerId }];
  if (options.language) filters.push({ op: "eq", column: "language", value: options.language });
  if (options.sourceType) {
    filters.push({ op: "eq", column: "source_type", value: options.sourceType });
  }
  return db.fullTextSearch<CorpusDocumentRow>("corpus_documents", query, {
    fields: [
      { column: "title", weight: 3 },
      { column: "text", weight: 2 },
      { column: "annotation_text", weight: 1 },
    ],
    filters,
    limit: Math.min(Math.max(options.limit ?? 20, 1), 100),
    columns:
      options.includeDocument === false
        ? "document_id, source_type, source_id, conversation_id, language, title, text, tier_ids"
        : undefined,
  });
}

function annotationSearchText(document: FiloDocumentJson): string {
  const parts: string[] = [];
  for (const tier of document.tiers) {
    parts.push(tier.id);
    for (const annotation of tier.annotations) {
      collectStrings(annotation.payload, parts);
      if (annotation.start >= 0 && annotation.end > annotation.start) {
        const text = textForByteRange(document.text, annotation.start, annotation.end);
        if (text) parts.push(text);
      }
    }
  }
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join("\n");
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 5 || value == null) return;
  if (typeof value === "string") {
    if (value.length <= 10_000) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output.push(key);
      collectStrings(child, output, depth + 1);
    }
  }
}

function textForByteRange(text: string, start: number, end: number): string {
  try {
    return new TextDecoder().decode(new TextEncoder().encode(text).slice(start, end));
  } catch {
    return "";
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
