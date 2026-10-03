import { Hono, type Context } from "hono";
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { requireAuth } from "../middleware.ts";
import type { Database } from "../../lib/db/index.ts";
import type { FiloDocumentJson } from "filo";
import { buildTopicAudioLesson } from "../../services/audio-drill-tape/index.ts";
import { getDueGrammarGaps } from "../../services/database/grammar-gaps.ts";
import { getProfile } from "../../services/database/profiles.ts";
import { getDueVocabulary } from "../../services/database/vocabulary.ts";
import type { CefrLevel, LearningLanguage } from "../../types/index.ts";
import {
  audioDrillListItem as storedAudioDrillListItem,
  findStoredAudioDrillAsset,
  findStoredAudioDrillClip,
  getStoredAudioDrill,
  listStoredAudioDrills,
  persistAudioDrillDirectory,
  updateStoredAudioDrillLesson,
} from "../../services/corpus/audio-drills.ts";
import type { CachedAudioAsset } from "../../services/corpus/audio-assets.ts";

type AudioDrillsRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

interface AudioDrillListItem {
  id: string;
  title: string;
  sourceLanguage: string | null;
  bridgeLanguage: string | null;
  segmentCount: number;
  generatedAudioCount: number;
  sourceAudioCount: number;
  lessonUpdatedAt: string | null;
  audioFileName: string | null;
  audioByteLength: number | null;
  audioUpdatedAt: string | null;
}

interface CreateTopicAudioDrillRequest {
  topic?: unknown;
  sourceText?: unknown;
  sourceUrl?: unknown;
  sourceUrls?: unknown;
  sourceLanguage?: unknown;
  targetLanguage?: unknown;
  baseLanguage?: unknown;
  cefrLevel?: unknown;
  title?: unknown;
  maxSentences?: unknown;
  desiredRuntimeMinutes?: unknown;
  generationModel?: unknown;
  pauseMs?: unknown;
  extraInformation?: unknown;
  renderAudio?: unknown;
}

interface BuildLogEvent {
  type?: "log" | "complete" | "error";
  step: string;
  message: string;
  data?: unknown;
}

type BuildLogEmitter = (event: BuildLogEvent) => void | Promise<void>;

interface CreateTopicAudioDrillResponse {
  ok: true;
  id: string;
  drill: AudioDrillListItem;
  lesson: FiloDocumentJson;
  source: FiloDocumentJson;
  audioUrl: string | null;
}

export interface AudioDrillRouteOptions {
  rootDir?: string;
  requireAuthentication?: boolean;
}

