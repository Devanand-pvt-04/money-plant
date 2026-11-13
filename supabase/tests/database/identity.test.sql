-- Who a person is (decision 0025): identifiers on people and the user's own
-- profile, which accepted friends read.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

set local session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com', 'authenticated', 'authenticated');
-- Asha and Bala are friends; Chitra is not.
insert into friend_links (id, user_id, requester_email, friend_email, friend_user_id, accepted_at) values
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'bala@example.com',
   'bbbbbbbb-0000-4000-8000-000000000002', now());
set local session_replication_role = origin;

create function pg_temp.act_as(p_id uuid, p_email text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated, anon;

-- ---- Asha's profile ----

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
insert into my_identifiers (id, kind, value, label, shared) values
  ('a1000000-0000-4000-8000-000000000001', 'upi', 'asha@okicici', null, true),
  ('a1000000-0000-4000-8000-000000000002', 'bank_account', '1234', 'hdfc', true),
  ('a1000000-0000-4000-8000-000000000003', 'phone', '9876543210', null, false),
  ('a1000000-0000-4000-8000-000000000004', 'payee_name', 'asha k', null, true);

select throws_ok(
  $$insert into my_identifiers (id, kind, value) values ('a1000000-0000-4000-8000-000000000005', 'upi', 'Not A UPI')$$,
  '23514', null, 'a value that is not a UPI ID is refused');
select throws_ok(
  $$insert into my_identifiers (id, kind, value) values ('a1000000-0000-4000-8000-000000000006', 'phone', '12345')$$,
  '23514', null, 'a phone that is not a 10-digit mobile is refused');
select throws_ok(
  $$insert into my_identifiers (id, kind, value, label) values ('a1000000-0000-4000-8000-000000000007', 'bank_account', '1234', 'HDFC Bank!')$$,
  '23514', null, 'a bank must be a short lower-case key');

-- ---- Bala, her friend, reads the shared part ----

select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com');
select is((select count(*)::int from my_identifiers), 3, 'Bala reads the three identifiers Asha shares');
select is((select count(*)::int from my_identifiers where kind = 'phone'), 0, 'Bala does not read the phone Asha keeps private');
update my_identifiers set value = 'hacked@ybl' where id = 'a1000000-0000-4000-8000-000000000001';
select throws_ok(
  $$insert into my_identifiers (id, user_id, kind, value) values ('b1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'upi', 'planted@ybl')$$,
  '42501', null, 'Bala cannot add to Asha''s profile');

-- ---- Chitra, not a friend, reads nothing ----

select pg_temp.act_as('cccccccc-0000-4000-8000-000000000003', 'chitra@example.com');
select is((select count(*)::int from my_identifiers), 0, 'Chitra reads none of Asha''s profile');

-- ---- Unlinking ends it ----

reset role;
update friend_links set deleted_at = now() where id = 'f0000000-0000-4000-8000-000000000001';
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com');
select is((select count(*)::int from my_identifiers), 0, 'after unlinking, Bala reads none of Asha''s profile');

-- ---- Asha's own rows ----

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
select is((select value from my_identifiers where id = 'a1000000-0000-4000-8000-000000000001'), 'asha@okicici', 'Bala''s update left Asha''s UPI ID as it was');
insert into accounts (id, type, name) values ('a0000000-0000-4000-8000-000000000001', 'person', 'Bala');
insert into person_identifiers (id, person_account_id, kind, value, source) values
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'payee_name', 'bala r', 'learned');
select is((select count(*)::int from person_identifiers), 1, 'Asha keeps a learned payee name on Bala');
select throws_ok(
  $$insert into person_identifiers (id, person_account_id, kind, value, source) values
    ('a2000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'payee_name', 'BALA', 'learned')$$,
  '23514', null, 'names are stored in their plain lower-case form');

select * from finish();
rollback;
