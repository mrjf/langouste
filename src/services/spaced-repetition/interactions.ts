import type { Database } from "../../lib/db/index.ts";
import type { LanguageCode } from "../../types/index.ts";
import {
  getFSRSConfig,
  resolveInteractionQuality,
  schedulerOptionsFromConfig,
  type FSRSConfig,
} from "./config.ts";
import { fsrsSchedule, type FSRSConceptState, type FSRSResult } from "./fsrs.ts";

/**
 * Record a user interaction with a learnable item. Single entry point used by:
 *   - chat pipeline (production events when the user writes a message)
 *   - agent replies (encounter events when the agent uses a word)
 *   - review UI (recall events when the user rates an item 0-5)
 *
 * Appends to review_log (append-only event stream), updates denormalised
 * roll-ups on the item row, and schedules the atomic concept via FSRS.
 * Item SRS fields are mirrors for existing UI/API compatibility; concept_srs
 * is the scheduling source of truth.
 *
 * Outcome/quality mapping for scheduler signals:
 *   production + correct   -> quality 4 (retrieved under communicative pressure)
 *   production + incorrect -> quality 1 (failed recall, including self-corrected)
 *   recall (explicit)      -> quality 0..5 from the caller
 *   encounter              -> no scheduler signal, bumps encounters only
 *   heard                  -> no scheduler signal, bumps heard only (vocabulary)
 *   spoken                 -> no scheduler signal, bumps spoken only (vocabulary)
 */

export type ItemType = "vocabulary" | "grammar";
export type EventType = "encounter" | "production" | "recall" | "heard" | "spoken";
export type Outcome = "correct" | "partial" | "incorrect";
export type InteractionSource =
  | "chat_encounter"
  | "chat_produce"
  | "chat_correct"
  | "chat_self_correct"
  | "dictionary_page"
  | "dictionary_audio"
  | "profile_item"
  | "profile_audio"
  | "workbench_definition"
  | "workbench_audio"
  | "reading_sentence"
  | "reading_word"
  | "reading_vocabulary"
  | "reading_audio"
  | "reading_workbench"
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
  evidence?: Partial<{
    commentary: string;
    original: string;
    corrected: string;
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
  label: string;
  concept_id: string | null;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  encounters: number;
  productions: number;
  correct_productions: number;
  self_corrected_productions: number;
  heard: number;
  spoken: number;
  error_count?: number;
}

interface ConceptStateRow extends FSRSConceptState {
  concept_state_id: string;
  concept_id: string;
  retrievability: number;
  interval_days: number;
  next_review_at: string;
}

const interactionTails = new Map<string, Promise<void>>();

export async function recordInteraction(db: Database, input: InteractionInput): Promise<void> {
  const key = `${input.userId}\0${input.language}\0${input.itemType}\0${input.lookupKey ?? input.itemId ?? ""}`;
  const previous = interactionTails.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  interactionTails.set(key, current);
  await previous;
  try {
    await recordInteractionLocked(db, input);
  } finally {
    release();
    if (interactionTails.get(key) === current) interactionTails.delete(key);
  }
}

