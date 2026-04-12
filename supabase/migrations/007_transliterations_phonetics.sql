-- Add transliterations and phonetics tracks to messages.
-- Both are JSONB dictionaries, keyed by composite keys:
--   transliterations: "sourceLang→targetLang"  e.g. "ar→en", "zh→fr"
--   phonetics:        "system:lang"             e.g. "ipa:fr", "ipa:ja"

alter table messages
  add column if not exists transliterations jsonb not null default '{}'::jsonb,
  add column if not exists phonetics        jsonb not null default '{}'::jsonb;
