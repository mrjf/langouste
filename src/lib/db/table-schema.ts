import { randomUUID } from "node:crypto";

export interface TableDefinition {
  idColumns: string[];
  unique?: string[][];
  jsonColumns?: string[];
  defaults?: (now: string) => Record<string, unknown>;
  fullTextColumns?: string[];
  projectedColumns?: string[];
}

const timestamps = (now: string) => ({ created_at: now });

/**
 * Logical table metadata for the turbopuffer storage adapter.
 *
 * Each logical table is stored in its own namespace. Complex values stay in
 * the row's chunked JSON payload, while scalar attributes are materialized for
 * filtering, sorting, and full-text search.
 */
export const TABLE_DEFINITIONS = {
  course_progress: {
    idColumns: ["progress_id"],
    unique: [["user_id", "lesson_id"]],
    jsonColumns: ["read_sections", "encounters", "exercises", "sync_receipts", "reading_evidence"],
  },
  users: {
    idColumns: ["user_id"],
    unique: [["email"]],
    defaults: timestamps,
  },
  profiles: {
    idColumns: ["user_id"],
    jsonColumns: ["learning_languages"],
    defaults: (now) => ({
      learning_languages: [],
      created_at: now,
      updated_at: now,
    }),
    fullTextColumns: ["display_name"],
  },
  agent_connectors: {
    idColumns: ["connector_id"],
    jsonColumns: ["config"],
    defaults: (now) => ({ config: {}, created_at: now }),
    fullTextColumns: ["name"],
  },
  conversations: {
    idColumns: ["conversation_id"],
    defaults: timestamps,
  },
  conversation_members: {
    idColumns: ["conversation_id", "user_id"],
    jsonColumns: ["target_languages", "base_languages"],
    defaults: (now) => ({
      target_languages: [],
      base_languages: [],
      joined_at: now,
      last_read_at: now,
    }),
  },
  messages: {
    idColumns: ["message_id"],
    jsonColumns: ["translations", "transliterations", "phonetics", "filo_doc", "corrections"],
    defaults: (now) => ({
      translations: {},
      transliterations: {},
      phonetics: {},
      corrections: [],
      is_agent: false,
      created_at: now,
    }),
    fullTextColumns: ["raw_text", "healed_text", "translation", "next_challenge"],
  },
  audio_assets: {
    idColumns: ["audio_id"],
    jsonColumns: ["source", "filo_doc"],
    defaults: timestamps,
  },
  audio_drills: {
    idColumns: ["owner_id", "drill_id"],
    unique: [["owner_id", "drill_id"]],
    jsonColumns: ["lesson", "source", "clip_audio_ids"],
    defaults: (now) => ({
      clip_audio_ids: [],
      created_at: now,
      updated_at: now,
    }),
    fullTextColumns: ["title"],
  },
  vocabulary: {
    idColumns: ["vocab_id"],
    unique: [["user_id", "language", "term"]],
    defaults: (now) => ({
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      encounters: 0,
      productions: 0,
      correct_productions: 0,
      self_corrected_productions: 0,
      heard: 0,
      spoken: 0,
      next_review_at: now,
      created_at: now,
    }),
    fullTextColumns: ["term", "translation", "context_sentence"],
  },
  grammar_gaps: {
    idColumns: ["gap_id"],
    unique: [["user_id", "language", "category"]],
    defaults: (now) => ({
      error_count: 1,
      last_error_at: now,
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      encounters: 0,
      productions: 0,
      correct_productions: 0,
      self_corrected_productions: 0,
      next_review_at: now,
      created_at: now,
    }),
    fullTextColumns: ["category", "description"],
  },
  concept_srs: {
    idColumns: ["concept_state_id"],
    unique: [["user_id", "language", "concept_id"]],
    defaults: (now) => ({
      difficulty: 0,
      stability: 0,
      retrievability: 1,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      next_review_at: now,
      created_at: now,
      updated_at: now,
    }),
    fullTextColumns: ["label"],
  },
  fsrs_configs: {
    idColumns: ["config_id"],
    unique: [["user_id", "language"]],
    jsonColumns: ["parameters", "quality_weights"],
    defaults: (now) => ({
      parameters: [],
      request_retention: 0.9,
      maximum_interval_days: 36_500,
      failure_review_delay_minutes: 10,
      quality_weights: {},
      created_at: now,
      updated_at: now,
    }),
  },
  review_log: {
    idColumns: ["log_id"],
    jsonColumns: ["before_state", "after_state"],
    defaults: (now) => ({ observed_at: now }),
  },
  reading_interactions: {
    idColumns: ["interaction_id"],
    jsonColumns: ["vocabulary", "metadata"],
    defaults: (now) => ({
      vocabulary: [],
      metadata: {},
      observed_at: now,
    }),
    fullTextColumns: ["title", "text", "source_text"],
  },
  exercise_attempts: {
    idColumns: ["attempt_id"],
    jsonColumns: ["payload"],
    defaults: (now) => ({ payload: {}, created_at: now }),
    fullTextColumns: ["prompt", "instructions", "expected", "answer", "feedback"],
  },
  assessments: {
    idColumns: ["assessment_id"],
    jsonColumns: ["evidence"],
    defaults: (now) => ({ assessed_at: now }),
  },
  message_traces: {
    idColumns: ["trace_id"],
    jsonColumns: ["phases"],
    defaults: (now) => ({
      text_len: 0,
      outcome: "unknown",
      phases: {},
      created_at: now,
    }),
    fullTextColumns: ["text_preview"],
  },
  corpus_documents: {
    idColumns: ["owner_id", "document_id"],
    unique: [["owner_id", "document_id"]],
    jsonColumns: ["filo_doc"],
    projectedColumns: ["tier_ids"],
    defaults: (now) => ({
      tier_ids: [],
      created_at: now,
      updated_at: now,
    }),
    fullTextColumns: ["title", "text", "annotation_text"],
  },
} satisfies Record<string, TableDefinition>;

