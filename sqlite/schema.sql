-- SQLite schema for Langouste — the consolidated equivalent of all Supabase
-- migrations under supabase/migrations/. Applied in one shot by the sqlite
-- migrator when DATABASE_MODE=sqlite. Keep this in sync with the Postgres
-- migrations at final state; no RLS since SQLite doesn't have it.

PRAGMA foreign_keys = ON;

-- Local user accounts (replaces auth.users from Supabase Auth).
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  display_name        TEXT NOT NULL,
  base_language       TEXT NOT NULL,
  learning_languages  TEXT NOT NULL DEFAULT '[]',  -- JSON
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_connectors (
  connector_id  TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('openclaw', 'claude', 'claude-code', 'http', 'stub')),
  config        TEXT NOT NULL DEFAULT '{}',       -- JSON
  created_by    TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  conversation_id     TEXT PRIMARY KEY,
  created_by          TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  agent_connector_id  TEXT REFERENCES agent_connectors(connector_id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id    TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  target_languages   TEXT NOT NULL DEFAULT '[]',  -- JSON: [{lang, cefr_level}]
  base_languages     TEXT NOT NULL DEFAULT '[]',  -- JSON: [lang, ...]
  joined_at          TEXT NOT NULL DEFAULT (datetime('now')),
  last_read_at       TEXT NOT NULL DEFAULT (datetime('now')),  -- unread badge tracking
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  message_id        TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  sender_id         TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  raw_text          TEXT NOT NULL,
  healed_text       TEXT NOT NULL,
  language          TEXT,
  translation       TEXT,
  translations      TEXT NOT NULL DEFAULT '{}',   -- JSON
  transliterations  TEXT NOT NULL DEFAULT '{}',   -- JSON
  phonetics         TEXT NOT NULL DEFAULT '{}',   -- JSON
  filo_doc          TEXT,                          -- JSON: FiloDocumentJson
  corrections       TEXT NOT NULL DEFAULT '[]',   -- JSON
  next_challenge    TEXT,
  is_agent          INTEGER NOT NULL DEFAULT 0,   -- boolean 0/1
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS audio_assets (
  audio_id      TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  language      TEXT,
  text_hash     TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_length   INTEGER NOT NULL,
  audio_base64  TEXT NOT NULL,
  source        TEXT,                          -- JSON: Source
  filo_doc      TEXT,                          -- JSON: FiloDocumentJson
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audio_assets_text
  ON audio_assets(provider, language, text_hash);

CREATE TABLE IF NOT EXISTS vocabulary (
  vocab_id            TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language            TEXT NOT NULL,
  term                TEXT NOT NULL,
  translation         TEXT NOT NULL,
  context_sentence    TEXT,
  cefr_level          TEXT,
  concept_id          TEXT,
  ease_factor         REAL NOT NULL DEFAULT 2.5,
  interval_days       INTEGER NOT NULL DEFAULT 0,
  repetitions         INTEGER NOT NULL DEFAULT 0,
  encounters          INTEGER NOT NULL DEFAULT 0,
  productions         INTEGER NOT NULL DEFAULT 0,
  correct_productions INTEGER NOT NULL DEFAULT 0,
  self_corrected_productions INTEGER NOT NULL DEFAULT 0,
  heard               INTEGER NOT NULL DEFAULT 0,
  spoken              INTEGER NOT NULL DEFAULT 0,
  next_review_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at    TEXT,
  last_encounter_at   TEXT,
  last_produced_at    TEXT,
  last_heard_at       TEXT,
  last_spoken_at      TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, language, term)
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_review ON vocabulary(user_id, language, next_review_at);

CREATE TABLE IF NOT EXISTS grammar_gaps (
  gap_id              TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language            TEXT NOT NULL,
  category            TEXT NOT NULL,
  description         TEXT NOT NULL,
  concept_id          TEXT,
  error_count         INTEGER NOT NULL DEFAULT 1,
  last_error_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ease_factor         REAL NOT NULL DEFAULT 2.5,
  interval_days       INTEGER NOT NULL DEFAULT 0,
  repetitions         INTEGER NOT NULL DEFAULT 0,
  encounters          INTEGER NOT NULL DEFAULT 0,
  productions         INTEGER NOT NULL DEFAULT 0,
  correct_productions INTEGER NOT NULL DEFAULT 0,
  self_corrected_productions INTEGER NOT NULL DEFAULT 0,
  next_review_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at    TEXT,
  last_encounter_at   TEXT,
  last_produced_at    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, language, category)
);

CREATE INDEX IF NOT EXISTS idx_grammar_gaps_review ON grammar_gaps(user_id, language, next_review_at);

-- FSRS memory state lives at the atomic concept level, not the card/item level.
-- vocabulary and grammar_gaps mirror the next-review fields only for existing UI
-- and API compatibility; concept_srs is the scheduling source of truth.
CREATE TABLE IF NOT EXISTS concept_srs (
  concept_state_id TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language         TEXT NOT NULL,
  concept_id       TEXT NOT NULL,
  item_type        TEXT NOT NULL CHECK (item_type IN ('vocabulary','grammar','concept')),
  label            TEXT NOT NULL,
  difficulty       REAL NOT NULL DEFAULT 0,
  stability        REAL NOT NULL DEFAULT 0,
  retrievability   REAL NOT NULL DEFAULT 1,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  repetitions      INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  next_review_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_reviewed_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, language, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_srs_due ON concept_srs(user_id, language, next_review_at);
CREATE INDEX IF NOT EXISTS idx_concept_srs_concept ON concept_srs(user_id, language, concept_id);

-- Per-learner/per-language FSRS tuning. `parameters` are the 21 FSRS weights;
-- `quality_weights` maps interaction signals such as
-- "production:correct" or "chat_self_correct:production:incorrect" to a 0-5
-- scheduler quality. Null means "observe but do not schedule".
CREATE TABLE IF NOT EXISTS fsrs_configs (
  config_id                    TEXT PRIMARY KEY,
  user_id                      TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language                     TEXT NOT NULL,
  parameters                   TEXT NOT NULL DEFAULT '[]',
  request_retention            REAL NOT NULL DEFAULT 0.9,
  maximum_interval_days        INTEGER NOT NULL DEFAULT 36500,
  failure_review_delay_minutes INTEGER NOT NULL DEFAULT 10,
  quality_weights              TEXT NOT NULL DEFAULT '{}',
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, language)
);

CREATE INDEX IF NOT EXISTS idx_fsrs_configs_user_lang ON fsrs_configs(user_id, language);

-- Append-only event stream; see docs/LEARNING-MODEL.md
CREATE TABLE IF NOT EXISTS review_log (
  log_id         TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language       TEXT NOT NULL,
  item_type      TEXT NOT NULL CHECK (item_type IN ('vocabulary','grammar','concept')),
  item_id        TEXT,
  concept_id     TEXT,
  event_type     TEXT NOT NULL CHECK (event_type IN ('encounter','production','recall','heard','spoken')),
  outcome        TEXT CHECK (outcome IN ('correct','partial','incorrect')),
  quality        INTEGER CHECK (quality BETWEEN 0 AND 5),
  source         TEXT NOT NULL,
  message_id     TEXT,
  before_state   TEXT,   -- JSON
  after_state    TEXT,   -- JSON
  observed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_review_log_user_lang ON review_log(user_id, language, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_log_item      ON review_log(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_review_log_concept   ON review_log(concept_id);

CREATE TABLE IF NOT EXISTS exercise_attempts (
  attempt_id    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language      TEXT NOT NULL,
  exercise_id   TEXT NOT NULL,
  item_type     TEXT NOT NULL CHECK (item_type IN ('vocabulary','grammar')),
  item_id       TEXT,
  concept_id    TEXT,
  kind          TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  instructions  TEXT NOT NULL,
  expected      TEXT,
  answer        TEXT,
  correct       INTEGER,
  quality       INTEGER CHECK (quality BETWEEN 0 AND 5),
  feedback      TEXT,
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_exercise_attempts_user_lang
  ON exercise_attempts(user_id, language, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exercise_attempts_exercise
  ON exercise_attempts(user_id, language, exercise_id);

CREATE TABLE IF NOT EXISTS assessments (
  assessment_id   TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language        TEXT NOT NULL,
  cefr_level      TEXT NOT NULL,
  assessed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  evidence        TEXT                           -- JSON
);

CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id, language, assessed_at DESC);

-- Persistent per-interaction profiling. One row per review/send cycle:
-- phase timings + counts for evals and latency benchmarks. See
-- supabase/migrations/013_message_traces.sql for the phases JSON shape.
CREATE TABLE IF NOT EXISTS message_traces (
  trace_id         TEXT PRIMARY KEY,
  conversation_id  TEXT,
  user_id          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  target_lang      TEXT,
  text_len         INTEGER NOT NULL DEFAULT 0,
  text_preview     TEXT,
  outcome          TEXT NOT NULL DEFAULT 'unknown',
  total_ms         INTEGER,
  phases           TEXT NOT NULL DEFAULT '{}'   -- JSON
);

CREATE INDEX IF NOT EXISTS idx_message_traces_conv    ON message_traces(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_traces_created ON message_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_traces_lang    ON message_traces(target_lang, created_at DESC);
