-- Add translations cache to messages
-- Maps language code → translated text, e.g. {"fr": "Bonjour", "hu": "Szia"}
-- The healed_text remains the canonical version in the sender's target language
alter table messages add column if not exists translations jsonb not null default '{}'::jsonb;

-- Backfill: store the healed_text under its original language
-- We don't know the sender's target language from the messages table alone,
-- so we join conversation_members to find it
update messages m
set translations = jsonb_build_object(cm.target_language, m.healed_text)
from conversation_members cm
where cm.conversation_id = m.conversation_id
and cm.user_id = m.sender_id
and m.translations = '{}'::jsonb;
