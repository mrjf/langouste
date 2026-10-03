import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { languageStats } from "../../services/profile/stats.ts";
import { ALL_DIMENSIONS, type Dimension } from "../../services/profile/dimensions.ts";
import { grammarDimensionForCategory } from "../../services/profile/grammar-ontology.ts";
import { getItemReference } from "../../services/references/item-reference.ts";
import { lookupDictionary } from "../../services/references/dictionary.ts";
import { translateTexts } from "../../services/ai/translator.ts";
import { getAudioProvider } from "../../services/ai/audio/index.ts";
import {
  findAudioAssetForRequest,
  storeAudioAsset,
  type CachedAudioAsset,
} from "../../services/corpus/audio-assets.ts";
import { recordInteraction } from "../../services/spaced-repetition/interactions.ts";
import {
  getExerciseProgressForTarget,
  getExerciseProgressLookup,
} from "../../services/profile/exercise-progress.ts";
import {
  canonicalizeVocabularyRow,
  normalizeVocabularyTerm,
} from "../../services/spaced-repetition/vocabulary-normalizer.ts";
import type { Database } from "../../lib/db/index.ts";
import { adminDb } from "../../lib/db/index.ts";
import type { LanguageCode } from "../../types/index.ts";
import { listReadingInteractions } from "../../services/database/reading-interactions.ts";

type ProfileStatsRouteBindings = {
  Variables: {
    db: Database;
    userId: string;
  };
};

export const profileStatsRoutes = new Hono<ProfileStatsRouteBindings>();

profileStatsRoutes.use("*", requireAuth);

// Languages the profile can display, derived from configured learning
// languages plus any persisted chat/SRS data for the user.
profileStatsRoutes.get("/languages", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const langs = new Map<
    string,
    {
      lang: string;
      cefr_level: string | null;
      messages: number;
      vocabulary: number;
      grammar: number;
      reading_interactions: number;
    }
  >();

  const ensure = (lang: unknown, cefrLevel: unknown = null) => {
    if (typeof lang !== "string" || !lang.trim()) return null;
    const code = lang.trim();
    const existing = langs.get(code);
    if (existing) {
      if (!existing.cefr_level && typeof cefrLevel === "string") existing.cefr_level = cefrLevel;
      return existing;
    }
    const row = {
      lang: code,
      cefr_level: typeof cefrLevel === "string" ? cefrLevel : null,
      messages: 0,
      vocabulary: 0,
      grammar: 0,
      reading_interactions: 0,
    };
    langs.set(code, row);
    return row;
  };

  const [profileRows, memberRows, messageRows, vocabRows, gapRows, readingRows] = await Promise.all(
    [
      db.select<{ learning_languages: Array<{ lang: string; cefr_level?: string }> }>("profiles", {
        columns: "learning_languages",
        filters: [{ op: "eq", column: "user_id", value: userId }],
        limit: 1,
      }),
      db.select<{ target_languages: Array<{ lang: string; cefr_level?: string }> }>(
        "conversation_members",
        {
          columns: "target_languages",
          filters: [{ op: "eq", column: "user_id", value: userId }],
        },
      ),
      db.select<{ language: string | null }>("messages", {
        columns: "language",
        filters: [
          { op: "eq", column: "sender_id", value: userId },
          { op: "eq", column: "is_agent", value: false },
        ],
      }),
      db.select<{ language: string }>("vocabulary", {
        columns: "language",
        filters: [{ op: "eq", column: "user_id", value: userId }],
      }),
      db.select<{ language: string; category: string }>("grammar_gaps", {
        columns: "language, category",
        filters: [{ op: "eq", column: "user_id", value: userId }],
      }),
      listReadingInteractions(db, userId, { limit: 10_000 }),
    ],
  );

  for (const row of profileRows) {
    for (const lang of row.learning_languages ?? []) ensure(lang.lang, lang.cefr_level);
  }
  for (const row of memberRows) {
    for (const lang of row.target_languages ?? []) ensure(lang.lang, lang.cefr_level);
  }
  for (const row of messageRows) {
    const lang = ensure(row.language);
    if (lang) lang.messages++;
  }
  for (const row of vocabRows) {
    const lang = ensure(row.language);
    if (lang) lang.vocabulary++;
  }
  for (const row of gapRows) {
    if (!grammarDimensionForCategory(row.category, row.language)) continue;
    const lang = ensure(row.language);
    if (lang) lang.grammar++;
  }
  for (const row of readingRows) {
    const lang = ensure(row.language);
    if (lang) lang.reading_interactions++;
  }

  return c.json(
    [...langs.values()].sort((a, b) => {
      const aData = a.messages + a.vocabulary + a.grammar + a.reading_interactions;
      const bData = b.messages + b.vocabulary + b.grammar + b.reading_interactions;
      if (aData !== bData) return bData - aData;
      return a.lang.localeCompare(b.lang);
    }),
  );
});

