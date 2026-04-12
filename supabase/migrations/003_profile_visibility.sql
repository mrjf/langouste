-- Allow users to read profiles of their conversation partners
create policy "Users can read conversation partners' profiles"
  on profiles for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from conversations c
      where (c.user_a = auth.uid() and c.user_b = user_id)
         or (c.user_b = auth.uid() and c.user_a = user_id)
    )
  );

-- Drop the old restrictive policy
drop policy "Users can read own profile" on profiles;

-- Enable realtime for conversations so participants see when someone joins
alter publication supabase_realtime add table conversations;
