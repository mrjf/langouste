-- Upsert grammar gap: increment error_count if exists, insert if not
create or replace function upsert_grammar_gap(
  p_user_id uuid,
  p_language text,
  p_category text,
  p_description text
) returns void as $$
begin
  insert into grammar_gaps (user_id, language, category, description)
  values (p_user_id, p_language, p_category, p_description)
  on conflict (user_id, language, category)
  do update set
    error_count = grammar_gaps.error_count + 1,
    last_error_at = now(),
    description = p_description;
end;
$$ language plpgsql security definer;
