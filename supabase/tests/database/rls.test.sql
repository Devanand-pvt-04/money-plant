-- Security pass (decision 0016): proves one user can't read or change another
-- user's rows. Run with `npx supabase test db` against a local database
-- (`npx supabase db start` first); CI runs it on every PR.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(60);

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

-- The invite door (ACC-8) has its own tests in invites.test.sql; skip it here.
set local session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com', 'authenticated', 'authenticated');
set local session_replication_role = origin;

-- AI usage is written only by the service role; Asha has a row for this month.
insert into ai_usage (user_id, month, calls) values ('aaaaaaaa-0000-4000-8000-000000000001', date_trunc('month', current_date)::date, 3);

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

-- One row in every other table that holds her data.
insert into account_types (id, name, class) values ('a6000000-0000-4000-8000-000000000001', 'Gold', 'asset');
insert into balance_anchors (id, account_id, balance_paise, observed_at, source_id) values
  ('a6000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 90000, now(), 'a3000000-0000-4000-8000-000000000001');
insert into rules (id, kind, status, match, category_account_id) values
  ('a6000000-0000-4000-8000-000000000003', 'rule', 'active', '{"kind":"rule"}', 'a0000000-0000-4000-8000-000000000002');
insert into budgets (id, month, category_account_id, limit_paise) values
  ('a6000000-0000-4000-8000-000000000004', date_trunc('month', current_date)::date, 'a0000000-0000-4000-8000-000000000002', 500000);
insert into recurring (id, name, amount_paise, cadence, next_due, account_id, category_account_id, status, origin) values
  ('a6000000-0000-4000-8000-000000000005', 'Netflix', 64900, 'monthly', current_date, 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'active', 'manual');
insert into split_groups (id, name, member_account_ids) values
  ('a6000000-0000-4000-8000-000000000006', 'Flat', array['a0000000-0000-4000-8000-000000000003']::uuid[]);
insert into deposits (id, account_id, kind, amount_paise, rate_bp, start_date, maturity_date) values
  ('a6000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'fd', 10000000, 725, current_date, current_date + 365);
insert into holdings (id, account_id, scheme, units_e4, cost_paise, as_of) values
  ('a6000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'Index fund', 1234560, 5000000, current_date);
insert into ai_jobs (id, kind) values ('a6000000-0000-4000-8000-000000000009', 'month_review');
-- Who a person is (decision 0025): what she knows about Bala, and her own profile.
insert into person_identifiers (id, person_account_id, kind, value, source) values
  ('a6000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000003', 'upi', 'bala@okaxis', 'typed');
insert into my_identifiers (id, kind, value) values ('a6000000-0000-4000-8000-000000000012', 'upi', 'asha@okicici');

select is((select count(*)::int from accounts), 3, 'Asha reads her own accounts');
select is(
  (select count(*)::int from account_types) + (select count(*)::int from balance_anchors) + (select count(*)::int from rules)
  + (select count(*)::int from budgets) + (select count(*)::int from recurring) + (select count(*)::int from split_groups)
  + (select count(*)::int from deposits) + (select count(*)::int from holdings) + (select count(*)::int from ai_jobs)
  + (select count(*)::int from ai_usage),
  10, 'Asha reads her own row in each of the other tables');

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

-- Every other table: Bala reads none of Asha's rows, his updates change nothing,
-- and he can't point his own rows at her accounts.
select is((select count(*)::int from account_types), 0, 'Bala reads none of Asha''s account types');
select is((select count(*)::int from balance_anchors), 0, 'Bala reads none of Asha''s balance anchors');
select is((select count(*)::int from rules), 0, 'Bala reads none of Asha''s rules');
select is((select count(*)::int from budgets), 0, 'Bala reads none of Asha''s budgets');
select is((select count(*)::int from recurring), 0, 'Bala reads none of Asha''s recurring payments');
select is((select count(*)::int from split_groups), 0, 'Bala reads none of Asha''s groups');
select is((select count(*)::int from deposits), 0, 'Bala reads none of Asha''s deposits');
select is((select count(*)::int from holdings), 0, 'Bala reads none of Asha''s holdings');
select is((select count(*)::int from ai_jobs), 0, 'Bala reads none of Asha''s AI jobs');
select is((select count(*)::int from ai_usage), 0, 'Bala reads none of Asha''s AI usage');
select is((select count(*)::int from person_identifiers), 0, 'Bala reads none of what Asha knows about her people');
select is((select count(*)::int from my_identifiers), 0, 'Bala, not her friend, reads none of Asha''s profile');
update person_identifiers set value = 'hacked@ybl' where id = 'a6000000-0000-4000-8000-000000000011';
update my_identifiers set value = 'hacked@ybl' where id = 'a6000000-0000-4000-8000-000000000012';
select throws_ok(
  $$insert into person_identifiers (id, person_account_id, kind, value, source) values
    ('b6000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000003', 'upi', 'planted@ybl', 'typed')$$,
  '42501', null, 'Bala cannot add an identifier to Asha''s person');

update account_types set name = 'hacked' where id = 'a6000000-0000-4000-8000-000000000001';
update balance_anchors set balance_paise = 1 where id = 'a6000000-0000-4000-8000-000000000002';
update rules set status = 'paused' where id = 'a6000000-0000-4000-8000-000000000003';
update budgets set limit_paise = 1 where id = 'a6000000-0000-4000-8000-000000000004';
update recurring set amount_paise = 1 where id = 'a6000000-0000-4000-8000-000000000005';
update split_groups set name = 'hacked' where id = 'a6000000-0000-4000-8000-000000000006';
update deposits set amount_paise = 1 where id = 'a6000000-0000-4000-8000-000000000007';
update holdings set units_e4 = 0 where id = 'a6000000-0000-4000-8000-000000000008';

select throws_ok(
  $$insert into account_types (id, user_id, name, class) values ('b6000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'planted', 'asset')$$,
  '42501', null, 'Bala cannot add an account type as Asha');
select throws_ok(
  $$insert into balance_anchors (id, account_id, balance_paise, observed_at, source_id) values
    ('b6000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 1, now(), 'a3000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Bala cannot anchor the balance of Asha''s account');
select throws_ok(
  $$insert into rules (id, kind, status, match, category_account_id) values
    ('b6000000-0000-4000-8000-000000000003', 'rule', 'active', '{"kind":"rule"}', 'a0000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'Bala cannot add a rule on Asha''s category');
select throws_ok(
  $$insert into budgets (id, month, category_account_id, limit_paise) values
    ('b6000000-0000-4000-8000-000000000004', date_trunc('month', current_date)::date, 'a0000000-0000-4000-8000-000000000002', 1)$$,
  '42501', null, 'Bala cannot budget Asha''s category');
select throws_ok(
  $$insert into recurring (id, name, amount_paise, cadence, next_due, account_id, status, origin) values
    ('b6000000-0000-4000-8000-000000000005', 'x', 1, 'monthly', current_date, 'a0000000-0000-4000-8000-000000000001', 'active', 'manual')$$,
  '42501', null, 'Bala cannot add a recurring payment on Asha''s account');
select throws_ok(
  $$insert into split_groups (id, name, member_account_ids) values
    ('b6000000-0000-4000-8000-000000000006', 'x', array['a0000000-0000-4000-8000-000000000003']::uuid[])$$,
  '42501', null, 'Bala cannot put Asha''s people in a group');
select throws_ok(
  $$insert into deposits (id, account_id, kind, amount_paise, rate_bp, start_date, maturity_date) values
    ('b6000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'fd', 1, 1, current_date, current_date + 1)$$,
  '42501', null, 'Bala cannot add a deposit on Asha''s account');
select throws_ok(
  $$insert into holdings (id, account_id, scheme, units_e4, cost_paise, as_of) values
    ('b6000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'x', 1, 1, current_date)$$,
  '42501', null, 'Bala cannot add a holding on Asha''s account');
select throws_ok(
  $$insert into ai_jobs (id, user_id, kind) values ('b6000000-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001', 'month_review')$$,
  '42501', null, 'Bala cannot queue an AI job as Asha');
select throws_ok(
  $$insert into ai_jobs (id, kind) values ('b6000000-0000-4000-8000-000000000010', 'categorise')$$,
  '42501', null, 'categorise jobs come only from the categorise function');
select throws_ok(
  $$insert into ai_usage (user_id, month) values ('bbbbbbbb-0000-4000-8000-000000000002', date_trunc('month', current_date)::date)$$,
  '42501', null, 'nobody signed in writes AI usage');

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
select is(
  (select array[name] from account_types where id = 'a6000000-0000-4000-8000-000000000001')
  || (select array[split_groups.name] from split_groups where id = 'a6000000-0000-4000-8000-000000000006')
  || (select array[status] from rules where id = 'a6000000-0000-4000-8000-000000000003'),
  array['Gold', 'Flat', 'active'], 'Bala''s updates left Asha''s account type, group and rule as they were');
select is(
  array[
    (select balance_paise from balance_anchors where id = 'a6000000-0000-4000-8000-000000000002'),
    (select limit_paise from budgets where id = 'a6000000-0000-4000-8000-000000000004'),
    (select amount_paise from recurring where id = 'a6000000-0000-4000-8000-000000000005'),
    (select amount_paise from deposits where id = 'a6000000-0000-4000-8000-000000000007'),
    (select units_e4 from holdings where id = 'a6000000-0000-4000-8000-000000000008')
  ],
  array[90000, 500000, 64900, 10000000, 1234560]::bigint[], 'Bala''s updates left Asha''s anchor, budget, recurring payment, deposit and holding as they were');

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
select is(
  (select value from person_identifiers where id = 'a6000000-0000-4000-8000-000000000011') || ' ' ||
  (select value from my_identifiers where id = 'a6000000-0000-4000-8000-000000000012'),
  'bala@okaxis asha@okicici', 'Bala''s updates left Asha''s identifiers as they were');
select throws_ok(
  $$insert into person_identifiers (id, person_account_id, kind, value, source) values
    ('a6000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'upi', 'bank@ybl', 'typed')$$,
  '42501', null, 'identifiers go only on people, not on a bank account');

select * from finish();
rollback;
