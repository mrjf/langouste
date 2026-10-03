import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import type { FiloDocumentJson } from "filo";
import { config } from "../../lib/config.ts";
import type { Database } from "../../lib/db/index.ts";
import {
  AnthropicLayerGenerator,
  StubLayerGenerator,
  type LayerGenerator,
} from "../../services/ai/news-layers.ts";
import { JsonFileCache } from "../../services/news/cache.ts";
import { createReadingDocument } from "../../services/news/reading.ts";
import { createSourceAdapters } from "../../services/news/sources/index.ts";
import {
  findOwnedCorpusDocument,
  listOwnedReadingDocuments,
  type CorpusDocumentRow,
} from "../../services/corpus/store.ts";
import {
  recordReadingProfileInteraction,
  saveReadingEdition,
} from "../../services/reading/profile.ts";
import type {
  CefrLevel,
  NewsSourceId,
  ReadingDocumentMetadata,
  ReadingInteractionEvent,
  ReadingInteractionRequest,
  ReadingJobResponse,
  ReadingJobStatus,
  ReadingRequest,
  ReadingResponse,
  ReadyReadingSummary,
  ReadyReadingsResponse,
  SourceAdapter,
  SourceListingResponse,
} from "../../types/news.ts";
import { NEWS_LANGUAGE_OPTIONS } from "../../types/news.ts";
import { requireAuth } from "../middleware.ts";

type NewsRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

interface CachedReading {
  document: ReadingResponse["document"];
  request: ReadingRequest;
}

interface RuntimeReadingJob {
  id: string;
  ownerId: string;
  status: ReadingJobStatus;
  startedAt: string;
  updatedAt: string;
  response?: ReadingResponse;
  error?: string;
}

export interface NewsRouteOptions {
  adapters?: Record<NewsSourceId, SourceAdapter>;
  cache?: JsonFileCache;
  generator?: LayerGenerator;
  maxSentences?: number;
}

const SOURCE_IDS = new Set<NewsSourceId>(["hacker-news", "nytimes", "sfchronicle"]);
const LEVELS = new Set<CefrLevel>(["A1", "A2", "B1", "B2", "C1"]);
const INTERACTION_EVENTS = new Set<ReadingInteractionEvent>([
  "article_opened",
  "sentence_hovered",
  "sentence_inspected",
  "word_hovered",
  "vocabulary_inspected",
  "audio_played",
  "workbench_opened",
]);

