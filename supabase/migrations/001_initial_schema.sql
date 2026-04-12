-- Profiles (extends Supabase auth.users)
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  native_language text not null,
  learning_languages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = user_id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = user_id);

-- Conversations between two users
create table conversations (
  conversation_id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(user_id) on delete cascade,
  user_b uuid not null references profiles(user_id) on delete cascade,
  lang_a text not null,
  lang_b text not null,
  invite_code text unique default encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now()
);

alter table conversations enable row level security;

create policy "Users can read own conversations"
  on conversations for select
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "Authenticated users can create conversations"
  on conversations for insert
  with check (auth.uid() = user_a or auth.uid() = user_b);

create policy "Users can update own conversations"
  on conversations for update
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Messages
create table messages (
  message_id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(conversation_id) on delete cascade,
  sender_id uuid not null references profiles(user_id) on delete cascade,
  raw_text text not null,
  healed_text text not null,
  translation text,
  corrections jsonb not null default '[]'::jsonb,
  next_challenge text,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

create policy "Users can read messages in own conversations"
  on messages for select
  using (
    exists (
      select 1 from conversations c
      where c.conversation_id = messages.conversation_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

create policy "Users can insert messages in own conversations"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from conversations c
      where c.conversation_id = messages.conversation_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

create index idx_messages_conversation on messages(conversation_id, created_at);

-- Enable realtime for messages
alter publication supabase_realtime add table messages;

-- Vocabulary tracking with spaced repetition
create table vocabulary (
  vocab_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  language text not null,
  term text not null,
  translation text not null,
  context_sentence text,
  cefr_level text,
  ease_factor real not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  next_review_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, language, term)
);

alter table vocabulary enable row level security;

create policy "Users can manage own vocabulary"
  on vocabulary for all using (auth.uid() = user_id);

create index idx_vocabulary_review on vocabulary(user_id, language, next_review_at);

-- Grammar gap tracking with spaced repetition
create table grammar_gaps (
  gap_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  language text not null,
  category text not null,
  description text not null,
  error_count integer not null default 1,
  last_error_at timestamptz not null default now(),
  ease_factor real not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  next_review_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, language, category)
);

alter table grammar_gaps enable row level security;

create policy "Users can manage own grammar gaps"
  on grammar_gaps for all using (auth.uid() = user_id);

create index idx_grammar_gaps_review on grammar_gaps(user_id, language, next_review_at);

-- CEFR assessment history
create table assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  language text not null,
  cefr_level text not null,
  assessed_at timestamptz not null default now(),
  evidence jsonb
);

alter table assessments enable row level security;

create policy "Users can read own assessments"
  on assessments for select using (auth.uid() = user_id);

create index idx_assessments_user on assessments(user_id, language, assessed_at desc);
