-- Record stable provenance and clip-level Filo docs for cached audio assets.

ALTER TABLE audio_assets
  ADD COLUMN IF NOT EXISTS source jsonb,
  ADD COLUMN IF NOT EXISTS filo_doc jsonb;
