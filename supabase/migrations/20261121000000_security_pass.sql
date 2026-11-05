-- Security pass before the friends release (decision 0016).
--
-- Supabase grants every privilege on new tables to anon and authenticated, and
-- row-level security decides what they can see. TRUNCATE skips row-level
-- security, so it goes, along with TRIGGER and REFERENCES, which the app never
-- needs. Signed-out callers lose every table privilege: nothing in the app
-- reads or writes before sign-in. Tables made later in this file's style must
-- repeat these revokes; supabase/tests/database/rls.test.sql fails otherwise.

do $$
declare
  t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t.relname);
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end;
$$;

-- New tables stop getting these privileges by default.
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;
alter default privileges in schema public revoke all on tables from anon;
