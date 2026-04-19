-- Allow the `stub` agent connector type. Only usable when
-- LANGOUSTE_TEST_MODE=true (enforced in src/services/agents/factory.ts);
-- this migration just unlocks the check constraint so test-mode deployments
-- can insert stub rows.
alter table agent_connectors drop constraint agent_connectors_type_check;
alter table agent_connectors add constraint agent_connectors_type_check
  check (type in ('openclaw', 'claude', 'claude-code', 'http', 'stub'));