export function createAudioDrillRoutes(
  options: AudioDrillRouteOptions = {},
): Hono<AudioDrillsRouteBindings> {
  const routes = new Hono<AudioDrillsRouteBindings>();
  const root = resolve(options.rootDir ?? defaultAudioDrillRoot());

  if (options.requireAuthentication ?? true) routes.use("*", requireAuth);

  routes.get("/", async (c) => {
    const durable = durableContext(c);
    if (durable) {
      return c.json({ drills: await listStoredAudioDrills(durable.db, durable.ownerId) });
    }
    const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
    const items: AudioDrillListItem[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const id = dir.name;
      if (!safeDrillId(id)) continue;
      const item = await audioDrillListItem(root, id).catch(() => null);
      if (item) items.push(item);
    }
    items.sort((left, right) =>
      (right.lessonUpdatedAt ?? "").localeCompare(left.lessonUpdatedAt ?? ""),
    );
    return c.json({ drills: items });
  });

  routes.post("/topic", async (c) => {
    const body = (await c.req.json().catch(() => null)) as CreateTopicAudioDrillRequest | null;
    try {
      const response = await createTopicAudioDrill(c, root, body);
      return c.json(response);
    } catch (err) {
      const status: 400 | 404 | 500 = err instanceof RouteError ? err.status : 500;
      return c.json({ error: errorMessage(err) }, status);
    }
  });

  routes.post("/topic/stream", async (c) => {
    const body = (await c.req.json().catch(() => null)) as CreateTopicAudioDrillRequest | null;
    const encoder = new TextEncoder();
    let aborted = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      async start(controller) {
        const emit: BuildLogEmitter = async (event) => {
          if (aborted) return;
          const line = `${stringifyStreamEvent(event)}\n`;
          try {
            controller.enqueue(encoder.encode(line));
          } catch {
            aborted = true;
          }
        };
        heartbeat = setInterval(() => {
          void emit({
            step: "heartbeat",
            message: "Topic audio drill generation is still running.",
          });
        }, 10_000);

        try {
          const response = await createTopicAudioDrill(c, root, body, emit);
          await emit({
            type: "complete",
            step: "complete",
            message: "Topic audio drill is ready.",
            data: {
              id: response.id,
              audioUrl: response.audioUrl,
              drill: response.drill,
            },
          });
        } catch (err) {
          await emit({
            type: "error",
            step: "error",
            message: errorMessage(err),
            data: { status: err instanceof RouteError ? err.status : 500 },
          });
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          if (!aborted) {
            try {
              controller.close();
            } catch {
              aborted = true;
            }
          }
        }
      },
      cancel() {
        aborted = true;
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  });

  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
    const durable = durableContext(c);
    if (durable) {
      const record = await getStoredAudioDrill(durable.db, durable.ownerId, id);
      if (!record) return c.json({ error: "drill not found" }, 404);
      return c.json({
        drill: storedAudioDrillListItem(record),
        lesson: record.lesson,
        source: record.source,
        audioUrl: record.final_audio_id
          ? `/api/audio-drills/${encodeURIComponent(id)}/audio`
          : null,
      });
    }
    if (!(await hasFile(join(dir, "lesson.filo.json")))) {
      return c.json({ error: "drill not found" }, 404);
    }
    const lesson = await readJsonFile<FiloDocumentJson>(join(dir, "lesson.filo.json"));
    const source = await readJsonFile<FiloDocumentJson>(join(dir, "source.filo.json")).catch(
      () => null,
    );
    const audioFileName = await finalAudioFileName(dir);
    return c.json({
      drill: await audioDrillListItem(root, id),
      lesson,
      source,
      audioUrl: audioFileName ? `/api/audio-drills/${encodeURIComponent(id)}/audio` : null,
    });
  });

  routes.put("/:id/lesson", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
    const body = await c.req.json();
    const lesson = body?.lesson as FiloDocumentJson | undefined;
    if (!isFiloDocument(lesson)) return c.json({ error: "lesson document is required" }, 400);
    if (lesson.metadata?.corpus !== "audio-drill-tape") {
      return c.json({ error: "lesson document is not an audio drill" }, 400);
    }
    const durable = durableContext(c);
    if (durable) {
      const updated = await updateStoredAudioDrillLesson(durable.db, durable.ownerId, id, lesson);
      if (!updated) return c.json({ error: "drill not found" }, 404);
      return c.json({ ok: true, drill: storedAudioDrillListItem(updated), lesson });
    }
    if (!(await hasFile(join(dir, "lesson.filo.json")))) {
      return c.json({ error: "drill not found" }, 404);
    }
    await writeFile(join(dir, "lesson.filo.json"), `${JSON.stringify(lesson, null, 2)}\n`);
    return c.json({ ok: true, drill: await audioDrillListItem(root, id), lesson });
  });

  routes.get("/:id/audio", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
    const durable = durableContext(c);
    if (durable) {
      const asset = await findStoredAudioDrillAsset(durable.db, durable.ownerId, id, "final");
      return asset ? storedAudioResponse(asset) : c.json({ error: "audio not found" }, 404);
    }
    const audioFileName = await finalAudioFileName(dir);
    if (!audioFileName) return c.json({ error: "audio not found" }, 404);
    return audioFileResponse(join(dir, audioFileName));
  });

  routes.get("/:id/source-audio", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
    const durable = durableContext(c);
    if (durable) {
      const asset = await findStoredAudioDrillAsset(durable.db, durable.ownerId, id, "source");
      return asset ? storedAudioResponse(asset) : c.json({ error: "source audio not found" }, 404);
    }
    const sourceFileName = await sourceAudioFileName(dir);
    if (!sourceFileName) return c.json({ error: "source audio not found" }, 404);
    return audioFileResponse(join(dir, sourceFileName));
  });

  routes.get("/:id/clips/:audioId", async (c) => {
    const id = c.req.param("id");
    const audioId = c.req.param("audioId");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
    if (!/^aud_[a-f0-9]{64}$/u.test(audioId)) {
      return c.json({ error: "invalid audio id" }, 400);
    }
    const durable = durableContext(c);
    if (durable) {
      const asset = await findStoredAudioDrillClip(durable.db, durable.ownerId, id, audioId);
      return asset ? storedAudioResponse(asset) : c.json({ error: "clip not found" }, 404);
    }
    const path = join(dir, "clips", `${audioId}.mp3`);
    if (!(await hasFile(path))) return c.json({ error: "clip not found" }, 404);
    return audioFileResponse(path);
  });

  return routes;
}