profileStatsRoutes.get("/reading-interactions/:language", async (c) => {
  const language = c.req.param("language").trim();
  const rawLimit = Number.parseInt(c.req.query("limit") ?? "12", 10);
  if (!language) return c.json({ error: "language is required" }, 400);
  const rows = await listReadingInteractions(c.get("db"), c.get("userId"), {
    language,
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 12,
  });
  return c.json({
    items: rows.map((row) => ({
      interaction_id: row.interaction_id,
      document_id: row.document_id,
      source_type: row.source_type,
      source_id: row.source_id,
      source_url: row.source_url,
      title: row.title,
      language: row.language,
      event_type: row.event_type,
      sentence_ordinal: row.sentence_ordinal,
      token_ordinal: row.token_ordinal,
      text: row.text,
      source_text: row.source_text,
      observed_at: row.observed_at,
    })),
  });
});

// Per-language dashboard payload
profileStatsRoutes.get("/stats/:language", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language");
  return c.json(await languageStats(db, userId, language));
});

// Per-dimension drill-down: list items contributing to this dimension.
profileStatsRoutes.get("/dimension/:language/:dimension", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const language = c.req.param("language");
  const dimension = c.req.param("dimension") as Dimension;
  const sort = c.req.query("sort") ?? "problematic";
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 500);

  if (!ALL_DIMENSIONS.includes(dimension)) {
    return c.json({ error: `Unknown dimension: ${dimension}` }, 400);
  }

  if (dimension === "lexis") {
    let vocab = await db.select<VocabItem>("vocabulary", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
      ],
      limit: 500,
    });
    if (await canonicalizeVocabularyRows(db, userId, language, vocab)) {
      vocab = await db.select<VocabItem>("vocabulary", {
        filters: [
          { op: "eq", column: "user_id", value: userId },
          { op: "eq", column: "language", value: language },
        ],
        limit: 500,
      });
    }
    const exerciseProgress = await getExerciseProgressLookup(db, userId, language);
    return c.json({
      dimension,
      items: sortItems(
        vocab.map((v) => ({
          item_type: "vocabulary" as const,
          item_id: v.vocab_id,
          route_key: wiktionarySlug(v.term),
          label: v.term,
          sublabel: v.translation,
          cefr_level: v.cefr_level,
          encounters: v.encounters ?? 0,
          productions: v.productions ?? 0,
          correct_productions: v.correct_productions ?? 0,
          self_corrected_productions: v.self_corrected_productions ?? 0,
          heard: v.heard ?? 0,
          spoken: v.spoken ?? 0,
          error_count: 0,
          ease_factor: v.ease_factor,
          interval_days: v.interval_days,
          repetitions: v.repetitions,
          next_review_at: v.next_review_at,
          last_activity_at: mostRecent(
            getExerciseProgressForTarget(exerciseProgress, {
              itemType: "vocabulary",
              itemId: v.vocab_id,
              conceptId: v.concept_id,
            }).last_scored_at,
            getExerciseProgressForTarget(exerciseProgress, {
              itemType: "vocabulary",
              itemId: v.vocab_id,
              conceptId: v.concept_id,
            }).last_exercised_at,
            v.last_spoken_at,
            v.last_heard_at,
            v.last_produced_at,
            v.last_reviewed_at,
            v.last_encounter_at,
          ),
          ...getExerciseProgressForTarget(exerciseProgress, {
            itemType: "vocabulary",
            itemId: v.vocab_id,
            conceptId: v.concept_id,
          }),
        })),
        sort,
      ).slice(0, limit),
      ready: true,
    });
  }

  if (dimension === "morphology" || dimension === "syntax") {
    const gaps = await db.select<GapItem>("grammar_gaps", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
      ],
      limit: 500,
    });
    const filtered = gaps.filter(
      (g) => grammarDimensionForCategory(g.category, language) === dimension,
    );
    const exerciseProgress = await getExerciseProgressLookup(db, userId, language);
    return c.json({
      dimension,
      items: sortItems(
        filtered.map((g) => ({
          item_type: "grammar" as const,
          item_id: g.gap_id,
          route_key: g.gap_id,
          label: g.category,
          sublabel: g.description,
          cefr_level: null,
          encounters: g.encounters ?? 0,
          productions: g.productions ?? 0,
          correct_productions: g.correct_productions ?? 0,
          self_corrected_productions: g.self_corrected_productions ?? 0,
          heard: 0,
          spoken: 0,
          error_count: g.error_count ?? 0,
          ease_factor: g.ease_factor,
          interval_days: g.interval_days,
          repetitions: g.repetitions,
          next_review_at: g.next_review_at,
          last_activity_at: mostRecent(
            getExerciseProgressForTarget(exerciseProgress, {
              itemType: "grammar",
              itemId: g.gap_id,
              conceptId: g.concept_id,
            }).last_scored_at,
            getExerciseProgressForTarget(exerciseProgress, {
              itemType: "grammar",
              itemId: g.gap_id,
              conceptId: g.concept_id,
            }).last_exercised_at,
            g.last_produced_at,
            g.last_reviewed_at,
            g.last_error_at,
          ),
          ...getExerciseProgressForTarget(exerciseProgress, {
            itemType: "grammar",
            itemId: g.gap_id,
            conceptId: g.concept_id,
          }),
        })),
        sort,
      ).slice(0, limit),
      ready: true,
    });
  }

  // Other dimensions have no pipeline data yet.
  return c.json({ dimension, items: [], ready: false });
});

