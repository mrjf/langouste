function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const testMode = process.env.LANGOUSTE_TEST_MODE === "true";
const requestedTestStorage = process.env.LANGOUSTE_TEST_STORAGE?.trim().toLowerCase();
if (requestedTestStorage && requestedTestStorage !== "memory") {
  throw new Error(`LANGOUSTE_TEST_STORAGE must be 'memory', got: ${requestedTestStorage}`);
}
if (requestedTestStorage === "memory" && !testMode) {
  throw new Error("LANGOUSTE_TEST_STORAGE=memory is only allowed with LANGOUSTE_TEST_MODE=true");
}
const testStorage = requestedTestStorage === "memory" ? "memory" : null;
const turbopufferNamespacePrefix = process.env.TURBOPUFFER_NAMESPACE_PREFIX?.trim() || "langouste";
if (
  !/^[A-Za-z0-9-_.]+$/u.test(turbopufferNamespacePrefix) ||
  turbopufferNamespacePrefix.length > 96
) {
  throw new Error(
    "TURBOPUFFER_NAMESPACE_PREFIX must match [A-Za-z0-9-_.]+ and be at most 96 characters",
  );
}

const agentLanguageStrategy = (process.env.LANGOUSTE_AGENT_LANGUAGE_STRATEGY ?? "target-first") as
  | "target-first"
  | "english-mediated";
if (agentLanguageStrategy !== "target-first" && agentLanguageStrategy !== "english-mediated") {
  throw new Error(
    `LANGOUSTE_AGENT_LANGUAGE_STRATEGY must be 'target-first' or 'english-mediated', got: ${agentLanguageStrategy}`,
  );
}

export const config = {
  // turbopuffer is the sole durable storage and search engine. The hosted
  // service commits successful writes directly to object storage; Langouste
  // does not need its own S3 bucket for inline rows and Filo documents.
  turbopufferApiKey: testStorage ? "" : required("TURBOPUFFER_API_KEY"),
  turbopufferRegion: process.env.TURBOPUFFER_REGION ?? "aws-us-west-2",
  turbopufferNamespacePrefix,
  turbopufferBaseUrl: process.env.TURBOPUFFER_BASE_URL ?? "",
  testStorage,

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  translationProvider: process.env.TRANSLATION_PROVIDER ?? "claude",
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ?? "",
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
  agentLanguageStrategy,

  // Spell-check provider: "noop" (default), "languagetool", or "nspell".
  // See src/services/spellcheck/. Compared case-sensitively — keep it lowercase.
  spellcheckProvider: process.env.SPELLCHECK_PROVIDER ?? "noop",
  languagetoolUrl: process.env.LANGUAGETOOL_URL ?? "https://api.languagetool.org/v2",

  // Verbose OpenClaw gateway frame logging (dev only).
  openclawDebug: process.env.LANGOUSTE_OPENCLAW_DEBUG === "1",

  // Text-to-speech provider. "none" (default) disables audio playback.
  // "elevenlabs" requires ELEVENLABS_API_KEY.
  audioProvider: (process.env.AUDIO_PROVIDER ?? "none").toLowerCase(),
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  // Legacy single global voice. Still honored as the "default" entry when
  // ELEVENLABS_VOICES has no explicit "default" key (back-compat).
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
  // Per-language voice/model map as a JSON object keyed by language code:
  //   {"hu":{"voiceId":"...","model":"eleven_turbo_v2_5"},
  //    "default":{"voiceId":"..."}}
  // Parsed + validated by the voice resolver. See docs/MODES.md / README.
  elevenLabsVoices: process.env.ELEVENLABS_VOICES ?? "",

  // Authentication is application-owned; turbopuffer does not provide row
  // level auth. Routes validate these JWTs before applying ownership filters.
  jwtSecret: required("LANGOUSTE_JWT_SECRET"),

  // Single-user mode skips signup/login and auto-issues a local session.
  // Override explicitly via LANGOUSTE_SINGLE_USER=true|false.
  singleUser: (() => {
    const raw = process.env.LANGOUSTE_SINGLE_USER?.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    return true;
  })(),

  // Test mode: enables /api/test/* routes and the `stub` agent type. Safe to
  // leave on for both stub-only and real-integration test runs.
  // Must NOT be set in production.
  testMode,

  // Stub AI: intercept error-explainer / vocabulary-extractor / translator
  // calls with canned responses. On by default whenever testMode is on (so
  // stub-only tests don't need to set it explicitly). Set to false when
  // running real-integration tests so the services hit real APIs.
  stubAi: (() => {
    const raw = process.env.LANGOUSTE_STUB_AI?.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    return process.env.LANGOUSTE_TEST_MODE === "true";
  })(),

  // Integrated multilingual news reader. Generated editions are cached as
  // immutable Filo documents, then saved into each authenticated profile.
  newsModel: process.env.LANGOUSTE_NEWS_MODEL?.trim() || "claude-sonnet-4-6",
  newsCacheDir: process.env.LANGOUSTE_NEWS_CACHE_DIR?.trim() || "./data/news-cache",
  newsMaxSentences: (() => {
    const value = Number(process.env.LANGOUSTE_NEWS_MAX_SENTENCES);
    return Number.isInteger(value) && value >= 3 && value <= 24 ? value : 14;
  })(),

  port: parseInt(process.env.PORT ?? "8000", 10),
};