async function createTopicAudioDrill(
  c: Context<AudioDrillsRouteBindings>,
  root: string,
  body: CreateTopicAudioDrillRequest | null,
  emit?: BuildLogEmitter,
): Promise<CreateTopicAudioDrillResponse> {
  await emit?.({
    step: "request",
    message: "Received topic audio drill request.",
    data: { body: sanitizedRequestBody(body) },
  });

  const topic = stringBody(body?.topic);
  const sourceText = stringBody(body?.sourceText);
  const sourceUrls = sourceUrlsBody(body);
  if (!topic && !sourceText && sourceUrls.length === 0) {
    throw new RouteError("topic or at least one source URL is required", 400);
  }

  const db = c.get("db");
  const userId = c.get("userId");
  const profile = await getProfile(db, userId);
  if (!profile) throw new RouteError("Profile not found", 404);
  await emit?.({
    step: "profile",
    message: "Loaded learner profile.",
    data: {
      baseLanguage: profile.base_language,
      learningLanguages: profile.learning_languages,
    },
  });

  const requestedTargetLanguage = stringBody(body?.targetLanguage);
  const learning = learningLanguageFor(profile.learning_languages, requestedTargetLanguage);
  if (!learning && !requestedTargetLanguage) {
    throw new RouteError("targetLanguage is required when the profile has no languages", 400);
  }

  const targetLanguage = learning?.lang ?? requestedTargetLanguage;
  const baseLanguage = stringBody(body?.baseLanguage) || profile.base_language;
  const cefrLevel = cefrBody(body?.cefrLevel) ?? learning?.cefr_level ?? "A1";
  const maxSentences = numberBody(body?.maxSentences, 1, 20) ?? undefined;
  const desiredRuntimeMinutes = numberBody(body?.desiredRuntimeMinutes, 1, 60) ?? undefined;
  const generationModel = modelBody(body?.generationModel);
  const pauseMs = numberBody(body?.pauseMs, 0, 10_000) ?? undefined;
  const extraInformation = stringBody(body?.extraInformation);
  await emit?.({
    step: "profile",
    message: "Resolved learner settings.",
    data: {
      targetLanguage,
      baseLanguage,
      cefrLevel,
      profileMatchedLanguage: !!learning,
      desiredRuntimeMinutes,
      generationModel: generationModel || null,
      renderAudio: body?.renderAudio !== false,
    },
  });

  const [dueVocabulary, dueGrammar] = await Promise.all([
    getDueVocabulary(db, userId, targetLanguage, 30).catch(() => []),
    getDueGrammarGaps(db, userId, targetLanguage, 20).catch(() => []),
  ]);
  await emit?.({
    step: "learner-context",
    message: "Loaded learner context for prompt adaptation.",
    data: {
      dueVocabularyCount: dueVocabulary.length,
      dueGrammarCount: dueGrammar.length,
      dueVocabularyPreview: dueVocabulary.slice(0, 10).map((item) => ({
        term: item.term,
        translation: item.translation,
        cefrLevel: item.cefr_level,
      })),
      dueGrammarPreview: dueGrammar.slice(0, 10).map((gap) => ({
        category: gap.category,
        description: gap.description,
      })),
    },
  });

  const id = uniqueTopicDrillId(topic, targetLanguage);
  const dir = drillDir(root, id);
  if (!dir) throw new RouteError("invalid generated drill id", 500);
  await mkdir(dir, { recursive: true });
  await emit?.({
    step: "filesystem",
    message: "Created drill directory.",
    data: { id, dir },
  });

  const result = await buildTopicAudioLesson({
    ...(topic ? { topic } : {}),
    ...(sourceText ? { sourceText } : {}),
    ...(sourceUrls.length > 0 ? { sourceUrls } : {}),
    sourceLanguage: stringBody(body?.sourceLanguage) || baseLanguage,
    title: stringBody(body?.title) || topic || "Topic audio lesson",
    outputDir: dir,
    renderAudio: body?.renderAudio !== false,
    ...(maxSentences !== undefined ? { maxSentences } : {}),
    ...(desiredRuntimeMinutes !== undefined ? { desiredRuntimeMinutes } : {}),
    ...(generationModel ? { generationModel } : {}),
    ...(pauseMs !== undefined ? { pauseMs } : {}),
    ...(extraInformation ? { extraInformation } : {}),
    learner: {
      userId,
      targetLanguage,
      baseLanguage,
      cefrLevel,
      knownVocabulary: dueVocabulary.map((item) => `${item.term} = ${item.translation}`),
      grammarGaps: dueGrammar.map((gap) => `${gap.category}: ${gap.description}`),
    },
    logger: emit
      ? (entry) =>
          emit({
            step: entry.step,
            message: entry.message,
            data: entry.data,
          })
      : undefined,
  });
  await emit?.({
    step: "storage",
    message: "Writing the completed drill corpus and audio assets to turbopuffer.",
  });
  const stored = await persistAudioDrillDirectory(
    db,
    userId,
    id,
    dir,
    result.lesson,
    result.source,
  );

  const response: CreateTopicAudioDrillResponse = {
    ok: true,
    id,
    drill: storedAudioDrillListItem(stored),
    lesson: result.lesson,
    source: result.source,
    audioUrl: stored.final_audio_id ? `/api/audio-drills/${encodeURIComponent(id)}/audio` : null,
  };
  await emit?.({
    step: "response",
    message: "Prepared topic audio drill response.",
    data: {
      id: response.id,
      title: response.drill.title,
      audioUrl: response.audioUrl,
      segmentCount: response.drill.segmentCount,
      generatedAudioCount: response.drill.generatedAudioCount,
    },
  });
  return response;
}

