import { Hono } from "hono";
import { requireAuth } from "../middleware.ts";
import { languageStats } from "../../services/profile/stats.ts";
import {
  ALL_DIMENSIONS,
  dimensionForCategory,
  type Dimension,
} from "../../services/profile/dimensions.ts";

export const profileStatsRoutes = new Hono();

profileStatsRoutes.use("*", requireAuth);

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
          label: v.term,
          sublabel: v.translation,
          cefr_level: v.cefr_level,
          encounters: v.encounters ?? 0,
          productions: v.productions ?? 0,
          correct_productions: v.correct_productions ?? 0,
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
    const filtered = gaps.filter((g) => dimensionForCategory(g.category) === dimension);
    return c.json({
      dimension,
      items: sortItems(
        filtered.map((g) => ({
          item_type: "grammar" as const,
          item_id: g.gap_id,
          label: g.category,
          sublabel: g.description,
          cefr_level: null,
          encounters: g.encounters ?? 0,
          productions: g.productions ?? 0,
          correct_productions: g.correct_productions ?? 0,
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

  if (itemType !== "vocabulary" && itemType !== "grammar") {
    return c.json({ error: `Unknown item type: ${itemType}` }, 400);
  }

  const table = itemType === "vocabulary" ? "vocabulary" : "grammar_gaps";
  const idCol = itemType === "vocabulary" ? "vocab_id" : "gap_id";

  const item = await db.selectOne<Record<string, unknown>>(table, {
    filters: [
      { op: "eq", column: idCol, value: itemId },
      { op: "eq", column: "user_id", value: userId },
    ],
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const logRows = await db.select<{
    log_id: string;
    message_id: string | null;
    event_type: string;
    outcome: string | null;
    quality: number | null;
    source: string;
    observed_at: string;
  }>("review_log", {
    columns: "log_id, message_id, event_type, outcome, quality, source, observed_at",
    filters: [
      { op: "eq", column: "user_id", value: userId },
      { op: "eq", column: "item_id", value: itemId },
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
        raw_text: string;
        healed_text: string;
        created_at: string;
      }>("messages", {
        columns: "message_id, conversation_id, raw_text, healed_text, created_at",
        filters: [{ op: "in", column: "message_id", values: messageIds }],
      })
    : [];

  return c.json({
    item_type: itemType,
    item,
    events: logRows,
    messages,
  });
});

// --- helpers ---

interface VocabItem {
  vocab_id: string;
  term: string;
  translation: string;
  cefr_level: string | null;
  encounters: number | null;
  productions: number | null;
  correct_productions: number | null;
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
  label: string;
  sublabel: string | null;
  cefr_level: string | null;
  encounters: number;
  productions: number;
  correct_productions: number;
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
