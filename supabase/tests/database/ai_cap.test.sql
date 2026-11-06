-- The PC worker's daily cap per user (decision 0016).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

set local session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com', 'authenticated', 'authenticated');
set local session_replication_role = origin;

-- Asha's PC jobs today already reached 300; she has one more categorise job and a month review waiting.
insert into ai_jobs (id, user_id, kind, status, attempts, claimed_at, finished_at)
select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'categorise', 'done', 1, now(), now() from generate_series(1, 300);
insert into ai_jobs (id, user_id, kind, created_at) values
  ('a9000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'categorise', now() - interval '2 hours'),
  ('a9000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'month_review', now() - interval '1 hour'),
  ('b9000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'categorise', now());

select is(
  (select array_agg(id order by id)::text from claim_ai_jobs(20, array['categorise', 'month_review'])),
  '{a9000000-0000-4000-8000-000000000002,b9000000-0000-4000-8000-000000000001}',
  'past the cap only the month review goes out; others are not held up');
select is((select status from ai_jobs where id = 'a9000000-0000-4000-8000-000000000001'), 'queued', 'the job past the cap waits in the queue');

-- The cap counts today only.
update ai_jobs set claimed_at = now() - interval '2 days', finished_at = now() - interval '2 days' where status = 'done';
select is(
  (select array_agg(id)::text from claim_ai_jobs(20, array['categorise'])),
  '{a9000000-0000-4000-8000-000000000001}',
  'the next day the waiting job goes out');

select * from finish();
rollback;
