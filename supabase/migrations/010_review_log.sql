-- Append-only event stream of every user interaction with a learnable item.
-- Feeds FSRS migration (when we do it), the eval harness, and per-concept
-- analytics. See docs/LEARNING-MODEL.md "per-item history" and the
-- "recordInteraction" helper in src/services/spaced-repetition/tracker.ts.

create table review_log (
  log_id          uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(user_id) on delete cascade,
  language        text not null,
  item_type       text not null check (item_type in ('vocabulary', 'grammar', 'concept')),
  item_id         uuid,                           -- FK to vocabulary.vocab_id or grammar_gaps.gap_id
  concept_id      text,                           -- stable concept ID (nullable until catalog ships)
  event_type      text not null check (event_type in ('encounter', 'production', 'recall')),
  outcome         text check (outcome in ('correct', 'partial', 'incorrect')),
  quality         int check (quality between 0 and 5),
  source          text not null,                  -- 'chat_encounter' | 'chat_produce' | 'chat_correct' | 'review' | 'exercise'
  message_id      uuid,                           -- if the event came from a real message
  before_state    jsonb,
  after_state     jsonb,
  observed_at     timestamptz not null default now()
);

alter table review_log enable row level security;

create policy "Users can read own review log"
  on review_log for select using (auth.uid() = user_id);

create policy "Users can insert own review log"
  on review_log for insert with check (auth.uid() = user_id);

create index idx_review_log_user_lang on review_log(user_id, language, observed_at desc);
create index idx_review_log_item      on review_log(item_type, item_id);
create index idx_review_log_concept   on review_log(concept_id) where concept_id is not null;

-- Roll-up counters on vocabulary items. Strength derives from these +
-- ease_factor; don't store strength, compute it.
alter table vocabulary
  add column if not exists concept_id text,
  add column if not exists encounters integer not null default 0,
  add column if not exists productions integer not null default 0,
  add column if not exists correct_productions integer not null default 0,
  add column if not exists last_encounter_at timestamptz,
  add column if not exists last_produced_at  timestamptz;

alter table grammar_gaps
  add column if not exists concept_id text,
  add column if not exists encounters integer not null default 0,
  add column if not exists productions integer not null default 0,
  add column if not exists correct_productions integer not null default 0,
  add column if not exists last_encounter_at timestamptz,
  add column if not exists last_produced_at  timestamptz;
