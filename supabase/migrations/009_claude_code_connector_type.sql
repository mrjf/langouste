-- Allow "claude-code" as an agent connector type (local Claude Code session
-- via the Claude Agent SDK).
alter table agent_connectors drop constraint agent_connectors_type_check;
alter table agent_connectors add constraint agent_connectors_type_check
  check (type in ('openclaw', 'claude', 'claude-code', 'http'));
