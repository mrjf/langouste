import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { getAudioProvider } from "../../services/ai/audio/index.ts";
import { analyzeWorkbenchDocument } from "../../services/corpus/workbench.ts";
import { getMessageById } from "../../services/database/messages.ts";
import { getMember } from "../../services/database/members.ts";
import {
  findAudioAssetForRequest,
  storeAudioAsset,
  type CachedAudioAsset,
} from "../../services/corpus/audio-assets.ts";
import { recordInteraction } from "../../services/spaced-repetition/interactions.ts";
import { adminDb, type Database } from "../../lib/db/index.ts";
import type { FiloAnnotation, FiloDocumentJson, FiloTierJson } from "../../../filo/src/types";
import type { LanguageCode } from "../../types/index.ts";

type WorkbenchRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

export const workbenchRoutes = new Hono<WorkbenchRouteBindings>();

workbenchRoutes.use("*", requireAuth);

workbenchRoutes.post("/analyze", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const body = await c.req.json();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sourceLanguage =
    typeof body.source_language === "string" ? body.source_language.trim() : "";
  const targetLanguage =
    typeof body.target_language === "string" ? body.target_language.trim() : "en";
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!text) return c.json({ error: "text is required" }, 400);
  if (!sourceLanguage) return c.json({ error: "source_language is required" }, 400);
  if (text.length > 12000) return c.json({ error: "text is too long for workbench analysis" }, 413);

  const requestDocument = documentFromRequest(body.document);
  const sourceDocument = await preferredCorpusDocument(
    db,
    userId,
    requestDocument,
    text,
    sourceLanguage,
  );
  const result = await analyzeWorkbenchDocument({
    text,
    sourceLanguage,
    targetLanguage,
    title,
    document: sourceDocument ?? undefined,
  });
  await persistCorpusDocument(db, userId, result.document);
  return c.json(result);
});

workbenchRoutes.post("/interactions", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const body = await c.req.json();
  const document = body.document as FiloDocumentJson | undefined;
  const language = typeof body.language === "string" ? body.language.trim() : "";
  const eventType = body.event_type === "heard" ? "heard" : "encounter";
  const source = body.source === "workbench_audio" ? "workbench_audio" : "workbench_definition";

  if (!document || typeof document.text !== "string" || !Array.isArray(document.tiers)) {
    return c.json({ error: "document is required" }, 400);
  }
  if (!language) return c.json({ error: "language is required" }, 400);
  if (source === "workbench_audio" && eventType !== "heard") {
    return c.json({ error: "workbench_audio requires heard event_type" }, 400);
  }

  const range = normalizeRange(body.range, document.byteLength);
  const context = textOf(document, range);
  const recorded = await recordWorkbenchRangeInteractions(db, userId, document, language, range, {
    eventType,
    source,
    context,
  });
  return c.json({ ok: true, recorded });
});

workbenchRoutes.post("/audio", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const language = typeof body.language === "string" ? body.language.trim() : undefined;

  if (!text) return c.json({ error: "text is required" }, 400);
  if (text.length > 1000) return c.json({ error: "text is too long for audio" }, 413);

  const provider = getAudioProvider();
  if (!provider.isAvailable()) {
    return c.json({ error: "Audio provider not configured" }, 503);
  }

  try {
    const assetDb = adminDb();
    const cached = await findAudioAssetForRequest(assetDb, {
      provider: provider.name,
      language: language ?? null,
      text,
    }).catch(() => null);
    if (cached) return audioAssetResponse(cached);

    const result = await provider.synthesize(text, { language, userId });
    const asset = await storeAudioAsset(assetDb, {
      provider: provider.name,
      language: language ?? null,
      text,
      audio: result.audio,
      contentType: result.contentType,
    });
    return audioAssetResponse(asset);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[Workbench] audio synthesize failed:", detail);
    return c.json({ error: detail }, 502);
  }
});

function audioAssetResponse(asset: CachedAudioAsset): Response {
  const audioBody = new ArrayBuffer(asset.audio.byteLength);
  new Uint8Array(audioBody).set(asset.audio);
  return new Response(audioBody, {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(asset.audio.byteLength),
      "X-Langouste-Audio-Id": asset.audioId,
    },
  });
}

