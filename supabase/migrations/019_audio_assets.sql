-- Generated audio bytes live outside Filo docs. Filo audio annotations store
-- the stable audio_id for the generated asset.

CREATE TABLE IF NOT EXISTS audio_assets (
  audio_id      text PRIMARY KEY,
  provider      text NOT NULL,
  language      text,
  text_hash     text NOT NULL,
  content_hash  text NOT NULL,
  mime_type     text NOT NULL,
  byte_length   integer NOT NULL,
  audio_base64  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audio_assets_text
  ON audio_assets(provider, language, text_hash);
