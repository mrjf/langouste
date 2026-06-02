-- Per-learner/per-language FSRS tuning. `parameters` are the 21 FSRS weights;
-- `quality_weights` maps interaction signals such as
-- "production:correct" or "chat_self_correct:production:incorrect" to a 0-5
-- scheduler quality. Null means "observe but do not schedule".

create table if not exists fsrs_configs (
  config_id                    uuid primary key default gen_random_uuid(),
  user_id                      uuid not null references profiles(user_id) on delete cascade,
  language                     text not null,
  parameters                   jsonb not null default '[]'::jsonb,
  request_retention            real not null default 0.9,
  maximum_interval_days        integer not null default 36500,
  failure_review_delay_minutes integer not null default 10,
  quality_weights              jsonb not null default '{}'::jsonb,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique(user_id, language)
);

alter table fsrs_configs enable row level security;

create policy "Users can manage own FSRS config"
  on fsrs_configs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_fsrs_configs_user_lang
  on fsrs_configs(user_id, language);
