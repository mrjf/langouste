import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FiloDocumentJson } from "filo";

const originalEnv = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  testMode: process.env.LANGOUSTE_TEST_MODE,
  testStorage: process.env.LANGOUSTE_TEST_STORAGE,
  jwtSecret: process.env.LANGOUSTE_JWT_SECRET,
  dataDir: process.env.LANGOUSTE_DATA_DIR,
};

let rootDir = "";

beforeEach(async () => {
  process.env.ANTHROPIC_API_KEY ||= "test-key";
  process.env.LANGOUSTE_TEST_MODE = "true";
  process.env.LANGOUSTE_TEST_STORAGE = "memory";
  process.env.LANGOUSTE_JWT_SECRET = "test-secret";
  rootDir = await mkdtemp(join(tmpdir(), "langouste-audio-drills-"));
  process.env.LANGOUSTE_DATA_DIR = join(rootDir, "db");
});

afterEach(async () => {
  restoreEnv("ANTHROPIC_API_KEY", originalEnv.anthropicApiKey);
  restoreEnv("LANGOUSTE_TEST_MODE", originalEnv.testMode);
  restoreEnv("LANGOUSTE_TEST_STORAGE", originalEnv.testStorage);
  restoreEnv("LANGOUSTE_JWT_SECRET", originalEnv.jwtSecret);
  restoreEnv("LANGOUSTE_DATA_DIR", originalEnv.dataDir);
  await rm(rootDir, { recursive: true, force: true });
});

describe("audio drill routes", () => {
  test("persists drill documents and every audio asset in the storage contract", async () => {
    const { drillRoot, lessonPath, audioId } = await writeFixture();
    const drillDir = join(drillRoot, "unit-01");
    const lesson = JSON.parse(await readFile(lessonPath, "utf8")) as FiloDocumentJson;
    const source = JSON.parse(
      await readFile(join(drillDir, "source.filo.json"), "utf8"),
    ) as FiloDocumentJson;
    const { createMemoryDatabaseSet } = await import("../../src/lib/db/memory.ts");
    const {
      findStoredAudioDrillAsset,
      findStoredAudioDrillClip,
      getStoredAudioDrill,
      persistAudioDrillDirectory,
    } = await import("../../src/services/corpus/audio-drills.ts");
    const { searchCorpus } = await import("../../src/services/corpus/store.ts");
    const set = createMemoryDatabaseSet();

    await persistAudioDrillDirectory(set.admin, "user-a", "unit-01", drillDir, lesson, source);

    expect(await getStoredAudioDrill(set.admin, "user-a", "unit-01")).toMatchObject({
      title: "Unit 01",
      clip_audio_ids: [audioId],
    });
    expect(
      (await findStoredAudioDrillAsset(set.admin, "user-a", "unit-01", "final"))?.byteLength,
    ).toBe(4);
    expect(
      (await findStoredAudioDrillClip(set.admin, "user-a", "unit-01", audioId))?.byteLength,
    ).toBe(3);
    expect(
      await searchCorpus(set.admin, "jó", {
        ownerId: "user-a",
        sourceType: "audio_drill",
      }),
    ).toHaveLength(2);
  });

  test("lists drill documents and serves generated audio clips from a configured root", async () => {
    const { drillRoot, audioId } = await writeFixture();
    const routes = await fixtureRoutes(drillRoot);

    const listResponse = await routes.request("http://local/");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { drills: Array<Record<string, unknown>> };
    expect(list.drills).toHaveLength(1);
    expect(list.drills[0]).toMatchObject({
      id: "unit-01",
      title: "Unit 01",
      sourceLanguage: "hu",
      bridgeLanguage: "en",
      segmentCount: 1,
      generatedAudioCount: 1,
    });

    const detailResponse = await routes.request("http://local/unit-01");
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      audioUrl: string | null;
      lesson: FiloDocumentJson;
      source: FiloDocumentJson;
    };
    expect(detail.audioUrl).toBe("/api/audio-drills/unit-01/audio");
    expect(detail.lesson.metadata.title).toBe("Unit 01");
    expect(detail.source.metadata.title).toBe("Unit 01 Source");

    const finalAudioResponse = await routes.request("http://local/unit-01/audio");
    expect(finalAudioResponse.status).toBe(200);
    expect(finalAudioResponse.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await finalAudioResponse.arrayBuffer()).toHaveProperty("byteLength", 4);

    const clipResponse = await routes.request(`http://local/unit-01/clips/${audioId}`);
    expect(clipResponse.status).toBe(200);
    expect(clipResponse.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await clipResponse.arrayBuffer()).toHaveProperty("byteLength", 3);
  });

  test("saves edited lesson timing back to the drill document", async () => {
    const { drillRoot, lessonPath } = await writeFixture();
    const routes = await fixtureRoutes(drillRoot);
    const detailResponse = await routes.request("http://local/unit-01");
    const detail = (await detailResponse.json()) as { lesson: FiloDocumentJson };
    const edited = structuredClone(detail.lesson);
    const segment = edited.tiers.find((tier) => tier.id === "lesson.segment")?.annotations[0];
    if (!segment) throw new Error("fixture segment missing");
    segment.payload.sourceStartMs = 90;
    segment.payload.sourceEndMs = 310;

    const saveResponse = await routes.request("http://local/unit-01/lesson", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson: edited }),
    });

    expect(saveResponse.status).toBe(200);
    const saved = JSON.parse(await readFile(lessonPath, "utf8")) as FiloDocumentJson;
    const savedSegment = saved.tiers.find((tier) => tier.id === "lesson.segment")?.annotations[0];
    expect(savedSegment?.payload.sourceStartMs).toBe(90);
    expect(savedSegment?.payload.sourceEndMs).toBe(310);
  });

  test("rejects malformed ids and returns not found for missing drills", async () => {
    const { drillRoot } = await writeFixture();
    const routes = await fixtureRoutes(drillRoot);

    expect((await routes.request("http://local/%25bad")).status).toBe(400);
    expect((await routes.request("http://local/missing-drill")).status).toBe(404);
    expect((await routes.request("http://local/unit-01/clips/nope")).status).toBe(400);
    expect((await routes.request(`http://local/unit-01/clips/aud_${"b".repeat(64)}`)).status).toBe(
      404,
    );
  });

  test("streams topic build log errors as ndjson", async () => {
    const { drillRoot } = await writeFixture();
    const routes = await fixtureRoutes(drillRoot);

    const response = await routes.request("http://local/topic/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ renderAudio: false }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const lines = (await response.text()).trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0]).toMatchObject({
      type: "log",
      step: "request",
    });
    expect(events.at(-1)).toMatchObject({
      type: "error",
      step: "error",
      message: "topic or at least one source URL is required",
    });
  });
});

