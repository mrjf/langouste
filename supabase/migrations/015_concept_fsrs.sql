-- FSRS memory state lives at the atomic concept level, not the card/item level.
-- vocabulary and grammar_gaps retain mirrored next-review fields for existing UI
-- and API compatibility; concept_srs is the scheduling source of truth.

create table if not exists concept_srs (
  concept_state_id uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(user_id) on delete cascade,
  language         text not null,
  concept_id       text not null,
  item_type        text not null check (item_type in ('vocabulary', 'grammar', 'concept')),
  label            text not null,
  difficulty       real not null default 0,
  stability        real not null default 0,
  retrievability   real not null default 1,
  interval_days    integer not null default 0,
  repetitions      integer not null default 0,
  lapses           integer not null default 0,
  next_review_at   timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(user_id, language, concept_id)
);

alter table concept_srs enable row level security;

create policy "Users can manage own concept SRS"
  on concept_srs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_concept_srs_due
  on concept_srs(user_id, language, next_review_at);

create index if not exists idx_concept_srs_concept
  on concept_srs(user_id, language, concept_id);