function documentFromRequest(value: unknown): FiloDocumentJson | null {
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

async function preferredCorpusDocument(
  db: Database,
  userId: string,
  requestDocument: FiloDocumentJson | null,
  text: string,
  sourceLanguage: string,
): Promise<FiloDocumentJson | null> {
  if (requestDocument) {
    const message = await messageForDocument(db, userId, requestDocument);
    if (message?.filo_doc?.text === text) return message.filo_doc;
    if (requestDocument.text === text) return requestDocument;
  }
  return findCorpusDocumentByText(db, userId, text, sourceLanguage);
}

async function persistCorpusDocument(
  db: Database,
  userId: string,
  document: FiloDocumentJson,
): Promise<void> {
  const message = await messageForDocument(db, userId, document);
  if (!message || message.filo_doc === document) return;
  await adminDb().update("messages", { filo_doc: document }, [
    { op: "eq", column: "message_id", value: message.message_id },
  ]);
}

async function messageForDocument(db: Database, userId: string, document: FiloDocumentJson) {
  const messageId = messageIdForDocument(document);
  if (!messageId) return null;
  const message = await getMessageById(db, messageId);
  if (!message) return null;
  const member = await getMember(db, message.conversation_id, userId);
  return member ? message : null;
}

async function findCorpusDocumentByText(
  db: Database,
  userId: string,
  text: string,
  sourceLanguage: string,
): Promise<FiloDocumentJson | null> {
  const seen = new Set<string>();
  for (const column of ["healed_text", "raw_text"]) {
    const messages = await db.select<{
      message_id: string;
      conversation_id: string;
      filo_doc?: FiloDocumentJson | null;
    }>("messages", {
      columns: "message_id, conversation_id, filo_doc",
      filters: [
        { op: "eq", column, value: text },
        { op: "eq", column: "language", value: sourceLanguage },
      ],
      order: [{ column: "created_at", ascending: false }],
      limit: 5,
    });
    for (const message of messages) {
      if (seen.has(message.message_id)) continue;
      seen.add(message.message_id);
      if (message.filo_doc?.text !== text) continue;
      const member = await getMember(db, message.conversation_id, userId);
      if (member) return message.filo_doc;
    }
  }
  return null;
}

function messageIdForDocument(document: FiloDocumentJson): string {
  const metadataMessageId = document.metadata.messageId;
  if (typeof metadataMessageId === "string" && metadataMessageId.trim()) {
    return metadataMessageId.trim();
  }
  const match = /^message:(.+)$/u.exec(document.id);
  return match?.[1]?.trim() ?? "";
}

async function recordWorkbenchRangeInteractions(
  db: Database,
  userId: string,
  document: FiloDocumentJson,
  language: string,
  range: { start: number; end: number },
  options: {
    eventType: "encounter" | "heard";
    source: "workbench_definition" | "workbench_audio";
    context: string;
  },
): Promise<number> {
  let recorded = 0;
  const seenKeys = new Set<string>();
  const dictionaryTier = document.tiers.find((tier) => tier.id === "dictionary");
  for (const annotation of withinRange(dictionaryTier, range)) {
    const payload = annotation.payload as Record<string, unknown>;
    if (payload.notFound === true) continue;
    const surface = stringValue(payload.surface) || textOf(document, annotation);
    const lookupKey =
      stringValue(payload.lemma) || stringValue(payload.sourceTerm) || surface.trim();
    if (!lookupKey) continue;
    const key = `vocabulary:${lookupKey}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    await recordInteraction(db, {
      userId,
      language: language as LanguageCode,
      itemType: "vocabulary",
      lookupKey,
      seed: {
        translation: firstString(payload.definitions),
        context_sentence: options.context,
      },
      eventType: options.eventType,
      source: options.source,
    });
    recorded += 1;
  }

  for (const tier of document.tiers.filter(isGrammarTier)) {
    for (const annotation of withinRange(tier, range)) {
      const payload = annotation.payload as Record<string, unknown>;
      const category =
        stringValue(payload.category) ||
        stringValue(payload.conceptId) ||
        stringValue(payload.concept_id) ||
        stringValue(payload.label);
      if (!category) continue;
      const key = `grammar:${category}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      await recordInteraction(db, {
        userId,
        language: language as LanguageCode,
        itemType: "grammar",
        lookupKey: category,
        seed: {
          description: stringValue(payload.description) || stringValue(payload.label),
          concept_id: stringValue(payload.conceptId) || stringValue(payload.concept_id),
        },
        eventType: options.eventType,
        source: options.source,
      });
      recorded += 1;
    }
  }

  return recorded;
}

function withinRange(
  tier: FiloTierJson | undefined,
  range: { start: number; end: number },
): Array<FiloAnnotation<unknown>> {
  return (tier?.annotations ?? []).filter(
    (annotation) => range.start <= annotation.start && annotation.end <= range.end,
  ) as Array<FiloAnnotation<unknown>>;
}

function isGrammarTier(tier: FiloTierJson): boolean {
  return (
    tier.kind === "grammar" ||
    tier.id === "grammar" ||
    tier.id.includes("grammar") ||
    tier.id.includes("concept")
  );
}

function normalizeRange(value: unknown, byteLength: number): { start: number; end: number } {
  const candidate = value as { start?: unknown; end?: unknown } | null;
  const start = Number(candidate?.start ?? 0);
  const end = Number(candidate?.end ?? byteLength);
  const safeStart = clampByte(Number.isFinite(start) ? start : 0, byteLength);
  const safeEnd = clampByte(Number.isFinite(end) ? end : byteLength, byteLength);
  return safeStart <= safeEnd
    ? { start: safeStart, end: safeEnd }
    : { start: safeEnd, end: safeStart };
}

function clampByte(value: number, byteLength: number): number {
  return Math.max(0, Math.min(byteLength, Math.trunc(value)));
}

function textOf(document: FiloDocumentJson, range: { start: number; end: number }): string {
  const start = stringIndexForByteOffset(document.text, range.start);
  const end = stringIndexForByteOffset(document.text, range.end);
  return document.text.slice(start, end);
}

function stringIndexForByteOffset(value: string, byteOffset: number): number {
  const encoder = new TextEncoder();
  const target = Math.max(0, Math.min(byteOffset, encoder.encode(value).length));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const bytes = encoder.encode(value.slice(0, mid)).length;
    if (bytes < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}
