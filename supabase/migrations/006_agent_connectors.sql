-- Agent connectors: configurable AI endpoints for agent chat mode
create table agent_connectors (
  connector_id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('openclaw', 'claude', 'http')),
  config jsonb not null default '{}'::jsonb,
  created_by uuid not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table agent_connectors enable row level security;

create policy "Users can manage own connectors"
  on agent_connectors for all
  using (auth.uid() = created_by);

-- Link conversations to an agent (null = human chat)
alter table conversations add column if not exists agent_connector_id uuid references agent_connectors(connector_id) on delete set null;

-- Flag agent-generated messages
alter table messages add column if not exists is_agent boolean not null default false;
