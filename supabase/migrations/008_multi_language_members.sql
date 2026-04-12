-- Migration: Multi-language conversation members
-- Each member can now have multiple target languages (with CEFR levels) and multiple base languages.
-- Messages now track which language they were written in.

-- 1. Add new JSONB columns
ALTER TABLE conversation_members
  ADD COLUMN target_languages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN base_languages jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Migrate existing data
UPDATE conversation_members
SET
  target_languages = jsonb_build_array(
    jsonb_build_object('lang', target_language, 'cefr_level', 'A1')
  ),
  base_languages = jsonb_build_array(base_language);

-- 3. Drop old columns
ALTER TABLE conversation_members
  DROP COLUMN target_language,
  DROP COLUMN base_language;

-- 4. Add language column to messages (which target language the message was written in)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS language text;
