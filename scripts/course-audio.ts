import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import { loadCourseCatalog } from "../src/services/course/catalog.ts";
import {
  inventoryAudio,
  generationKey,
  generateCourseAudio,
  type AudioProfile,
} from "../src/services/ai/course-audio.ts";
const args = Bun.argv.slice(2);
const mode = args[0] ?? "inventory";
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i < 0 ? undefined : args[i + 1];
};
const root = "data/course-audio";
await mkdir(root, { recursive: true });
const items = inventoryAudio(await loadCourseCatalog());
async function atomic(path: string, value: unknown) {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, path);
}
const totals = Object.fromEntries(
  ["hu", "ar-EG"].map((lang) => {
    const list = items.filter((i) => i.language === lang);
    return [
      lang,
      { uniqueRecordings: list.length, characters: list.reduce((n, i) => n + i.characters, 0) },
    ];
  }),
);
await atomic(`${root}/inventory.json`, { schemaVersion: 1, totals, items });
console.log(JSON.stringify(totals));
if (mode === "inventory") process.exit(0);
if (mode === "preflight") {
  const { config } = await import("../src/lib/config.ts");
  if (!config.elevenLabsApiKey) throw Error("ELEVENLABS_API_KEY is not configured");
  async function get(path: string) {
    const r = await fetch(`https://api.elevenlabs.io/v1/${path}`, {
      headers: { "xi-api-key": config.elevenLabsApiKey },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { detail?: { status?: unknown } } | null;
      const status = body?.detail?.status;
      const safeCode =
        typeof status === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(status) ? status : "unspecified";
      throw Error(`Read-only ElevenLabs preflight HTTP ${r.status} (${safeCode})`);
    }
    return r.json();
  }
  const subscription = (await get("user/subscription")) as Record<string, unknown>;
  const models = (await get("models")) as {
    model_id: string;
    can_do_text_to_speech: boolean;
    languages: { language_id: string }[];
    model_rates?: unknown;
  }[];
  const voices = (await get("voices")) as {
    voices: { voice_id: string; name: string; labels: Record<string, string>; category: string }[];
  };
  const report = {
    checkedAt: new Date().toISOString(),
    subscription: Object.fromEntries(
      [
        "tier",
        "status",
        "character_count",
        "character_limit",
        "next_character_count_reset_unix",
        "currency",
        "current_overage",
        "max_credit_limit_extension",
      ].map((k) => [k, subscription[k]]),
    ),
    models: models
      .filter(
        (m) =>
          m.can_do_text_to_speech && m.languages.some((l) => ["ar", "hu"].includes(l.language_id)),
      )
      .map((m) => ({
        id: m.model_id,
        languages: m.languages.filter((l) => ["ar", "hu"].includes(l.language_id)),
        rates: m.model_rates,
      })),
    voices: voices.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      labels: v.labels,
      category: v.category,
    })),
    note: "No synthesis requested. Model language support does not verify a voice's Egyptian accent. Review samples and publication license before generation/publication.",
  };
  await atomic(`${root}/preflight.json`, report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

let manifest: Record<string, { url: string; generationId: string; sha256: string }> = {};
try {
  manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw Error("Cannot read existing audio state; repair it before continuing");
}
if (mode === "validate") {
  const missing = items.filter((i) => !manifest[i.id]);
  for (const entry of Object.values(manifest)) {
    const file = await Bun.file(`${root}/${entry.generationId}.mp3`).arrayBuffer();
    if (new Bun.CryptoHasher("sha256").update(file).digest("hex") !== entry.sha256)
      throw Error("Audio checksum mismatch");
  }
  console.log({ missing: missing.length, ready: Object.keys(manifest).length });
  process.exit(missing.length ? 1 : 0);
}
const file = opt("--profiles");
if (!file)
  throw Error("Supply reviewed --profiles JSON with voice/model/settings and credit multiplier");
const profiles = JSON.parse(await readFile(file, "utf8")) as Record<string, AudioProfile>;
let selected = items.filter((i) => !opt("--language") || i.language === opt("--language"));
if (opt("--ids")) {
  const ids = new Set(opt("--ids")!.split(","));
  selected = selected.filter((i) => ids.has(i.id));
  if (selected.length !== ids.size) throw Error("Unknown sample IDs");
}
for (const item of selected) {
  const p = profiles[item.language];
  if (
    !p?.voiceId ||
    !p.model ||
    !(p.creditsPerCharacter > 0) ||
    !p.voiceSettings ||
    (p.model === "eleven_v4" &&
      Object.keys(p.voiceSettings).some((k) => !["stability", "similarity_boost"].includes(k))) ||
    (item.language === "ar-EG" && !p.dialectVerified) ||
    (item.language === "hu" && p.model === "eleven_multilingual_v2")
  )
    throw Error("Reviewed Hungarian/Egyptian voice and compatible model/settings required");
}
selected = selected.filter(
  (i) => manifest[i.id]?.generationId !== generationKey(i, profiles[i.language]),
);
const estimate = selected.reduce(
  (n, i) => n + i.characters * profiles[i.language].creditsPerCharacter,
  0,
);
console.log({
  pendingRecordings: selected.length,
  estimatedCredits: estimate,
  note: "Dollar cost depends on your plan; slower playback reuses each recording.",
});
if (mode === "estimate") process.exit(0);
if (mode !== "generate" || !args.includes("--execute-billable"))
  throw Error("Generation requires generate --execute-billable and --max-credits");
if (!opt("--ids") && selected.some((i) => !profiles[i.language].sampleApproved))
  throw Error("Approve small voice samples before bulk generation (sampleApproved in profiles)");
const budget = Number(opt("--max-credits"));
if (!Number.isFinite(budget) || budget <= 0 || estimate > budget)
  throw Error("Credit budget missing or exceeded");
const lock = await open(`${root}/generation.lock`, "wx");
try {
  const { config } = await import("../src/lib/config.ts");
  if (!config.elevenLabsApiKey) throw Error("ELEVENLABS_API_KEY is not configured");
  if (args.includes("--reviewed-metadata")) {
    for (const item of selected) {
      const review = profiles[item.language].reviewedMetadata;
      if (
        !review?.pricingConfirmed ||
        !review.source.startsWith("https://elevenlabs.io/") ||
        !review.modelLanguages.includes(item.language === "ar-EG" ? "ar" : "hu")
      )
        throw Error(
          "Provide reviewed official model-language and pricing metadata before bypassing metadata reads",
        );
    }
    console.log(
      "Using explicitly reviewed metadata; subscription/model reads skipped. The approved cumulative credit ceiling still applies.",
    );
  } else {
    const modelsResponse = await fetch("https://api.elevenlabs.io/v1/models", {
      headers: { "xi-api-key": config.elevenLabsApiKey },
    });
    if (!modelsResponse.ok) throw Error("Cannot verify model language support");
    const models = (await modelsResponse.json()) as {
      model_id: string;
      languages: { language_id: string }[];
    }[];
    for (const i of selected)
      if (
        !models.some(
          (m) =>
            m.model_id === profiles[i.language].model &&
            m.languages.some((l) => l.language_id === (i.language === "ar-EG" ? "ar" : "hu")),
        )
      )
        throw Error("Selected model does not declare required language support");
  }
  let ledger: Record<string, { status: string; credits: number }> = {};
  try {
    ledger = JSON.parse(await readFile(`${root}/ledger.json`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw Error("Cannot read existing audio state; repair it before continuing");
  }
  let spent = Object.values(ledger).reduce((n, e) => n + e.credits, 0);
  for (const i of selected) {
    const p = profiles[i.language];
    const id = generationKey(i, p);
    if (ledger[id] && !args.includes("--retry-uncertain"))
      throw Error(
        "Prior request exists without matching manifest; reconcile it before retrying to prevent duplicate billing",
      );
    const credits = i.characters * p.creditsPerCharacter;
    if (spent + credits > budget) throw Error("Cumulative credit ceiling reached");
    spent += credits;
    ledger[id] = { status: "reserved", credits: (ledger[id]?.credits ?? 0) + credits };
    await atomic(`${root}/ledger.json`, ledger);
    await atomic(`${root}/${id}.inputs.json`, {
      schemaVersion: 1,
      provider: "elevenlabs",
      item: i,
      profile: p,
      outputFormat: "mp3_44100_128",
      createdAt: new Date().toISOString(),
    });
    try {
      const bytes = await generateCourseAudio(i, p, config.elevenLabsApiKey);
      await writeFile(`${root}/${id}.mp3.tmp`, bytes);
      await rename(`${root}/${id}.mp3.tmp`, `${root}/${id}.mp3`);
      manifest[i.id] = {
        url: `/audio/${id}.mp3`,
        generationId: id,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      };
      await atomic(`${root}/manifest.json`, manifest);
      ledger[id].status = "complete";
      await atomic(`${root}/ledger.json`, ledger);
    } catch (error) {
      ledger[id].status = "uncertain";
      await atomic(`${root}/ledger.json`, ledger);
      throw error;
    }
    await Bun.sleep(1000);
  }
} finally {
  await lock.close();
  await (await import("node:fs/promises")).unlink(`${root}/generation.lock`);
}