async function recordInteractionLocked(db: Database, input: InteractionInput): Promise<void> {
  const table = input.itemType === "vocabulary" ? "vocabulary" : "grammar_gaps";
  const idColumn = input.itemType === "vocabulary" ? "vocab_id" : "gap_id";
  const config = await getFSRSConfig(db, input.userId, input.language);

  const existing = await findItem(db, table, idColumn, input);
  const row = existing ?? (await createItem(db, table, idColumn, input));
  if (!row) return; // nothing to attach to

  const conceptId = resolveConceptId(input, row);
  const rowWithConcept = { ...row, concept_id: conceptId };
  const concept = await findOrCreateConceptState(db, input, rowWithConcept, conceptId);

  const before = snapshot(rowWithConcept, concept, config);

  const qualityForEvent = resolveInteractionQuality(input, config);
  const fsrs =
    qualityForEvent !== null
      ? fsrsSchedule(concept, qualityForEvent, new Date(), schedulerOptionsFromConfig(config))
      : null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (row.concept_id !== conceptId) patch.concept_id = conceptId;

  if (input.eventType === "encounter") {
    patch.encounters = row.encounters + 1;
    patch.last_encounter_at = now;
  }
  if (input.eventType === "heard" && input.itemType === "vocabulary") {
    patch.heard = row.heard + 1;
    patch.last_heard_at = now;
  }
  if (input.eventType === "spoken" && input.itemType === "vocabulary") {
    patch.spoken = row.spoken + 1;
    patch.last_spoken_at = now;
  }
  if (input.eventType === "production") {
    patch.productions = row.productions + 1;
    patch.last_produced_at = now;
    if (input.outcome === "correct") {
      patch.correct_productions = row.correct_productions + 1;
    }
    if (input.source === "chat_self_correct") {
      patch.self_corrected_productions = row.self_corrected_productions + 1;
    }
    if (input.outcome === "incorrect" && input.itemType === "grammar") {
      patch.error_count = (row.error_count ?? 0) + 1;
      patch.last_error_at = now;
    }
  }
  if (fsrs) {
    await updateConceptState(db, concept.concept_state_id, fsrs, now);
    patch.ease_factor = fsrs.difficulty;
    patch.interval_days = fsrs.interval_days;
    patch.repetitions = fsrs.repetitions;
    patch.next_review_at = fsrs.next_review_at.toISOString();
    patch.last_reviewed_at = now;
  }

  if (Object.keys(patch).length > 0) {
    await db.update(table, patch, [{ op: "eq", column: idColumn, value: row.id }]);
  }

  const afterConcept = fsrs
    ? {
        ...concept,
        difficulty: fsrs.difficulty,
        stability: fsrs.stability,
        retrievability: fsrs.retrievability,
        interval_days: fsrs.interval_days,
        repetitions: fsrs.repetitions,
        lapses: fsrs.lapses,
        next_review_at: fsrs.next_review_at.toISOString(),
        last_reviewed_at: now,
      }
    : concept;
  const after = {
    ...snapshot({ ...rowWithConcept, ...patch } as ItemRow, afterConcept, config),
    evidence: input.evidence ?? null,
  };

  await db.insert("review_log", {
    user_id: input.userId,
    language: input.language,
    item_type: input.itemType,
    item_id: row.id,
    concept_id: conceptId,
    event_type: input.eventType,
    outcome: input.outcome ?? null,
    quality: qualityForEvent ?? null,
    source: input.source,
    message_id: input.messageId ?? null,
    before_state: before,
    after_state: after,
  });
}

function snapshot(row: ItemRow, concept: ConceptStateRow, config: FSRSConfig) {
  return {
    concept_id: row.concept_id,
    ease_factor: row.ease_factor,
    interval_days: row.interval_days,
    repetitions: row.repetitions,
    encounters: row.encounters,
    productions: row.productions,
    correct_productions: row.correct_productions,
    self_corrected_productions: row.self_corrected_productions,
    heard: row.heard,
    spoken: row.spoken,
    fsrs: {
      difficulty: concept.difficulty,
      stability: concept.stability,
      retrievability: concept.retrievability,
      interval_days: concept.interval_days,
      repetitions: concept.repetitions,
      lapses: concept.lapses,
      next_review_at: concept.next_review_at,
      last_reviewed_at: concept.last_reviewed_at,
    },
    fsrs_config: {
      config_id: config.config_id,
      request_retention: config.request_retention,
      maximum_interval_days: config.maximum_interval_days,
      failure_review_delay_minutes: config.failure_review_delay_minutes,
      parameters: config.parameters,
      quality_weights: config.quality_weights,
    },
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
    if (input.outcome !== "incorrect") insertRow.error_count = 0;
  }
  if (input.seed?.concept_id) insertRow.concept_id = input.seed.concept_id;

  const created = await db.insert<Record<string, unknown>>(table, insertRow);
  return toItemRow(created, idColumn);
}