export const audioDrillRoutes = createAudioDrillRoutes();

async function audioDrillListItem(root: string, id: string): Promise<AudioDrillListItem> {
  const dir = drillDir(root, id);
  if (!dir) throw new Error("invalid drill id");
  const lessonPath = join(dir, "lesson.filo.json");
  const lesson = await readJsonFile<FiloDocumentJson>(lessonPath);
  const lessonStat = await stat(lessonPath).catch(() => null);
  const audioFileName = await finalAudioFileName(dir);
  const audioStat = audioFileName ? await stat(join(dir, audioFileName)).catch(() => null) : null;
  return {
    id,
    title: stringValue(lesson.metadata.title) || id,
    sourceLanguage: stringValue(lesson.metadata.sourceLanguage),
    bridgeLanguage: stringValue(lesson.metadata.bridgeLanguage),
    segmentCount: tierCount(lesson, "lesson.segment"),
    generatedAudioCount: tierCount(lesson, "audio:generated"),
    sourceAudioCount: tierCount(lesson, "audio:source"),
    lessonUpdatedAt: lessonStat?.mtime.toISOString() ?? null,
    audioFileName,
    audioByteLength: audioStat?.size ?? null,
    audioUpdatedAt: audioStat?.mtime.toISOString() ?? null,
  };
}

async function audioFileResponse(path: string): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return new Response(JSON.stringify({ error: "audio not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(file, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(file.size),
    },
  });
}

function storedAudioResponse(asset: CachedAudioAsset): Response {
  const body = new ArrayBuffer(asset.audio.byteLength);
  new Uint8Array(body).set(asset.audio);
  return new Response(body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(asset.byteLength),
      "X-Langouste-Audio-Id": asset.audioId,
    },
  });
}

function durableContext(
  c: Context<AudioDrillsRouteBindings>,
): { db: Database; ownerId: string } | null {
  const db = c.get("db");
  const ownerId = c.get("userId");
  return db && ownerId ? { db, ownerId } : null;
}

async function finalAudioFileName(dir: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => []);
  return files.find((file) => file.endsWith(".audio-drill.mp3")) ?? null;
}

