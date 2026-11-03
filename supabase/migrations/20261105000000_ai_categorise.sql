-- Milestone 6, build 3 (decision 0012): AI categorising.
--
-- The categorise function queues one job per merchant the dictionary doesn't
-- know, shared across users: a merchant already waiting is not queued again.
-- Finished answers are looked up by merchant for 30 days.

create index ai_jobs_answers_idx on public.ai_jobs (dedupe_key, finished_at desc)
  where kind = 'categorise' and status = 'done' and deleted_at is null;

-- Queues a categorise job for each item, skipping merchants with an open job.
-- p_items holds the cleaned fields the phone sent (merchant label, business UPI
-- ID, amount band, time of day, direction); p_categories the user's category list.
create function public.queue_categorise_jobs(p_user_id uuid, p_items jsonb, p_categories jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  insert into public.ai_jobs (id, user_id, kind, dedupe_key, payload)
  select gen_random_uuid(), p_user_id, 'categorise', item ->> 'merchant',
         jsonb_build_object('items', jsonb_build_array(item), 'categories', p_categories)
  from jsonb_array_elements(p_items) as item
  where length(item ->> 'merchant') between 1 and 80
  on conflict (kind, dedupe_key) where dedupe_key is not null and status in ('queued', 'running') and deleted_at is null
  do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke all on function public.queue_categorise_jobs(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.queue_categorise_jobs(uuid, jsonb, jsonb) to service_role;