export function createNewsRoutes(options: NewsRouteOptions = {}): Hono<NewsRouteBindings> {
  const routes = new Hono<NewsRouteBindings>();
  const adapters = options.adapters ?? createSourceAdapters();
  const cache = options.cache ?? new JsonFileCache(config.newsCacheDir);
  const generator = options.generator ?? generatorForConfig();
  const maxSentences = options.maxSentences ?? config.newsMaxSentences;
  const inFlightDocuments = new Map<
    string,
    Promise<{ document: ReadingResponse["document"]; cacheHit: boolean }>
  >();
  const inFlightResponses = new Map<string, Promise<ReadingResponse>>();
  const readingJobs = new Map<string, RuntimeReadingJob>();

  routes.use("*", requireAuth);

  async function loadOrCreateDocument(
    request: ReadingRequest,
    artifactKey: string,
  ): Promise<{ document: ReadingResponse["document"]; cacheHit: boolean }> {
    const existing = inFlightDocuments.get(artifactKey);
    if (existing) return existing;

    const operation = (async () => {
      const cached = await cache.getStored<CachedReading>(artifactKey);
      if (cached && isCachedReading(cached)) {
        return { document: cached.document, cacheHit: true };
      }
      const article = await adapters[request.source].scrape(request.input);
      const document = await createReadingDocument(article, request, { generator, maxSentences });
      await cache.set(artifactKey, { document, request } satisfies CachedReading);
      return { document, cacheHit: false };
    })();

    inFlightDocuments.set(artifactKey, operation);
    void operation
      .finally(() => {
        if (inFlightDocuments.get(artifactKey) === operation) inFlightDocuments.delete(artifactKey);
      })
      .catch(() => {});
    return operation;
  }

  async function resolveReading(
    db: Database,
    userId: string,
    request: ReadingRequest,
    artifactKey: string,
  ): Promise<ReadingResponse> {
    const responseKey = `${userId}:${artifactKey}`;
    const existing = inFlightResponses.get(responseKey);
    if (existing) return existing;

    const operation = (async () => {
      const { document, cacheHit } = await loadOrCreateDocument(request, artifactKey);
      const persistence = await saveReadingEdition(db, userId, document, {
        surface: "langouste-news",
        sourceId: document.id,
        sourceUrl: document.metadata.sourceUrl,
        title: document.metadata.title,
      });
      return { document, cacheHit, persistence };
    })();

    inFlightResponses.set(responseKey, operation);
    void operation
      .finally(() => {
        if (inFlightResponses.get(responseKey) === operation) inFlightResponses.delete(responseKey);
      })
      .catch(() => {});
    return operation;
  }

  function startJob(
    db: Database,
    userId: string,
    request: ReadingRequest,
    artifactKey: string,
  ): RuntimeReadingJob {
    const id = jobId(userId, artifactKey);
    const existing = readingJobs.get(id);
    if (existing?.status === "building" || existing?.status === "ready") return existing;

    const now = new Date().toISOString();
    const job: RuntimeReadingJob = {
      id,
      ownerId: userId,
      status: "building",
      startedAt: now,
      updatedAt: now,
    };
    readingJobs.set(id, job);
    void resolveReading(db, userId, request, artifactKey).then(
      (response) => {
        job.status = "ready";
        job.response = response;
        job.error = undefined;
        job.updatedAt = new Date().toISOString();
      },
      (error: unknown) => {
        job.status = "error";
        job.error = error instanceof Error ? error.message : String(error);
        job.updatedAt = new Date().toISOString();
      },
    );
    return job;
  }

  routes.get("/config", (c) =>
    c.json({
      languages: NEWS_LANGUAGE_OPTIONS,
      levels: [...LEVELS],
      maxLanguages: 8,
      model: generator.model,
    }),
  );

  routes.get("/sources/:source", async (c) => {
    try {
      const source = parseSource(c.req.param("source"));
      const rawLimit = Number(c.req.query("limit") ?? 20);
      const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 40) : 20;
      const items = await adapters[source].list(limit);
      return c.json({ source, items } satisfies SourceListingResponse);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.get("/ready-readings", async (c) => {
    const rows = await listOwnedReadingDocuments(c.get("db"), c.get("userId"), 200);
    const items = rows
      .flatMap((row) => {
        const summary = readySummary(row);
        return summary ? [summary] : [];
      })
      .sort((left, right) => right.storedAt.localeCompare(left.storedAt));
    return c.json({ items } satisfies ReadyReadingsResponse);
  });

  routes.get("/ready-readings/:key", async (c) => {
    const key = c.req.param("key");
    if (!/^reading_[a-f0-9]{64}$/u.test(key)) {
      return c.json({ error: "Invalid news edition id" }, 400);
    }
    const row = await findOwnedCorpusDocument(c.get("db"), c.get("userId"), key, "reading");
    if (!row || !readingMetadata(row.filo_doc)) {
      return c.json({ error: "News edition not found" }, 404);
    }
    return c.json({
      document: publicReadingDocument(row.filo_doc),
      cacheHit: true,
      persistence: { documentId: row.document_id, storedAt: row.updated_at },
    } satisfies ReadingResponse);
  });

  routes.post("/readings", async (c) => {
    try {
      const request = parseReadingRequest(await c.req.json());
      const artifactKey = cache.keyFor({ version: 4, request, model: generator.model });
      return c.json(await resolveReading(c.get("db"), c.get("userId"), request, artifactKey));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/reading-jobs", async (c) => {
    try {
      const request = parseReadingRequest(await c.req.json());
      const artifactKey = cache.keyFor({ version: 4, request, model: generator.model });
      const id = jobId(c.get("userId"), artifactKey);
      const existing = readingJobs.get(id);
      const job = startJob(c.get("db"), c.get("userId"), request, artifactKey);
      return c.json(jobResponse(job), existing ? 200 : 202);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.get("/reading-jobs/:id", (c) => {
    const id = c.req.param("id");
    if (!/^[a-f0-9]{64}$/u.test(id)) return c.json({ error: "Invalid reading job id" }, 400);
    const job = readingJobs.get(id);
    if (!job || job.ownerId !== c.get("userId")) {
      return c.json({ error: "Reading job not found" }, 404);
    }
    return c.json(jobResponse(job));
  });

  routes.post("/interactions", async (c) => {
    try {
      const input = parseReadingInteraction(await c.req.json());
      return c.json(await recordReadingProfileInteraction(c.get("db"), c.get("userId"), input));
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return routes;
}

export const newsRoutes = createNewsRoutes();

function generatorForConfig(): LayerGenerator {
  return config.stubAi
    ? new StubLayerGenerator()
    : new AnthropicLayerGenerator(config.anthropicApiKey, config.newsModel);
}

function jobId(userId: string, artifactKey: string): string {
  return createHash("sha256").update(`v1\0${userId}\0${artifactKey}`).digest("hex");
}

function jobResponse(job: RuntimeReadingJob): ReadingJobResponse {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    ...(job.response ? { response: job.response } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function isCachedReading(value: unknown): value is CachedReading {
  return (
    isRecord(value) &&
    isRecord(value.document) &&
    typeof value.document.id === "string" &&
    Array.isArray(value.document.tiers) &&
    readingMetadata(value.document as unknown as FiloDocumentJson) !== null &&
    isReadingRequest(value.request)
  );
}

function readySummary(row: CorpusDocumentRow): ReadyReadingSummary | null {
  const document = row.filo_doc;
  const metadata = readingMetadata(document);
  if (!metadata) return null;
  const request = requestFromDocument(document, metadata);
  const sentenceTier = document.tiers.find((tier) => tier.id === "sentence");
  const sourceDocumentId = stringValue(document.metadata.sourceDocumentId) || document.id;
  return {
    key: row.document_id,
    articleId: sourceDocumentId,
    source: metadata.source,
    input: request.input,
    title: metadata.title,
    sourceUrl: metadata.sourceUrl,
    ...(metadata.discussionUrl ? { discussionUrl: metadata.discussionUrl } : {}),
    languages: [...metadata.languages],
    level: metadata.level,
    model: metadata.model,
    sentenceCount: sentenceTier?.annotations.length ?? 0,
    generatedAt: metadata.generatedAt,
    storedAt: row.updated_at,
  };
}

function readingMetadata(document: FiloDocumentJson): ReadingDocumentMetadata | null {
  const metadata = document.metadata;
  if (!isRecord(metadata) || !SOURCE_IDS.has(metadata.source as NewsSourceId)) return null;
  if (typeof metadata.sourceUrl !== "string" || typeof metadata.title !== "string") return null;
  if (
    !Array.isArray(metadata.languages) ||
    !metadata.languages.every((item) => typeof item === "string")
  )
    return null;
  if (!LEVELS.has(metadata.level as CefrLevel)) return null;
  if (typeof metadata.model !== "string" || typeof metadata.generatedAt !== "string") return null;
  const isNewsCorpus =
    metadata.corpus === "langouste-news" || metadata.corpus === "rgt-polyglot-news";
  const isNewsSurface =
    metadata.profileSurface === "langouste-news" || metadata.profileSurface === "rgt-newsroom";
  return isNewsCorpus || isNewsSurface ? (metadata as ReadingDocumentMetadata) : null;
}

function requestFromDocument(
  document: FiloDocumentJson,
  metadata: ReadingDocumentMetadata,
): ReadingRequest {
  const storedInput = stringValue(metadata.readingInput);
  const sourceDocumentId = stringValue(document.metadata.sourceDocumentId) || document.id;
  const input =
    storedInput ||
    (metadata.source === "hacker-news"
      ? hackerNewsInput(sourceDocumentId, metadata.discussionUrl)
      : metadata.sourceUrl);
  return {
    source: metadata.source,
    input,
    languages: [...metadata.languages],
    level: metadata.level,
  };
}

function hackerNewsInput(documentId: string, discussionUrl?: string): string {
  if (discussionUrl) {
    try {
      const itemId = new URL(discussionUrl).searchParams.get("id")?.trim();
      if (itemId) return itemId;
    } catch {
      // Fall through to the source document identity.
    }
  }
  return documentId.startsWith("hacker-news:")
    ? documentId.slice("hacker-news:".length)
    : documentId;
}

function publicReadingDocument(document: FiloDocumentJson): ReadingResponse["document"] {
  const copy = structuredClone(document) as ReadingResponse["document"];
  if (copy.metadata.corpus === "rgt-polyglot-news") copy.metadata.corpus = "langouste-news";
  if (copy.metadata.profileSurface === "rgt-newsroom") {
    copy.metadata.profileSurface = "langouste-news";
  }
  for (const tier of copy.tiers) {
    if (tier.source?.startsWith("rgt.news.")) {
      tier.source = tier.source.replace(/^rgt\.news\./u, "langouste.news.");
    }
    if (tier.sourceInfo?.label === "RGT multilingual news adaptation") {
      tier.sourceInfo.label = "Langouste multilingual news adaptation";
    }
    if (tier.sourceInfo?.id?.startsWith("rgt-news:")) {
      tier.sourceInfo.id = tier.sourceInfo.id.replace(/^rgt-news:/u, "langouste-news:");
    }
    for (const annotation of tier.annotations) {
      if (annotation.source?.startsWith("rgt.news.")) {
        annotation.source = annotation.source.replace(/^rgt\.news\./u, "langouste.news.");
      }
      if (annotation.sourceInfo?.label === "RGT multilingual news adaptation") {
        annotation.sourceInfo.label = "Langouste multilingual news adaptation";
      }
      if (annotation.sourceInfo?.id?.startsWith("rgt-news:")) {
        annotation.sourceInfo.id = annotation.sourceInfo.id.replace(
          /^rgt-news:/u,
          "langouste-news:",
        );
      }
    }
  }
  return copy;
}

function parseReadingRequest(value: unknown): ReadingRequest {
  if (!isRecord(value)) throw new Error("A JSON reading request is required");
  const source = parseSource(value.source);
  const input = typeof value.input === "string" ? value.input.trim() : "";
  if (!input || input.length > 2_000)
    throw new Error("A valid story id or article URL is required");
  const level =
    typeof value.level === "string" && LEVELS.has(value.level as CefrLevel)
      ? (value.level as CefrLevel)
      : "B1";
  const supported = new Set(NEWS_LANGUAGE_OPTIONS.map((language) => language.code));
  const languages = Array.isArray(value.languages)
    ? [
        ...new Set(
          value.languages.filter((language): language is string => typeof language === "string"),
        ),
      ]
        .map((language) => language.trim())
        .filter((language) => supported.has(language))
    : [];
  if (!languages.length || languages.length > 8) {
    throw new Error("Choose between one and eight supported languages");
  }
  return { source, input, languages, level };
}

function isReadingRequest(value: unknown): value is ReadingRequest {
  if (!isRecord(value) || !Array.isArray(value.languages)) return false;
  const languages = value.languages;
  try {
    const parsed = parseReadingRequest(value);
    return (
      parsed.source === value.source &&
      parsed.input === value.input &&
      parsed.level === value.level &&
      parsed.languages.length === languages.length &&
      parsed.languages.every((language, index) => language === languages[index])
    );
  } catch {
    return false;
  }
}

function parseReadingInteraction(value: unknown): ReadingInteractionRequest {
  if (!isRecord(value)) throw new Error("A JSON reading interaction is required");
  const documentId = typeof value.documentId === "string" ? value.documentId.trim() : "";
  const eventType =
    typeof value.eventType === "string" &&
    INTERACTION_EVENTS.has(value.eventType as ReadingInteractionEvent)
      ? (value.eventType as ReadingInteractionEvent)
      : null;
  if (!documentId || documentId.length > 160) throw new Error("A valid documentId is required");
  if (!eventType) throw new Error("A valid reading interaction type is required");
  const language = optionalShortString(value.language, "language", 32);
  const sentenceOrdinal = optionalOrdinal(value.sentenceOrdinal, "sentenceOrdinal");
  const tokenOrdinal = optionalOrdinal(value.tokenOrdinal, "tokenOrdinal");
  const vocabularyOrdinal = optionalOrdinal(value.vocabularyOrdinal, "vocabularyOrdinal");
  return {
    documentId,
    eventType,
    ...(language ? { language } : {}),
    ...(sentenceOrdinal !== undefined ? { sentenceOrdinal } : {}),
    ...(tokenOrdinal !== undefined ? { tokenOrdinal } : {}),
    ...(vocabularyOrdinal !== undefined ? { vocabularyOrdinal } : {}),
  };
}

function parseSource(value: unknown): NewsSourceId {
  if (typeof value === "string" && SOURCE_IDS.has(value as NewsSourceId)) {
    return value as NewsSourceId;
  }
  throw new Error("Unknown news source");
}

function errorResponse(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const configurationError =
    message.includes("ANTHROPIC_API_KEY") || message.includes("TURBOPUFFER_API_KEY");
  console.error("[news]", message);
  return c.json({ error: message }, configurationError ? 503 : 400);
}

function optionalShortString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function optionalOrdinal(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 100_000) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
