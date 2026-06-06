-- Persist generated exercises and submissions. Exercise attempts are separate
-- from review_log; submitting an attempt also writes SRS evidence to review_log.

CREATE TABLE IF NOT EXISTS exercise_attempts (
  attempt_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  language     text NOT NULL,
  exercise_id  text NOT NULL,
  item_type    text NOT NULL CHECK (item_type IN ('vocabulary','grammar')),
  item_id      uuid,
  concept_id   text,
  kind         text NOT NULL,
  prompt       text NOT NULL,
  instructions text NOT NULL,
  expected     text,
  answer       text,
  correct      boolean,
  quality      integer CHECK (quality BETWEEN 0 AND 5),
  feedback     text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz
);

ALTER TABLE exercise_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own exercise attempts"
  ON exercise_attempts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own exercise attempts"
  ON exercise_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own exercise attempts"
  ON exercise_attempts FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_exercise_attempts_user_lang
  ON exercise_attempts(user_id, language, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exercise_attempts_exercise
  ON exercise_attempts(user_id, language, exercise_id);