function toItemRow(row: Record<string, unknown>, idColumn: string): ItemRow {
  return {
    id: row[idColumn] as string,
    label: ((row.term ?? row.category) as string | undefined) ?? "",
    concept_id: (row.concept_id as string | null | undefined) ?? null,
    ease_factor: (row.ease_factor as number) ?? 2.5,
    interval_days: (row.interval_days as number) ?? 0,
    repetitions: (row.repetitions as number) ?? 0,
    encounters: (row.encounters as number) ?? 0,
    productions: (row.productions as number) ?? 0,
    correct_productions: (row.correct_productions as number) ?? 0,
    self_corrected_productions: (row.self_corrected_productions as number) ?? 0,
    heard: (row.heard as number) ?? 0,
    spoken: (row.spoken as number) ?? 0,
    error_count: row.error_count as number | undefined,
  };
}

async function findOrCreateConceptState(
  db: Database,
  input: InteractionInput,
  row: ItemRow,
  conceptId: string,
): Promise<ConceptStateRow> {
  const existing = await db.selectOne<Record<string, unknown>>("concept_srs", {
    filters: [
      { op: "eq", column: "user_id", value: input.userId },
      { op: "eq", column: "language", value: input.language },
      { op: "eq", column: "concept_id", value: conceptId },
    ],
  });
  if (existing) return toConceptState(existing);

  try {
    const created = await db.insert<Record<string, unknown>>("concept_srs", {
      user_id: input.userId,
      language: input.language,
      concept_id: conceptId,
      item_type: input.itemType,
      label: row.label || input.lookupKey || conceptId,
      updated_at: new Date().toISOString(),
    });
    return toConceptState(created);
  } catch {
    const raced = await db.selectOne<Record<string, unknown>>("concept_srs", {
      filters: [
        { op: "eq", column: "user_id", value: input.userId },
        { op: "eq", column: "language", value: input.language },
        { op: "eq", column: "concept_id", value: conceptId },
      ],
    });
    if (raced) return toConceptState(raced);
    throw new Error(`Failed to create concept_srs for ${conceptId}`);
  }
}

async function updateConceptState(
  db: Database,
  conceptStateId: string,
  fsrs: FSRSResult,
  reviewedAt: string,
): Promise<void> {
  await db.update(
    "concept_srs",
    {
      difficulty: fsrs.difficulty,
      stability: fsrs.stability,
      retrievability: fsrs.retrievability,
      interval_days: fsrs.interval_days,
      repetitions: fsrs.repetitions,
      lapses: fsrs.lapses,
      next_review_at: fsrs.next_review_at.toISOString(),
      last_reviewed_at: reviewedAt,
      updated_at: reviewedAt,
    },
    [{ op: "eq", column: "concept_state_id", value: conceptStateId }],
  );
}

function toConceptState(row: Record<string, unknown>): ConceptStateRow {
  return {
    concept_state_id: row.concept_state_id as string,
    concept_id: row.concept_id as string,
    difficulty: Number(row.difficulty ?? 0),
    stability: Number(row.stability ?? 0),
    retrievability: Number(row.retrievability ?? 1),
    interval_days: Number(row.interval_days ?? 0),
    repetitions: Number(row.repetitions ?? 0),
    lapses: Number(row.lapses ?? 0),
    next_review_at: (row.next_review_at as string | null | undefined) ?? new Date().toISOString(),
    last_reviewed_at: (row.last_reviewed_at as string | null | undefined) ?? null,
  };
}

function resolveConceptId(input: InteractionInput, row: ItemRow): string {
  if (input.seed?.concept_id) return input.seed.concept_id;
  if (row.concept_id) return row.concept_id;
  const key = input.lookupKey || row.label || row.id;
  return `${input.itemType}:${normalizeConceptPart(input.language)}:${normalizeConceptPart(key)}`;
}

function normalizeConceptPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return encodeURIComponent(normalized || "unknown");
}
