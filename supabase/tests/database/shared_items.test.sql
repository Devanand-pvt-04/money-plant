-- Shared items (decision 0026): one row both people read, answered by the
-- other side, linked by each side to its own ledger.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

set local session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com', 'authenticated', 'authenticated');
-- Asha and Bala are friends; Chitra is no one's friend.
insert into friend_links (id, user_id, requester_email, friend_email, friend_user_id, accepted_at) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'bala@example.com',
   'bbbbbbbb-0000-4000-8000-000000000002', now());
set local session_replication_role = origin;

create function pg_temp.act_as(p_id uuid, p_email text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated, anon;

-- ---- Asha splits dinner with Bala and lends Chitra money ----

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
insert into accounts (id, type, name) values
  ('a0000000-0000-4000-8000-000000000001', 'bank', 'Asha savings'),
  ('a0000000-0000-4000-8000-000000000002', 'person', 'Bala');
insert into transactions (id, occurred_at, kind, status, confidence) values
  ('a1000000-0000-4000-8000-000000000001', now(), 'expense', 'confirmed', 1);
insert into shared_items (id, kind, flow, amount_paise, occurred_on, reason, category_name, counterparty_email, counterparty_user_id, answer) values
  ('a5000000-0000-4000-8000-000000000001', 'share', 'to_them', 60000, current_date, 'Dinner', 'Food', 'bala@example.com', null, 'accepted');
insert into shared_items (id, kind, flow, amount_paise, occurred_on, counterparty_email) values
  ('a5000000-0000-4000-8000-000000000002', 'loan', 'to_them', 50000, current_date, 'chitra@example.com');

select is((select counterparty_user_id from shared_items where id = 'a5000000-0000-4000-8000-000000000001'),
  'bbbbbbbb-0000-4000-8000-000000000002'::uuid, 'the server finds Bala, a friend, from his email');
select is((select answer from shared_items where id = 'a5000000-0000-4000-8000-000000000001'), null,
  'Asha cannot answer her own share');
select is((select counterparty_user_id from shared_items where id = 'a5000000-0000-4000-8000-000000000002'), null,
  'Chitra is not a friend, so the loan stays one-sided');
insert into item_links (id, item_id, person_account_id, transaction_id) values
  ('a6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001');
select is((select count(*)::int from item_links), 1, 'Asha links the share to her own bank entry');
select throws_ok(
  $$insert into item_links (id, item_id, person_account_id) values
    ('a6000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a link points only at one of her people, not a bank account');

-- ---- Bala answers ----

select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com');
select is((select count(*)::int from shared_items), 1, 'Bala reads only the item with him');
select is((select count(*)::int from item_links), 0, 'Bala reads none of Asha''s links');
update shared_items set amount_paise = 1 where id = 'a5000000-0000-4000-8000-000000000001';
select lives_ok($$select answer_shared_item('a5000000-0000-4000-8000-000000000001', true)$$, 'Bala accepts the share');
insert into accounts (id, type, name) values ('b0000000-0000-4000-8000-000000000001', 'person', 'Asha');
insert into transactions (id, occurred_at, kind, status, confidence) values
  ('b1000000-0000-4000-8000-000000000001', now(), 'expense', 'confirmed', 1);
insert into item_links (id, item_id, person_account_id, transaction_id) values
  ('b6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001');
select is((select count(*)::int from item_links), 1, 'Bala links it to the entry his phone made');
update item_links set linked_kind = 'share', linked_flow = 'to_me', linked_paise = 60000, linked_currency = 'INR'
where id = 'b6000000-0000-4000-8000-000000000001';
select is((select linked_paise::int from item_links), 60000, 'Bala''s link records what his entry carries');
select throws_ok(
  $$update item_links set linked_paise = null where id = 'b6000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'what an entry carries is recorded whole or not at all');
select throws_ok(
  $$insert into item_links (id, item_id, person_account_id, transaction_id) values
    ('b6000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Bala cannot link Asha''s entry');
select throws_ok(
  $$insert into shared_items (id, user_id, kind, flow, amount_paise, occurred_on) values
    ('b5000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'loan', 'to_me', 100, current_date)$$,
  '42501', null, 'Bala cannot create an item as Asha');
select throws_ok($$select answer_shared_item('a5000000-0000-4000-8000-000000000002', true)$$, '42501', null,
  'Bala cannot answer an item that is not his');

-- ---- Chitra sees nothing ----

select pg_temp.act_as('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com');
select is((select count(*)::int from shared_items), 0, 'Chitra reads nothing, not even the loan with her email');
select throws_ok($$select answer_shared_item('a5000000-0000-4000-8000-000000000001', false)$$, '42501', null,
  'Chitra cannot answer Bala''s share');
select throws_ok(
  $$insert into item_links (id, item_id, person_account_id) values
    ('c6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Chitra cannot link an item she is not part of');

-- ---- Asha sees the answer and changes the share ----

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
select is((select amount_paise::int || ' ' || answer from shared_items where id = 'a5000000-0000-4000-8000-000000000001'),
  '60000 accepted', 'Bala''s update was ignored and his answer reached Asha');
update shared_items set reason = 'Dinner at Anna''s' where id = 'a5000000-0000-4000-8000-000000000001';
select is((select answer from shared_items where id = 'a5000000-0000-4000-8000-000000000001'), 'accepted', 'a new reason keeps the answer');
update shared_items set amount_paise = 70000 where id = 'a5000000-0000-4000-8000-000000000001';
select is((select answer from shared_items where id = 'a5000000-0000-4000-8000-000000000001'), null, 'a new amount asks Bala again');
update shared_items set counterparty_email = 'chitra@example.com' where id = 'a5000000-0000-4000-8000-000000000001';
select is((select counterparty_user_id from shared_items where id = 'a5000000-0000-4000-8000-000000000001'), null,
  'moving it to someone who is not a friend takes it off Bala');
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com');
select is((select count(*)::int from shared_items), 0, 'and Bala no longer reads it');

-- ---- Chitra becomes Asha's friend: items with her email reach her ----

reset role;
insert into friend_links (id, user_id, requester_email, friend_email) values
  ('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'chitra@example.com');
update friend_links set friend_user_id = 'cccccccc-0000-4000-8000-000000000003', accepted_at = now()
where id = 'f0000000-0000-4000-8000-000000000002';
select pg_temp.act_as('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com');
select is((select count(*)::int from shared_items), 2, 'once linked, Chitra reads the loan and the share moved to her');

-- ---- Decision 0027: settled another way ----

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
insert into shared_items (id, kind, flow, amount_paise, occurred_on, counterparty_email, settled_outside) values
  ('a5000000-0000-4000-8000-000000000009', 'repayment', 'to_me', 25300, '2026-11-13', 'bala@example.com', true);
select is((select settled_outside from shared_items where id = 'a5000000-0000-4000-8000-000000000009'), true,
  'a repayment can be settled outside the app');
select throws_ok(
  $$insert into shared_items (id, kind, flow, amount_paise, occurred_on, settled_outside) values
    ('a5000000-0000-4000-8000-00000000000a', 'share', 'to_them', 100, '2026-11-13', true)$$,
  '23514', null, 'only a repayment can be settled outside the app');
select lives_ok(
  $$insert into accounts (id, type, name) values ('a0000000-0000-4000-8000-0000000000aa', 'settled', 'Settled outside the app')$$,
  'each user can have a hidden settled-outside account');

select * from finish();
rollback;