// Per-item detail with related messages.
profileStatsRoutes.get("/item/:itemType/:itemId", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const itemType = c.req.param("itemType");
  const itemId = c.req.param("itemId");
  const language = c.req.query("language") ?? null;

  if (itemType !== "vocabulary" && itemType !== "grammar") {
    return c.json({ error: `Unknown item type: ${itemType}` }, 400);
  }

  let resolved = await resolveProfileItem(db, userId, itemType, itemId, language);
  if (!resolved) return c.json({ error: "Not found" }, 404);
  if (itemType === "vocabulary" && !resolved.virtual) {
    const itemLanguage =
      typeof resolved.item.language === "string" ? resolved.item.language : (language ?? "");
    const itemTerm = typeof resolved.item.term === "string" ? resolved.item.term : "";
    if (itemLanguage && itemTerm) {
      const normalized = await canonicalizeVocabularyRow(db, userId, itemLanguage, itemTerm);
      if (normalized.term !== itemTerm) {
        resolved =
          (await resolveProfileItem(db, userId, itemType, normalized.term, language)) ?? resolved;
      }
    }
  }
  const { item } = resolved;
  const [contextTranslation, dictionary] = await Promise.all([
    translateExampleToBaseLanguage(db, userId, item),
    lookupProfileItemDictionary(itemType, item),
  ]);
  let responseItem = item;
  if (itemType === "vocabulary" && !resolved.virtual) {
    await recordProfileVocabularySeen(db, userId, resolved).catch((err) => {
      console.error("profile item vocabulary tracking failed:", err);
    });
    responseItem =
      (await db.selectOne<Record<string, unknown>>("vocabulary", {
        filters: [{ op: "eq", column: "vocab_id", value: resolved.canonicalId }],
      })) ?? item;
  }
  const exerciseProgress = getExerciseProgressForTarget(
    await getExerciseProgressLookup(db, userId, String(responseItem.language ?? language ?? "")),
    {
      itemType,
      itemId: resolved.virtual ? null : resolved.canonicalId,
      conceptId: typeof responseItem.concept_id === "string" ? responseItem.concept_id : null,
    },
  );

  const logRows = resolved.virtual
    ? []
    : await db.select<{
        log_id: string;
        message_id: string | null;
        event_type: string;
        outcome: string | null;
        quality: number | null;
        source: string;
        after_state: Record<string, unknown> | null;
        observed_at: string;
      }>("review_log", {
        columns:
          "log_id, message_id, event_type, outcome, quality, source, after_state, observed_at",
        filters: [
          { op: "eq", column: "user_id", value: userId },
          { op: "eq", column: "item_id", value: resolved.canonicalId },
        ],
        order: [{ column: "observed_at", ascending: false }],
        limit: 50,
      });

  const messageIds = [
    ...new Set(logRows.map((l) => l.message_id).filter((x): x is string => !!x)),
  ].slice(0, 10);

  const messages = messageIds.length
    ? await db.select<{
        message_id: string;
        conversation_id: string;
        sender_id: string;
        raw_text: string;
        healed_text: string;
        language: string | null;
        translation: string | null;
        translations: Record<string, string>;
        transliterations: Record<string, string>;
        phonetics: Record<string, string>;
        corrections: unknown[];
        next_challenge: string | null;
        is_agent: boolean;
        created_at: string;
      }>("messages", {
        columns:
          "message_id, conversation_id, sender_id, raw_text, healed_text, language, translation, translations, transliterations, phonetics, corrections, next_challenge, is_agent, created_at",
        filters: [{ op: "in", column: "message_id", values: messageIds }],
      })
    : [];
  const eventsByMessage = new Map<string, Array<Record<string, unknown>>>();
  for (const log of logRows) {
    if (!log.message_id) continue;
    const events = eventsByMessage.get(log.message_id) ?? [];
    events.push({
      log_id: log.log_id,
      event_type: log.event_type,
      outcome: log.outcome,
      source: log.source,
      observed_at: log.observed_at,
      commentary: evidenceCommentary(log.after_state),
    });
    eventsByMessage.set(log.message_id, events);
  }
  const messagesWithLearningEvents = messages.map((message) => ({
    ...message,
    learning_events: eventsByMessage.get(message.message_id) ?? [],
  }));

  return c.json({
    item_type: itemType,
    item: { ...responseItem, route_key: resolved.routeKey, ...exerciseProgress },
    route_key: resolved.routeKey,
    has_profile_data: !resolved.virtual,
    context_translation: contextTranslation,
    dictionary,
    events: logRows,
    messages: messagesWithLearningEvents,
  });
});

