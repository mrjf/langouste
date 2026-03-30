-- Rename native_language → base_language on profiles (idempotent)
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'native_language') then
    alter table profiles rename column native_language to base_language;
  end if;
end $$;

-- Create conversation_members join table (idempotent)
create table if not exists conversation_members (
  conversation_id uuid not null references conversations(conversation_id) on delete cascade,
  user_id uuid not null references profiles(user_id) on delete cascade,
  target_language text not null,
  base_language text not null,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table conversation_members enable row level security;

-- Migrate existing data (only if old columns still exist)
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'conversations' and column_name = 'user_a') then
    -- Migrate user_a rows
    insert into conversation_members (conversation_id, user_id, target_language, base_language, joined_at)
    select c.conversation_id, c.user_a, c.lang_a, p.base_language, c.created_at
    from conversations c
    join profiles p on p.user_id = c.user_a
    on conflict do nothing;

    -- Migrate user_b rows (only where different from user_a)
    insert into conversation_members (conversation_id, user_id, target_language, base_language, joined_at)
    select c.conversation_id, c.user_b, c.lang_b, p.base_language, c.created_at
    from conversations c
    join profiles p on p.user_id = c.user_b
    where c.user_b != c.user_a
    on conflict do nothing;

    -- Add created_by
    if not exists (select 1 from information_schema.columns where table_name = 'conversations' and column_name = 'created_by') then
      alter table conversations add column created_by uuid references profiles(user_id);
      update conversations set created_by = user_a;
      alter table conversations alter column created_by set not null;
    end if;

    -- Drop ALL old RLS policies that reference user_a/user_b
    drop policy if exists "Users can read own conversations" on conversations;
    drop policy if exists "Authenticated users can create conversations" on conversations;
    drop policy if exists "Users can update own conversations" on conversations;
    drop policy if exists "Users can read messages in own conversations" on messages;
    drop policy if exists "Users can insert messages in own conversations" on messages;
    drop policy if exists "Users can read conversation partners' profiles" on profiles;

    -- Now safe to drop old columns
    alter table conversations drop column user_a;
    alter table conversations drop column user_b;
    alter table conversations drop column lang_a;
    alter table conversations drop column lang_b;
  end if;
end $$;

-- Drop policies that may have been created by a failed prior run
drop policy if exists "Members can read conversation members" on conversation_members;
drop policy if exists "Users can join conversations" on conversation_members;
drop policy if exists "Members can update own membership" on conversation_members;
drop policy if exists "Members can read conversations" on conversations;
drop policy if exists "Authenticated users can create conversations" on conversations;
drop policy if exists "Members can read messages" on messages;
drop policy if exists "Members can send messages" on messages;
drop policy if exists "Users can read conversation partners' profiles" on profiles;

-- Security definer function to avoid infinite recursion in RLS
create or replace function is_conversation_member(conv_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = conv_id
    and user_id = auth.uid()
  );
$$;

-- RLS for conversation_members
create policy "Members can read conversation members"
  on conversation_members for select
  using (is_conversation_member(conversation_id));

create policy "Users can join conversations"
  on conversation_members for insert
  with check (auth.uid() = user_id);

create policy "Members can update own membership"
  on conversation_members for update
  using (auth.uid() = user_id);

-- RLS for conversations
create policy "Members can read conversations"
  on conversations for select
  using (is_conversation_member(conversation_id));

create policy "Authenticated users can create conversations"
  on conversations for insert
  with check (auth.uid() = created_by);

-- RLS for messages
create policy "Members can read messages"
  on messages for select
  using (is_conversation_member(conversation_id));

create policy "Members can send messages"
  on messages for insert
  with check (
    auth.uid() = sender_id
    and is_conversation_member(conversation_id)
  );

-- Profile visibility via conversation_members
create policy "Users can read conversation partners' profiles"
  on profiles for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from conversation_members cm1
      join conversation_members cm2 on cm1.conversation_id = cm2.conversation_id
      where cm1.user_id = auth.uid()
      and cm2.user_id = profiles.user_id
    )
  );

-- Enable realtime for conversation_members (idempotent — ignore if already added)
do $$ begin
  alter publication supabase_realtime add table conversation_members;
exception when duplicate_object then
  null;
end $$;