export type TableName = keyof typeof TABLE_DEFINITIONS;

export const TABLE_NAMES = Object.keys(TABLE_DEFINITIONS) as TableName[];

export const QUERYABLE_COLUMNS = new Set([
  "progress_id",
  "lesson_id",
  "assessed_at",
  "assessment_id",
  "attempt_id",
  "agent_connector_id",
  "audio_id",
  "drill_id",
  "category",
  "concept_id",
  "concept_state_id",
  "config_id",
  "connector_id",
  "conversation_id",
  "created_at",
  "created_by",
  "document_id",
  "email",
  "event_type",
  "exercise_id",
  "gap_id",
  "healed_text",
  "is_agent",
  "item_id",
  "item_type",
  "interaction_id",
  "language",
  "last_error_at",
  "last_read_at",
  "log_id",
  "message_id",
  "next_review_at",
  "observed_at",
  "owner_id",
  "provider",
  "raw_text",
  "sender_id",
  "source",
  "source_id",
  "source_type",
  "target_lang",
  "term",
  "text_hash",
  "trace_id",
  "updated_at",
  "user_id",
  "vocab_id",
]);

export const FLOAT_COLUMNS = new Set([
  "difficulty",
  "ease_factor",
  "request_retention",
  "retrievability",
  "stability",
]);

export function tableDefinition(table: string): TableDefinition {
  const definition = TABLE_DEFINITIONS[table as TableName];
  if (!definition) throw new Error(`Unknown logical table: ${table}`);
  return definition;
}

export function applyTableDefaults(
  table: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const definition = tableDefinition(table);
  const now = new Date().toISOString();
  const row = { ...(definition.defaults?.(now) ?? {}), ...withoutUndefined(input) };
  if (definition.idColumns.length === 1) {
    const idColumn = definition.idColumns[0];
    if (row[idColumn] == null || row[idColumn] === "") row[idColumn] = randomUUID();
  }
  return row;
}

export function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