// Per-item external references and conjugation/inflection tables.
profileStatsRoutes.get("/item/:itemType/:itemId/reference", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const itemType = c.req.param("itemType");
  const itemId = c.req.param("itemId");
  const languageHint = c.req.query("language") ?? null;

  if (itemType !== "vocabulary" && itemType !== "grammar") {
    return c.json({ error: `Unknown item type: ${itemType}` }, 400);
  }

  const resolved = await resolveProfileItem(db, userId, itemType, itemId, languageHint);
  if (!resolved) return c.json({ error: "Not found" }, 404);
  const { item } = resolved;

  const term = String(item.term ?? item.category ?? "").trim();
  const language = String(item.language ?? "").trim();
  if (!term || !language) return c.json({ error: "Item has no reference key" }, 400);

  try {
    return c.json(await getItemReference(term, language));
  } catch (err) {
    console.error("reference lookup failed:", err);
    return c.json({ error: "Reference lookup failed" }, 502);
  }
});

// Per-item pronunciation audio. Prefer Wiktionary audio when available,
// otherwise fall back to the configured TTS provider.
profileStatsRoutes.get("/item/:itemType/:itemId/audio", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");
  const itemType = c.req.param("itemType");
  const itemId = c.req.param("itemId");
  const languageHint = c.req.query("language") ?? null;

  if (itemType !== "vocabulary" && itemType !== "grammar") {
    return c.json({ error: `Unknown item type: ${itemType}` }, 400);
  }

  const resolved = await resolveProfileItem(db, userId, itemType, itemId, languageHint);
  if (!resolved) return c.json({ error: "Not found" }, 404);
  const { item } = resolved;

  const text = String(item.term ?? item.category ?? "").trim();
  const language = String(item.language ?? "").trim();
  if (!text || !language) return c.json({ error: "Item has no audio key" }, 400);

  const reference = await getItemReference(text, language).catch(() => null);
  const wiktionaryAudio = reference?.pronunciations.find((p) => p.kind === "audio" && p.url)?.url;
  if (wiktionaryAudio) {
    await recordProfileVocabularyHeard(db, userId, resolved).catch((err) => {
      console.error("profile item audio tracking failed:", err);
    });
    return c.redirect(wiktionaryAudio, 302);
  }

  const provider = getAudioProvider();
  if (!provider.isAvailable()) {
    return c.json({ error: "No Wiktionary audio and no TTS provider configured" }, 404);
  }

  try {
    const assetDb = adminDb();
    const cached = await findAudioAssetForRequest(assetDb, {
      provider: provider.name,
      language,
      text,
    }).catch(() => null);
    if (cached) {
      await recordProfileVocabularyHeard(db, userId, resolved).catch((err) => {
        console.error("profile item audio tracking failed:", err);
      });
      return audioAssetResponse(cached);
    }
    const result = await provider.synthesize(text, { language, userId });
    const asset = await storeAudioAsset(assetDb, {
      provider: provider.name,
      language,
      text,
      audio: result.audio,
      contentType: result.contentType,
    });
    await recordProfileVocabularyHeard(db, userId, resolved).catch((err) => {
      console.error("profile item audio tracking failed:", err);
    });
    return audioAssetResponse(asset);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
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

// --- helpers ---

type ProfileItemType = "vocabulary" | "grammar";

interface ResolvedProfileItem {
  item: Record<string, unknown>;
  canonicalId: string;
  routeKey: string;
  virtual?: boolean;
}

async function resolveProfileItem(
  db: Database,
  userId: string,
  itemType: ProfileItemType,
  itemKey: string,
  language: string | null,
): Promise<ResolvedProfileItem | null> {
  if (itemType === "grammar") {
    const item = await db.selectOne<Record<string, unknown>>("grammar_gaps", {
      filters: [
        { op: "eq", column: "gap_id", value: itemKey },
        { op: "eq", column: "user_id", value: userId },
      ],
    });
    const canonicalId = typeof item?.gap_id === "string" ? item.gap_id : "";
    return item && canonicalId ? { item, canonicalId, routeKey: canonicalId } : null;
  }

  if (isUuidLike(itemKey)) {
    const item = await db.selectOne<Record<string, unknown>>("vocabulary", {
      filters: [
        { op: "eq", column: "vocab_id", value: itemKey },
        { op: "eq", column: "user_id", value: userId },
      ],
    });
    const canonicalId = typeof item?.vocab_id === "string" ? item.vocab_id : "";
    const term = typeof item?.term === "string" ? item.term : "";
    if (item && canonicalId && term) return { item, canonicalId, routeKey: wiktionarySlug(term) };
  }

  const term = wiktionarySlugToTerm(itemKey);
  if (!term) return null;
  const baseFilters: Array<{ op: "eq"; column: string; value: string }> = [
    { op: "eq", column: "user_id", value: userId },
    { op: "eq", column: "term", value: term },
  ];
  const filters = language
    ? [...baseFilters, { op: "eq" as const, column: "language", value: language }]
    : baseFilters;
  const item = await db.selectOne<Record<string, unknown>>("vocabulary", { filters });
  const canonicalId = typeof item?.vocab_id === "string" ? item.vocab_id : "";
  const itemTerm = typeof item?.term === "string" ? item.term : term;
  if (item && canonicalId) return { item, canonicalId, routeKey: wiktionarySlug(itemTerm) };

  if (!language) return null;
  const normalized = await normalizeVocabularyTerm(term, language);
  if (normalized.term && normalized.term !== term) {
    const normalizedItem = await db.selectOne<Record<string, unknown>>("vocabulary", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "term", value: normalized.term },
        { op: "eq", column: "language", value: language },
      ],
    });
    const normalizedId =
      typeof normalizedItem?.vocab_id === "string" ? normalizedItem.vocab_id : "";
    if (normalizedItem && normalizedId) {
      return {
        item: normalizedItem,
        canonicalId: normalizedId,
        routeKey: wiktionarySlug(normalized.term),
      };
    }
  }

  const virtualTerm = normalized.term || term;
  return {
    item: virtualVocabularyItem(language, virtualTerm),
    canonicalId: `virtual:${language}:${wiktionarySlug(virtualTerm)}`,
    routeKey: wiktionarySlug(virtualTerm),
    virtual: true,
  };
}

