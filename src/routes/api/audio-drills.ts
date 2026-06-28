import { Hono } from "hono";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { requireAuth } from "../middleware.ts";
import type { Database } from "../../lib/db/index.ts";
import type { FiloDocumentJson } from "filo";

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

  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
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
    if (!(await hasFile(join(dir, "lesson.filo.json")))) {
      return c.json({ error: "drill not found" }, 404);
    }
    const body = await c.req.json();
    const lesson = body?.lesson as FiloDocumentJson | undefined;
    if (!isFiloDocument(lesson)) return c.json({ error: "lesson document is required" }, 400);
    if (lesson.metadata?.corpus !== "audio-drill-tape") {
      return c.json({ error: "lesson document is not an audio drill" }, 400);
    }
    await writeFile(join(dir, "lesson.filo.json"), `${JSON.stringify(lesson, null, 2)}\n`);
    return c.json({ ok: true, drill: await audioDrillListItem(root, id), lesson });
  });

  routes.get("/:id/audio", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
    const audioFileName = await finalAudioFileName(dir);
    if (!audioFileName) return c.json({ error: "audio not found" }, 404);
    return audioFileResponse(join(dir, audioFileName));
  });

  routes.get("/:id/source-audio", async (c) => {
    const id = c.req.param("id");
    const dir = drillDir(root, id);
    if (!dir) return c.json({ error: "invalid drill id" }, 400);
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
    const path = join(dir, "clips", `${audioId}.mp3`);
    if (!(await hasFile(path))) return c.json({ error: "clip not found" }, 404);
    return audioFileResponse(path);
  });

  return routes;
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
