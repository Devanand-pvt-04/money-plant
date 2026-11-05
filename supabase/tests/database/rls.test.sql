-- Security pass (decision 0016): proves one user can't read or change another
-- user's rows. Run with `npx supabase test db` against a local database
-- (`npx supabase db start` first); CI runs it on every PR.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

-- ---- Structure ----

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every public table has row-level security on');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)),
  0, 'every public table has at least one policy');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
  0, 'every security definer function pins its search_path');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
  0, 'signed-out callers run no security definer function');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  0, 'signed-out callers have no table grants');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')),
  0, 'signed-in users cannot truncate (which skips row-level security) or add triggers');

-- ---- Three users ----

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_id uuid, p_email text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated, anon;

-- Asha writes a small ledger and lends Bala money.
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
insert into accounts (id, type, name) values
  ('a0000000-0000-4000-8000-000000000001', 'bank', 'Asha savings'),
  ('a0000000-0000-4000-8000-000000000002', 'category', 'Food');
insert into accounts (id, type, name, email) values
  ('a0000000-0000-4000-8000-000000000003', 'person', 'Bala', 'bala@example.com');
insert into transactions (id, occurred_at, kind, status, confidence) values
  ('a1000000-0000-4000-8000-000000000001', now(), 'expense', 'confirmed', 1);
insert into postings (id, transaction_id, account_id, amount_paise) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', -10000),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 10000);
insert into sources (id, transaction_id, kind, fingerprint, received_at, confidence) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'manual', 'm-1', now(), 1);
insert into ious (id, person_account_id, direction, amount_paise, occurred_on, counterparty_email) values
  ('a4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'lent', 50000, current_date, 'bala@example.com');
insert into app_errors (id, message, source, occurred_at) values
  ('a5000000-0000-4000-8000-000000000001', 'test', 'test', now());

select is((select count(*)::int from accounts), 3, 'Asha reads her own accounts');

-- ---- Bala: can't see or touch Asha's ledger ----

select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com');

select is((select count(*)::int from accounts), 0, 'Bala reads none of Asha''s accounts');
select is((select count(*)::int from transactions), 0, 'Bala reads none of Asha''s entries');
select is((select count(*)::int from postings), 0, 'Bala reads none of Asha''s postings');
select is((select count(*)::int from sources), 0, 'Bala reads none of Asha''s sources');
select is((select count(*)::int from app_errors), 0, 'Bala reads none of Asha''s crash reports');

update accounts set name = 'hacked' where id = 'a0000000-0000-4000-8000-000000000001';
update transactions set note = 'hacked' where id = 'a1000000-0000-4000-8000-000000000001';
update postings set amount_paise = 1 where id = 'a2000000-0000-4000-8000-000000000001';
delete from transactions where id = 'a1000000-0000-4000-8000-000000000001';
delete from accounts where id = 'a0000000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into postings (id, transaction_id, account_id, amount_paise) values
    ('b2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 5)$$,
  '42501', null, 'Bala cannot add a posting to Asha''s entry');

select throws_ok(
  $$insert into accounts (id, user_id, type, name) values
    ('b0000000-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001', 'bank', 'planted')$$,
  '42501', null, 'Bala cannot write a row as Asha');

select throws_ok(
  $$insert into merchants (id, normalised_name, category_key, confidence, created_by) values ('b7000000-0000-4000-8000-000000000001', 'evil', 'food', 1, 'user_confirmed')$$,
  '42501', null, 'Bala cannot write to the shared merchant dictionary');

-- The IOU Asha shared with Bala is visible to Bala, and only its answer is his to write.
select is((select count(*)::int from ious), 1, 'Bala sees the IOU shared with his email');
update ious set amount_paise = 1 where id = 'a4000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select respond_iou('a4000000-0000-4000-8000-000000000001', true, null, null, null)$$,
  'Bala can confirm the IOU shared with him');

-- ---- Chitra: not part of the IOU ----

select pg_temp.act_as('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com');
select is((select count(*)::int from ious), 0, 'Chitra cannot see an IOU between Asha and Bala');
select throws_ok(
  $$select respond_iou('a4000000-0000-4000-8000-000000000001', false, null, null, null)$$,
  '42501', null, 'Chitra cannot answer an IOU that is not hers');
select is((select count(*)::int from iou_payments), 0, 'Chitra sees no repayments');
select throws_ok(
  $$insert into iou_payments (id, iou_id, amount_paise, paid_at) values
    ('c6000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 100, now())$$,
  '42501', null, 'Chitra cannot record a repayment on someone else''s IOU');
select lives_ok($$select clear_my_data()$$, 'Chitra can clear her own data');

-- ---- Signed out: nothing at all ----

select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select count(*) from accounts$$, '42501', null, 'a signed-out caller cannot read accounts');
select throws_ok($$select count(*) from ious$$, '42501', null, 'a signed-out caller cannot read IOUs');
select throws_ok(
  $$insert into app_errors (id, message, source, occurred_at) values ('d5000000-0000-4000-8000-000000000001', 'x', 'x', now())$$,
  '42501', null, 'a signed-out caller cannot write crash reports');

-- ---- Back as the database owner: Asha's rows are untouched ----

reset role;
select is((select name from accounts where id = 'a0000000-0000-4000-8000-000000000001'), 'Asha savings', 'Bala''s update and delete changed nothing');
select is((select note from transactions where id = 'a1000000-0000-4000-8000-000000000001'), null, 'Asha''s entry note is unchanged');
select is((select sum(amount_paise)::bigint from postings where transaction_id = 'a1000000-0000-4000-8000-000000000001'), 0::bigint, 'Asha''s postings still sum to zero');
select is((select amount_paise from ious where id = 'a4000000-0000-4000-8000-000000000001'), 50000::bigint, 'Bala could not change the IOU amount');
select isnt((select confirmed_at from ious where id = 'a4000000-0000-4000-8000-000000000001'), null, 'Bala''s confirmation was recorded');
select is((select count(*)::int from accounts where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 3, 'Chitra clearing her data left Asha''s accounts');

select * from finish();
rollback;