async function fixtureRoutes(root: string) {
  const { createAudioDrillRoutes } = await import("../../src/routes/api/audio-drills.ts");
  return createAudioDrillRoutes({ rootDir: root, requireAuthentication: false });
}

async function writeFixture(): Promise<{
  drillRoot: string;
  lessonPath: string;
  audioId: string;
}> {
  const drillRoot = join(rootDir, "drills");
  const drillDir = join(drillRoot, "unit-01");
  const clipsDir = join(drillDir, "clips");
  await mkdir(clipsDir, { recursive: true });
  const audioId = `aud_${"a".repeat(64)}`;
  const lesson = filoDocument("lesson:unit-01", "jó", {
    corpus: "audio-drill-tape",
    title: "Unit 01",
    sourceLanguage: "hu",
    bridgeLanguage: "en",
  });
  lesson.tiers.push(
    {
      id: "lesson.segment",
      kind: "custom",
      annotations: [
        {
          id: "segment-annotation-1",
          start: 0,
          end: lesson.byteLength,
          source: "test",
          payload: {
            segmentId: "segment-1",
            order: 0,
            type: "word",
            language: "hu",
            audioSource: "source",
            sourceStartMs: 100,
            sourceEndMs: 300,
          },
        },
      ],
    },
    {
      id: "audio:generated",
      kind: "audio",
      annotations: [
        {
          id: "audio-generated-1",
          start: 0,
          end: lesson.byteLength,
          source: "test",
          payload: {
            segmentId: "segment-1",
            order: 0,
            language: "hu",
            audioSource: "source",
            audioId,
            provider: "source-clip",
            clipStartMs: 80,
            clipEndMs: 320,
          },
        },
      ],
    },
    {
      id: "audio:source",
      kind: "audio",
      annotations: [],
    },
  );
  const source = filoDocument("source:unit-01", "jó", {
    corpus: "source-transcript",
    title: "Unit 01 Source",
    sourceLanguage: "hu",
  });
  source.tiers.push({
    id: "word",
    kind: "token",
    annotations: [
      {
        id: "word-1",
        start: 0,
        end: source.byteLength,
        source: "test",
        payload: { surface: "jó", language: "hu", startMs: 100, endMs: 300 },
      },
    ],
  });

  const lessonPath = join(drillDir, "lesson.filo.json");
  await writeFile(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`);
  await writeFile(join(drillDir, "source.filo.json"), `${JSON.stringify(source, null, 2)}\n`);
  await writeFile(join(drillDir, "unit.audio-drill.mp3"), new Uint8Array([1, 2, 3, 4]));
  await writeFile(join(drillDir, "unit-source.mp3"), new Uint8Array([4, 3, 2, 1]));
  await writeFile(join(clipsDir, `${audioId}.mp3`), new Uint8Array([8, 9, 10]));
  return { drillRoot, lessonPath, audioId };
}

function filoDocument(
  id: string,
  text: string,
  metadata: Record<string, unknown>,
): FiloDocumentJson {
  return {
    id,
    text,
    byteLength: new TextEncoder().encode(text).length,
    metadata,
    tiers: [],
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
