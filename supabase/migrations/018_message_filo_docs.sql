-- Store corpus/message annotations as Filo byte-offset documents.
-- The JSON shape is FiloDocumentJson from the standalone filo package.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS filo_doc jsonb;
