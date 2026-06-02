import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { languageStats } from "../../services/profile/stats.ts";
import { ALL_DIMENSIONS, type Dimension } from "../../services/profile/dimensions.ts";
import { grammarDimensionForCategory } from "../../services/profile/grammar-ontology.ts";
import { getItemReference } from "../../services/references/item-reference.ts";
import { translateTexts } from "../../services/ai/translator.ts";
import { getAudioProvider } from "../../services/ai/audio/index.ts";
import type { Database } from "../../lib/db/index.ts";

export const profileStatsRoutes = new Hono();

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
    };
    langs.set(code, row);
    return row;
  };

  const [profileRows, memberRows, messageRows, vocabRows, gapRows] = await Promise.all([
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
      filters: [{ op: "eq", column: "sender_id", value: userId }],
    }),
    db.select<{ language: string }>("vocabulary", {
      columns: "language",
      filters: [{ op: "eq", column: "user_id", value: userId }],
    }),
    db.select<{ language: string; category: string }>("grammar_gaps", {
      columns: "language, category",
      filters: [{ op: "eq", column: "user_id", value: userId }],
    }),
  ]);

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

  return c.json(
    [...langs.values()].sort((a, b) => {
      const aData = a.messages + a.vocabulary + a.grammar;
      const bData = b.messages + b.vocabulary + b.grammar;
      if (aData !== bData) return bData - aData;
      return a.lang.localeCompare(b.lang);
    }),
  );
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
    const vocab = await db.select<VocabItem>("vocabulary", {
      filters: [
        { op: "eq", column: "user_id", value: userId },
        { op: "eq", column: "language", value: language },
      ],
      limit: 500,
    });
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
          error_count: 0,
          ease_factor: v.ease_factor,
          interval_days: v.interval_days,
          repetitions: v.repetitions,
          next_review_at: v.next_review_at,
          last_activity_at: mostRecent(v.last_produced_at, v.last_reviewed_at, v.last_encounter_at),
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
          error_count: g.error_count ?? 0,
          ease_factor: g.ease_factor,
          interval_days: g.interval_days,
          repetitions: g.repetitions,
          next_review_at: g.next_review_at,
          last_activity_at: mostRecent(g.last_produced_at, g.last_reviewed_at, g.last_error_at),
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

  const resolved = await resolveProfileItem(db, userId, itemType, itemId, language);
  if (!resolved) return c.json({ error: "Not found" }, 404);
  const { item } = resolved;
  const contextTranslation = await translateExampleToBaseLanguage(db, userId, item);

  const logRows = await db.select<{
    log_id: string;
    message_id: string | null;
    event_type: string;
    outcome: string | null;
    quality: number | null;
    source: string;
    after_state: Record<string, unknown> | null;
    observed_at: string;
  }>("review_log", {
    columns: "log_id, message_id, event_type, outcome, quality, source, after_state, observed_at",
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
    item: { ...item, route_key: resolved.routeKey },
    route_key: resolved.routeKey,
    context_translation: contextTranslation,
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
    return c.redirect(wiktionaryAudio, 302);
  }

  const provider = getAudioProvider();
  if (!provider.isAvailable()) {
    return c.json({ error: "No Wiktionary audio and no TTS provider configured" }, 404);
  }

  try {
    const result = await provider.synthesize(text, { language, userId });
    return new Response(result.audio, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, max-age=86400",
        "Content-Length": String(result.audio.byteLength),
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: detail }, 502);
  }
});

// --- helpers ---

type ProfileItemType = "vocabulary" | "grammar";

interface ResolvedProfileItem {
  item: Record<string, unknown>;
  canonicalId: string;
  routeKey: string;
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
  return item && canonicalId ? { item, canonicalId, routeKey: wiktionarySlug(itemTerm) } : null;
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
  term: string;
  translation: string;
  cefr_level: string | null;
  encounters: number | null;
  productions: number | null;
  correct_productions: number | null;
  self_corrected_productions: number | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_produced_at: string | null;
  last_reviewed_at: string | null;
  last_encounter_at: string | null;
}

interface GapItem {
  gap_id: string;
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
  error_count: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  last_activity_at: string | null;
}

function accuracy(item: ListedItem): number {
  if (item.productions === 0) return 1;
  return item.correct_productions / item.productions;
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