function virtualVocabularyItem(language: string, term: string): Record<string, unknown> {
  return {
    vocab_id: null,
    language,
    term,
    translation: "",
    context_sentence: null,
    cefr_level: null,
    concept_id: null,
    ease_factor: 0,
    interval_days: 0,
    repetitions: 0,
    encounters: 0,
    productions: 0,
    correct_productions: 0,
    self_corrected_productions: 0,
    heard: 0,
    spoken: 0,
    next_review_at: null,
    last_reviewed_at: null,
    last_encounter_at: null,
    last_produced_at: null,
    last_heard_at: null,
    last_spoken_at: null,
  };
}

function wiktionarySlug(term: string): string {
  return term.trim().replace(/\s+/gu, "_");
}

function wiktionarySlugToTerm(slug: string): string {
  return slug.trim().replace(/_/gu, " ");
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

async function canonicalizeVocabularyRows(
  db: Database,
  userId: string,
  language: string,
  rows: VocabItem[],
): Promise<boolean> {
  let changed = false;
  await Promise.all(
    rows.map(async (row) => {
      const normalized = await canonicalizeVocabularyRow(db, userId, language, row.term);
      if (normalized.term !== row.term) changed = true;
    }),
  );
  return changed;
}

async function recordProfileVocabularySeen(
  db: Database,
  userId: string,
  resolved: ResolvedProfileItem,
): Promise<void> {
  await recordProfileVocabularyInteraction(db, userId, resolved, "encounter", "profile_item");
}

async function recordProfileVocabularyHeard(
  db: Database,
  userId: string,
  resolved: ResolvedProfileItem,
): Promise<void> {
  await recordProfileVocabularyInteraction(db, userId, resolved, "heard", "profile_audio");
}

async function recordProfileVocabularyInteraction(
  db: Database,
  userId: string,
  resolved: ResolvedProfileItem,
  eventType: "encounter" | "heard",
  source: "profile_item" | "profile_audio",
): Promise<void> {
  if (typeof resolved.item.term !== "string") return;
  const language = typeof resolved.item.language === "string" ? resolved.item.language.trim() : "";
  if (!language) return;
  const lookupKey = typeof resolved.item.term === "string" ? resolved.item.term.trim() : "";
  if (resolved.virtual && !lookupKey) return;
  await recordInteraction(db, {
    userId,
    language: language as LanguageCode,
    itemType: "vocabulary",
    ...(resolved.virtual ? { lookupKey } : { itemId: resolved.canonicalId }),
    eventType,
    source,
  });
}

async function lookupProfileItemDictionary(
  itemType: ProfileItemType,
  item: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (itemType !== "vocabulary") return null;
  const term = typeof item.term === "string" ? item.term.trim() : "";
  const language = typeof item.language === "string" ? item.language.trim() : "";
  if (!term || !language) return null;

  try {
    const lookup = await lookupDictionary(term, language);
    const lemma =
      lemmaFromFormDescription(lookup.form_description, term) ??
      (usesSourceTermAsLemma(lookup.form_description)
        ? distinctLemma(lookup.source_term, term, language)
        : null);

    return {
      term: lookup.term,
      language: lookup.language,
      lemma,
      source_term: lookup.source_term,
      form_description: lookup.form_description,
      definitions: lookup.definitions.slice(0, 5),
      senses: lookup.senses.slice(0, 5),
      source_url: lookup.source_url,
      target_source_url: lookup.target_source_url,
    };
  } catch (err) {
    console.error("profile item dictionary lookup failed:", err);
    return null;
  }
}

function lemmaFromFormDescription(
  formDescription: string | null | undefined,
  term: string,
): string | null {
  if (!formDescription) return null;
  if (!usesSourceTermAsLemma(formDescription)) return null;
  const match = /\bof\s+([\p{Letter}\p{Mark}'’.-]+)(?:\b|[:.;,])/iu.exec(formDescription);
  return distinctLemma(match?.[1], term, "");
}

function usesSourceTermAsLemma(formDescription: string | null | undefined): boolean {
  return !formDescription || !/\bprefixed verb\b|\bbase\b/iu.test(formDescription);
}

function distinctLemma(
  lemma: string | null | undefined,
  term: string,
  language: string,
): string | null {
  const cleanLemma = typeof lemma === "string" ? lemma.trim() : "";
  if (!cleanLemma) return null;
  const locale = language || undefined;
  if (cleanLemma.toLocaleLowerCase(locale) === term.toLocaleLowerCase(locale)) return null;
  return cleanLemma;
}

async function translateExampleToBaseLanguage(
  db: Database,
  userId: string,
  item: Record<string, unknown>,
): Promise<string | null> {
  const context = typeof item.context_sentence === "string" ? item.context_sentence.trim() : "";
  const language = typeof item.language === "string" ? item.language : "";
  if (!context) return null;

  const profile = await db.selectOne<{ base_language: string }>("profiles", {
    columns: "base_language",
    filters: [{ op: "eq", column: "user_id", value: userId }],
  });
  const baseLanguage = profile?.base_language || "en";
  if (!baseLanguage || baseLanguage === language) return null;

  try {
    const [translated] = await translateTexts([context], baseLanguage);
    return translated ?? null;
  } catch (err) {
    console.error("context example translation failed:", err);
    return null;
  }
}

function evidenceCommentary(afterState: Record<string, unknown> | null): string | null {
  const evidence = afterState?.evidence;
  if (!evidence || typeof evidence !== "object") return null;
  const commentary = (evidence as Record<string, unknown>).commentary;
  return typeof commentary === "string" && commentary.trim() ? commentary.trim() : null;
}

interface VocabItem {
  vocab_id: string;
  concept_id: string | null;
  term: string;
  translation: string;
  cefr_level: string | null;
  encounters: number | null;
  productions: number | null;
  correct_productions: number | null;
  self_corrected_productions: number | null;
  heard: number | null;
  spoken: number | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_produced_at: string | null;
  last_reviewed_at: string | null;
  last_encounter_at: string | null;
  last_heard_at: string | null;
  last_spoken_at: string | null;
}

interface GapItem {
  gap_id: string;
  concept_id: string | null;
  category: string;
  description: string;
  encounters: number | null;
  productions: number | null;
  correct_productions: number | null;
  self_corrected_productions: number | null;
  error_count: number | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_produced_at: string | null;
  last_reviewed_at: string | null;
  last_error_at: string | null;
}

interface ListedItem {
  item_type: "vocabulary" | "grammar";
  item_id: string;
  route_key: string;
  label: string;
  sublabel: string | null;
  cefr_level: string | null;
  encounters: number;
  productions: number;
  correct_productions: number;
  self_corrected_productions: number;
  heard: number;
  spoken: number;
  error_count: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  scored_attempts: number;
  scored_correct: number;
  scored_partial: number;
  scored_incorrect: number;
  accuracy_score: number | null;
  last_scored_at: string | null;
  exercise_attempts: number;
  exercise_correct: number;
  exercise_partial: number;
  exercise_incorrect: number;
  exercise_score: number | null;
  last_exercised_at: string | null;
  next_review_at: string;
  last_activity_at: string | null;
}

function accuracy(item: ListedItem): number {
  if (item.accuracy_score != null) return item.accuracy_score;
  const attempts = item.productions;
  if (attempts === 0) return 1;
  return item.correct_productions / attempts;
}

function sortItems(items: ListedItem[], sort: string): ListedItem[] {
  const copy = [...items];
  switch (sort) {
    case "recent":
      copy.sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
      break;
    case "due":
      copy.sort((a, b) => a.next_review_at.localeCompare(b.next_review_at));
      break;
    case "strength":
      copy.sort((a, b) => accuracy(b) - accuracy(a));
      break;
    default:
      copy.sort((a, b) => {
        // Low accuracy first; break ties with high error_count.
        const accDiff = accuracy(a) - accuracy(b);
        if (accDiff !== 0) return accDiff;
        return b.error_count - a.error_count;
      });
  }
  return copy;
}

function mostRecent(...dates: Array<string | null>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (d && (best === null || d > best)) best = d;
  }
  return best;
}
