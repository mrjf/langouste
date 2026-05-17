-- Migration: message_traces — persistent per-interaction profiling
--
-- One row per message review/send cycle. Captures wall-clock phase
-- timings (client-felt) plus server sub-timings, error/token counts,
-- model, and outcome — enough to build evals and latency benchmarks
-- from any real message interaction.

CREATE TABLE IF NOT EXISTS message_traces (
  trace_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(conversation_id) ON DELETE SET NULL,
  user_id         uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  target_lang     text,
  text_len        integer NOT NULL DEFAULT 0,
  -- First 200 chars only — enough for eval grouping, not full PII dump.
  text_preview    text,

  -- "sent" | "reviewing" | "error" | "cancelled"
  outcome         text NOT NULL DEFAULT 'unknown',

  -- Total wall-clock the user waited, ms (client-measured).
  total_ms        integer,

  -- Per-phase detail. Shape (all keys optional):
  -- {
  --   "detect":     { "ms": 3 },
  --   "spellcheck": { "ms": 120, "errors": 2, "provider": "nspell" },
  --   "explain":    { "ms": 4200, "model": "claude-opus-4-6",
  --                   "input_tokens": 850, "output_tokens": 410,
  --                   "explanations": 2, "additional_errors": 1 },
  --   "agent":      { "ms": 9100, "error": null }
  -- }
  phases          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_message_traces_conv
  ON message_traces (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_traces_created
  ON message_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_traces_lang
  ON message_traces (target_lang, created_at DESC);

-- Expose to Realtime so a dashboard could stream traces live.
ALTER PUBLICATION supabase_realtime ADD TABLE message_traces;
