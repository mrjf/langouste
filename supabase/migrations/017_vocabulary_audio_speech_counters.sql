-- Track lexical audio/speech interactions separately from text exposure and
-- written production. Heard/spoken are exposure counters, not FSRS recall
-- signals by default.

ALTER TABLE review_log
  DROP CONSTRAINT IF EXISTS review_log_event_type_check;

ALTER TABLE review_log
  ADD CONSTRAINT review_log_event_type_check
  CHECK (event_type IN ('encounter', 'production', 'recall', 'heard', 'spoken'));

ALTER TABLE vocabulary
  ADD COLUMN IF NOT EXISTS heard integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spoken integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heard_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_spoken_at timestamptz;
