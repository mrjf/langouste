import type { Database } from "../../lib/db/index.ts";
import { sm2 } from "./sm2.ts";
import type { LanguageCode } from "../../types/index.ts";

/**
 * Record a user interaction with a learnable item. Single entry point used by:
 *   - chat pipeline (production events when the user writes a message)
 *   - agent replies (encounter events when the agent uses a word)
 *   - review UI (recall events when the user rates an item 0-5)
 *
 * Appends to review_log (append-only event stream) and updates the
 * denormalised roll-ups on the item row. The scheduler keeps using the SRS
 * fields on the item row — this function maintains both views.
 *
 * Outcome/quality mapping for scheduler signals:
 *   production + correct   -> quality 4 (retrieved under communicative pressure)
 *   production + incorrect -> quality 1 (failed recall)
 *   recall (explicit)      -> quality 0..5 from the caller
 *   encounter              -> no scheduler signal, bumps encounters only
 */

export type ItemType = "vocabulary" | "grammar";
export type EventType = "encounter" | "production" | "recall";
export type Outcome = "correct" | "partial" | "incorrect";
export type InteractionSource =
  | "chat_encounter"
  | "chat_produce"
  | "chat_correct"
  | "review"
  | "exercise";

export interface InteractionInput {
  userId: string;
  language: LanguageCode;
  itemType: ItemType;
  /** Existing item if known. If absent, the helper no-ops unless lookup_key is provided. */
  itemId?: string;
  /** For auto-upsert when itemId unknown: the natural key (term for vocab, category for grammar). */
  lookupKey?: string;
  /** Initial-row fields used only when we're creating the item. */
  seed?: Partial<{
    translation: string;
    context_sentence: string;
    cefr_level: string;
    description: string;
    concept_id: string;
  }>;
  eventType: EventType;
  outcome?: Outcome;
  /** Quality 0-5 for recall; inferred for production. */
  quality?: number;
  source: InteractionSource;
  messageId?: string;
}

interface ItemRow {
  id: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  encounters: number;
  productions: number;
  correct_productions: number;
  error_count?: number;
}

export async function recordInteraction(
  db: Database,
  input: InteractionInput,
): Promise<void> {
  const table = input.itemType === "vocabulary" ? "vocabulary" : "grammar_gaps";
  const idColumn = input.itemType === "vocabulary" ? "vocab_id" : "gap_id";

  const existing = await findItem(db, table, idColumn, input);
  const row = existing ?? (await createItem(db, table, idColumn, input));
  if (!row) return; // nothing to attach to

  const before = snapshot(row);

  const qualityForEvent = resolveQuality(input);
  const srs = qualityForEvent !== null
    ? sm2(row, qualityForEvent)
    : null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (input.eventType === "encounter") {
    patch.encounters = row.encounters + 1;
    patch.last_encounter_at = now;
  }
  if (input.eventType === "production") {
    patch.productions = row.productions + 1;
    patch.last_produced_at = now;
    if (input.outcome === "correct") {
      patch.correct_productions = row.correct_productions + 1;
    }
    if (input.outcome === "incorrect" && input.itemType === "grammar") {
      patch.error_count = (row.error_count ?? 0) + 1;
      patch.last_error_at = now;
    }
  }
  if (srs) {
    patch.ease_factor = srs.ease_factor;
    patch.interval_days = srs.interval_days;
    patch.repetitions = srs.repetitions;
    patch.next_review_at = srs.next_review_at.toISOString();
    patch.last_reviewed_at = now;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(table, patch, [
      { op: "eq", column: idColumn, value: row.id },
    ]);
  }

  const after = { ...before, ...patch };

  await db.insert("review_log", {
    user_id: input.userId,
    language: input.language,
    item_type: input.itemType,
    item_id: row.id,
    concept_id: input.seed?.concept_id ?? null,
    event_type: input.eventType,
    outcome: input.outcome ?? null,
    quality: qualityForEvent ?? null,
    source: input.source,
    message_id: input.messageId ?? null,
    before_state: before,
    after_state: after,
  });
}

function resolveQuality(input: InteractionInput): number | null {
  if (input.eventType === "recall") {
    return typeof input.quality === "number" ? input.quality : null;
  }
  if (input.eventType === "production") {
    if (input.outcome === "correct") return 4;
    if (input.outcome === "incorrect") return 1;
    return null; // partial / unknown — don't move the scheduler
  }
  return null;
}

function snapshot(row: ItemRow) {
  return {
    ease_factor: row.ease_factor,
    interval_days: row.interval_days,
    repetitions: row.repetitions,
    encounters: row.encounters,
    productions: row.productions,
    correct_productions: row.correct_productions,
  };
}

async function findItem(
  db: Database,
  table: string,
  idColumn: string,
  input: InteractionInput,
): Promise<ItemRow | null> {
  if (input.itemId) {
    const row = await db.selectOne<Record<string, unknown>>(table, {
      filters: [{ op: "eq", column: idColumn, value: input.itemId }],
    });
    return row ? toItemRow(row, idColumn) : null;
  }

  if (input.lookupKey) {
    const naturalKey = input.itemType === "vocabulary" ? "term" : "category";
    const row = await db.selectOne<Record<string, unknown>>(table, {
      filters: [
        { op: "eq", column: "user_id", value: input.userId },
        { op: "eq", column: "language", value: input.language },
        { op: "eq", column: naturalKey, value: input.lookupKey },
      ],
    });
    return row ? toItemRow(row, idColumn) : null;
  }

  return null;
}

async function createItem(
  db: Database,
  table: string,
  idColumn: string,
  input: InteractionInput,
): Promise<ItemRow | null> {
  if (!input.lookupKey) return null;

  const insertRow: Record<string, unknown> = {
    user_id: input.userId,
    language: input.language,
  };
  if (input.itemType === "vocabulary") {
    insertRow.term = input.lookupKey;
    insertRow.translation = input.seed?.translation ?? "";
    if (input.seed?.context_sentence) insertRow.context_sentence = input.seed.context_sentence;
    if (input.seed?.cefr_level) insertRow.cefr_level = input.seed.cefr_level;
  } else {
    insertRow.category = input.lookupKey;
    insertRow.description = input.seed?.description ?? "";
  }
  if (input.seed?.concept_id) insertRow.concept_id = input.seed.concept_id;

  const created = await db.insert<Record<string, unknown>>(table, insertRow);
  return toItemRow(created, idColumn);
}

function toItemRow(row: Record<string, unknown>, idColumn: string): ItemRow {
  return {
    id: row[idColumn] as string,
    ease_factor: (row.ease_factor as number) ?? 2.5,
    interval_days: (row.interval_days as number) ?? 0,
    repetitions: (row.repetitions as number) ?? 0,
    encounters: (row.encounters as number) ?? 0,
    productions: (row.productions as number) ?? 0,
    correct_productions: (row.correct_productions as number) ?? 0,
    error_count: row.error_count as number | undefined,
  };
}
