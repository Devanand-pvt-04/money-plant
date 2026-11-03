-- Milestone 6, build 1 (decisions 0006 and 0012): the AI job queue.
--
-- Edge functions and phones add jobs; a worker on Deva's PC claims them
-- through the ai-worker edge function, runs them on a local model and posts
-- the results back. Nothing else calls a model. Payloads carry only what a
-- task needs (merchant labels, amount bands, month review facts), never raw
-- SMS text, account numbers or phone numbers.

create table public.ai_jobs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('categorise', 'month_review', 'icon')),
  -- One open job per key and kind: a merchant waiting for AI is queued once, however many ask.
  dedupe_key text check (length(dedupe_key) <= 120),
  payload jsonb check (pg_column_size(payload) <= 65536),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  result jsonb check (pg_column_size(result) <= 65536),
  error text check (length(error) <= 200),
  attempts integer not null default 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index ai_jobs_queue_idx on public.ai_jobs (created_at) where status = 'queued' and deleted_at is null;
create index ai_jobs_user_idx on public.ai_jobs (user_id, kind, status);
create unique index ai_jobs_open_key_idx on public.ai_jobs (kind, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running') and deleted_at is null;
create trigger ai_jobs_set_updated_at before insert or update on public.ai_jobs
for each row execute function public.set_updated_at();

alter table public.ai_jobs enable row level security;

create policy "Users read their own AI jobs" on public.ai_jobs for select
to authenticated using ((select auth.uid()) = user_id);
-- Phones queue their own month reviews and icon suggestions; categorise jobs come from the categorise function.
create policy "Users queue their own AI jobs" on public.ai_jobs for insert
to authenticated with check (
  (select auth.uid()) = user_id and status = 'queued' and attempts = 0 and result is null
  and kind in ('month_review', 'icon')
);
revoke all on public.ai_jobs from anon, authenticated;
grant select, insert on public.ai_jobs to authenticated;

-- Hands the worker up to p_limit queued jobs of the kinds it can run, oldest
-- first, so an older worker never takes a kind it doesn't know. Also does the
-- housekeeping, so it needs no scheduler: a job left running for 10 minutes
-- (the PC slept) goes back to the queue, categorise jobs queued for 30 days
-- are dropped, and finished jobs' payloads are cleared after 30 days.
create function public.claim_ai_jobs(p_limit integer, p_kinds text[])
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_jobs
  set status = case when attempts >= 2 then 'failed' else 'queued' end,
      error = 'timed out',
      claimed_at = null,
      finished_at = case when attempts >= 2 then now() end
  where status = 'running' and claimed_at < now() - interval '10 minutes';

  update public.ai_jobs set deleted_at = now(), error = 'expired'
  where status = 'queued' and kind = 'categorise' and deleted_at is null and created_at < now() - interval '30 days';

  update public.ai_jobs set payload = null
  where status in ('done', 'failed') and payload is not null and finished_at < now() - interval '30 days';

  return query
  update public.ai_jobs j set status = 'running', attempts = j.attempts + 1, claimed_at = now()
  where j.id in (
    select q.id from public.ai_jobs q
    where q.status = 'queued' and q.deleted_at is null and q.kind = any (p_kinds)
    order by q.created_at
    limit greatest(1, least(p_limit, 20))
    for update skip locked
  )
  returning j.*;
end;
$$;

-- The worker's answer to a job it claimed. A job that already finished, or was claimed again after timing out, is left alone.
create function public.complete_ai_job(p_id uuid, p_result jsonb)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.ai_jobs set status = 'done', result = p_result, error = null, finished_at = now()
    where id = p_id and status = 'running'
    returning 1
  )
  select exists (select 1 from done);
$$;

-- A job the model couldn't answer goes back to the queue once, then fails.
create function public.fail_ai_job(p_id uuid, p_error text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with failed as (
    update public.ai_jobs
    set status = case when attempts >= 2 then 'failed' else 'queued' end,
        error = left(p_error, 200),
        claimed_at = null,
        finished_at = case when attempts >= 2 then now() end
    where id = p_id and status = 'running'
    returning 1
  )
  select exists (select 1 from failed);
$$;

-- How many jobs are waiting, for the worker's start-up check.
create function public.ai_queue_counts()
returns table (kind text, queued bigint, running bigint)
language sql
security definer
set search_path = ''
as $$
  select j.kind, count(*) filter (where j.status = 'queued'), count(*) filter (where j.status = 'running')
  from public.ai_jobs j
  where j.status in ('queued', 'running') and j.deleted_at is null
  group by j.kind;
$$;

revoke all on function public.claim_ai_jobs(integer, text[]) from public, anon, authenticated;
revoke all on function public.complete_ai_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_ai_job(uuid, text) from public, anon, authenticated;
revoke all on function public.ai_queue_counts() from public, anon, authenticated;
grant execute on function public.claim_ai_jobs(integer, text[]) to service_role;
grant execute on function public.complete_ai_job(uuid, jsonb) to service_role;
grant execute on function public.fail_ai_job(uuid, text) to service_role;
grant execute on function public.ai_queue_counts() to service_role;
