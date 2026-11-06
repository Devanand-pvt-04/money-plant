-- Fair use of the PC worker (decision 0016): each user's categorise and icon
-- jobs are handed out at most 300 a day (India time). Jobs past the cap stay
-- queued and go out the next day, so a friend's first 12-month import can't
-- keep the PC busy all evening. Month reviews are one a month and never wait.
-- Otherwise the same as claim_ai_jobs in 20261104000000_ai_jobs.sql.

create index ai_jobs_user_day_idx on public.ai_jobs (user_id, claimed_at) where attempts > 0;

create or replace function public.claim_ai_jobs(p_limit integer, p_kinds text[])
returns setof public.ai_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
  daily_cap constant integer := 300;
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
  with used as (
    select u.user_id, count(*) as n
    from public.ai_jobs u
    where u.kind <> 'month_review' and u.attempts > 0 and coalesce(u.claimed_at, u.finished_at) >= day_start
    group by u.user_id
  )
  update public.ai_jobs j set status = 'running', attempts = j.attempts + 1, claimed_at = now()
  where j.id in (
    select q.id from public.ai_jobs q
    where q.status = 'queued' and q.deleted_at is null and q.kind = any (p_kinds)
      and (q.kind = 'month_review' or coalesce((select used.n from used where used.user_id = q.user_id), 0) < daily_cap)
    order by q.created_at
    limit greatest(1, least(p_limit, 20))
    for update skip locked
  )
  returning j.*;
end;
$$;

revoke all on function public.claim_ai_jobs(integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_ai_jobs(integer, text[]) to service_role;