async function sourceAudioFileName(dir: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => []);
  return files.find((file) => file.endsWith(".mp3") && !file.endsWith(".audio-drill.mp3")) ?? null;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

async function hasFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function defaultAudioDrillRoot(): string {
  return resolve(process.cwd(), "data/audio-drills");
}

function drillDir(root: string, id: string): string | null {
  if (!safeDrillId(id)) return null;
  const dir = resolve(root, id);
  return dir.startsWith(`${root}/`) ? dir : null;
}

function safeDrillId(id: string): boolean {
  return /^[a-zA-Z0-9._-]+$/u.test(id) && basename(id) === id;
}

function isFiloDocument(value: unknown): value is FiloDocumentJson {
  const document = value as FiloDocumentJson | null | undefined;
  return (
    !!document &&
    typeof document.id === "string" &&
    typeof document.text === "string" &&
    typeof document.byteLength === "number" &&
    !!document.metadata &&
    typeof document.metadata === "object" &&
    Array.isArray(document.tiers)
  );
}

function tierCount(document: FiloDocumentJson, tierId: string): number {
  return document.tiers.find((tier) => tier.id === tierId)?.annotations.length ?? 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringBody(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberBody(value: unknown, min: number, max: number): number | null {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function modelBody(value: unknown): string {
  const model = stringBody(value);
  return /^[a-zA-Z0-9._:/-]+$/u.test(model) ? model : "";
}

function sourceUrlsBody(body: CreateTopicAudioDrillRequest | null): string[] {
  const raw = body?.sourceUrls;
  const values = [
    ...(Array.isArray(raw) ? raw : []),
    ...(typeof raw === "string" ? raw.split(/[\s,]+/u) : []),
    body?.sourceUrl,
  ];
  return [
    ...new Set(
      values
        .map((value) => stringBody(value))
        .filter((value) => value.startsWith("http://") || value.startsWith("https://")),
    ),
  ];
}

function cefrBody(value: unknown): CefrLevel | null {
  const raw = stringBody(value).toUpperCase();
  return ["A1", "A2", "B1", "B2", "C1", "C2"].includes(raw) ? (raw as CefrLevel) : null;
}

function learningLanguageFor(
  languages: LearningLanguage[],
  requested: string,
): LearningLanguage | null {
  if (requested) return languages.find((language) => language.lang === requested) ?? null;
  return languages[0] ?? null;
}

function uniqueTopicDrillId(topic: string, targetLanguage: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const slug = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hash = createHash("sha1")
    .update(`${topic}\0${targetLanguage}\0${stamp}\0${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `topic-${targetLanguage}-${slug || "lesson"}-${stamp}-${hash}`;
}

function sanitizedRequestBody(body: CreateTopicAudioDrillRequest | null): Record<string, unknown> {
  return {
    topic: stringBody(body?.topic) || null,
    sourceUrls: sourceUrlsBody(body),
    sourceTextCharacters: stringBody(body?.sourceText).length,
    sourceLanguage: stringBody(body?.sourceLanguage) || null,
    targetLanguage: stringBody(body?.targetLanguage) || null,
    baseLanguage: stringBody(body?.baseLanguage) || null,
    cefrLevel: stringBody(body?.cefrLevel) || null,
    desiredRuntimeMinutes: numberBody(body?.desiredRuntimeMinutes, 1, 60),
    generationModel: modelBody(body?.generationModel) || null,
    pauseMs: numberBody(body?.pauseMs, 0, 10_000),
    extraInformation: stringBody(body?.extraInformation) || null,
    renderAudio: body?.renderAudio !== false,
  };
}

function buildStreamEvent(event: BuildLogEvent): Record<string, unknown> {
  return {
    type: event.type ?? "log",
    at: new Date().toISOString(),
    step: event.step,
    message: event.message,
    data: event.data ?? null,
  };
}

function stringifyStreamEvent(event: BuildLogEvent): string {
  try {
    return JSON.stringify(buildStreamEvent(event));
  } catch (err) {
    return JSON.stringify(
      buildStreamEvent({
        type: "error",
        step: "log",
        message: "Failed to serialize build log event.",
        data: { error: errorMessage(err) },
      }),
    );
  }
}

class RouteError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 500,
  ) {
    super(message);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to create topic audio drill";
}
