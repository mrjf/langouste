-- Migration: Conversation read state (Slack-style unread badges)
-- Tracks when each member last read a conversation. Unread = agent messages
-- with created_at > the member's last_read_at.

-- Default now(): existing members start fully caught up, so we don't
-- retroactively flag every past agent message as unread.
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz NOT NULL DEFAULT now();

-- Speeds up the per-conversation unread-count query.
CREATE INDEX IF NOT EXISTS idx_conversation_members_read
  ON conversation_members (user_id, conversation_id, last_read_at);

-- conversation_members is already in the supabase_realtime publication
-- (migration 004), so last_read_at UPDATEs propagate to subscribed clients.
