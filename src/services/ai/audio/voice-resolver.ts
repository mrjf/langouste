/**
 * Per-language voice resolution for TTS.
 *
 * A VoiceResolver maps a language (and, optionally, a user) to a concrete
 * VoiceProfile: which ElevenLabs voice + model to use, and whether to send
 * an explicit `language_code`.
 *
 * Today the only implementation is env-backed (EnvVoiceResolver, fed by
 * ELEVENLABS_VOICES). The interface deliberately takes an optional
 * `userId` so a future DB-backed resolver can return per-user voice
 * preferences without any change to the provider or the route — they just
 * pass `opts.userId` through.
 */

export interface VoiceProfile {
  /** ElevenLabs voice ID to synthesize with. */
  voiceId: string;
  /** ElevenLabs model ID, e.g. "eleven_turbo_v2_5". */
  model: string;
  /**
   * ISO 639-1 code to send as `language_code`, or null to omit it.
   * Only v2.5 models (turbo/flash) accept `language_code`; sending it to
   * eleven_multilingual_v2 errors. We only set this for models that
   * support it.
   */
  languageCode: string | null;
}

export interface VoiceResolveOptions {
  /**
   * Caller-supplied explicit voice override (highest precedence). Wired
   * through from AudioSynthesisOptions.voice.
   */
  voiceOverride?: string;
  /**
   * Reserved for the future per-user resolver. Unused by EnvVoiceResolver
   * today — present so the signature is stable when a DB-backed resolver
   * lands.
   */
  userId?: string;
}

export interface VoiceResolver {
  /** Resolve the voice profile for a language (+ optional user/override). */
  resolve(language: string, opts?: VoiceResolveOptions): Promise<VoiceProfile>;
}

/** Shape of a single entry in the ELEVENLABS_VOICES JSON map. */
export interface VoiceMapEntry {
  voiceId: string;
  /** Optional per-language model override (defaults to the resolver default). */
  model?: string;
  /**
   * Optional explicit ISO 639-1 language code to enforce. Defaults to the
   * map key (the language) when the model supports language_code; set to
   * an empty string to force-omit it.
   */
  languageCode?: string;
}

export type VoiceMap = Record<string, VoiceMapEntry>;

// Models that accept the `language_code` request field. Hungarian,
// Vietnamese and Norwegian only exist on the v2.5 models, and only v2.5
// accepts language_code — eleven_multilingual_v2 errors if you send it.
const LANGUAGE_CODE_MODELS = new Set(["eleven_turbo_v2_5", "eleven_flash_v2_5"]);

// Default model for any language without an explicit `model`. Turbo v2.5
// covers all 32 supported languages incl. Hungarian and is low-latency.
const DEFAULT_MODEL = "eleven_turbo_v2_5";

// "Sarah" — a `premade` voice that works on free + paid plans and is
// flagged multilingual. Last-resort default when no per-language or
// global "default" entry is configured. Override per language via
// ELEVENLABS_VOICES for materially better non-English output.
const FALLBACK_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

/**
 * Parse the ELEVENLABS_VOICES JSON string into a VoiceMap. Invalid JSON or
 * malformed entries throw at first resolve() rather than silently
 * mis-synthesizing — surfaced loudly so misconfig is caught.
 */
export function parseVoiceMap(raw: string): VoiceMap {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`ELEVENLABS_VOICES is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ELEVENLABS_VOICES must be a JSON object keyed by language code");
  }
  const map: VoiceMap = {};
  for (const [lang, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`ELEVENLABS_VOICES["${lang}"] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.voiceId !== "string" || !e.voiceId.trim()) {
      throw new Error(`ELEVENLABS_VOICES["${lang}"].voiceId must be a non-empty string`);
    }
    map[lang] = {
      voiceId: e.voiceId,
      model: typeof e.model === "string" && e.model.trim() ? e.model : undefined,
      languageCode: typeof e.languageCode === "string" ? e.languageCode : undefined,
    };
  }
  return map;
}

/**
 * Env-backed resolver. Precedence for a given language:
 *   1. opts.voiceOverride (explicit caller override) — model = default
 *   2. ELEVENLABS_VOICES[language]
 *   3. ELEVENLABS_VOICES["default"]
 *   4. built-in fallback voice
 *
 * The model is the entry's `model` or DEFAULT_MODEL. `language_code` is
 * sent only when the resolved model supports it; the value is the entry's
 * explicit `languageCode` if provided, otherwise the requested language.
 * An entry can set `languageCode: ""` to force-omit it.
 */
export class EnvVoiceResolver implements VoiceResolver {
  constructor(private readonly map: VoiceMap) {}

  // async to satisfy the VoiceResolver contract; the future DB-backed
  // resolver will actually await a query.
  async resolve(language: string, opts: VoiceResolveOptions = {}): Promise<VoiceProfile> {
    const entry = this.map[language] ?? this.map.default;

    const voiceId = opts.voiceOverride?.trim() || entry?.voiceId || FALLBACK_VOICE_ID;
    const model = entry?.model ?? DEFAULT_MODEL;

    let languageCode: string | null = null;
    if (LANGUAGE_CODE_MODELS.has(model)) {
      // Explicit "" means "omit"; undefined means "default to the language".
      if (entry?.languageCode === "") {
        languageCode = null;
      } else {
        languageCode = entry?.languageCode || language || null;
      }
    }

    return { voiceId, model, languageCode };
  }
}
