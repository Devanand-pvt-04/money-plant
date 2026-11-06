-- CAT-7: a default note on rules and patterns, added on the phone to entries
-- they categorise that have no note of their own.
alter table public.rules add column note text check (length(note) <= 200);
