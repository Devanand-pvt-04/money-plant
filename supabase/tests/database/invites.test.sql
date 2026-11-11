-- Invites and friend links (ACC-8, ACC-9, decision 0016).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(28);

-- Two members already exist (created before the door, so its triggers are skipped).
set local session_replication_role = replica;
insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated', '{"name":"Asha","vpa":"asha@okicici"}', '{}'),
  ('dddddddd-0000-4000-8000-000000000004', 'deva@example.com', 'authenticated', 'authenticated', '{}', '{"role":"admin"}');
set local session_replication_role = origin;

create function pg_temp.act_as(p_id uuid, p_email text, p_app jsonb default '{}', p_meta jsonb default '{}') returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', p_email, 'role', 'authenticated',
           'app_metadata', p_app, 'user_metadata', p_meta)::text, true);
$$;
grant execute on function pg_temp.act_as(uuid, text, jsonb, jsonb) to authenticated, anon;

-- ---- The door ----

select throws_ok(
  $$insert into auth.users (id, email, aud, role) values ('eeeeeeee-0000-4000-8000-000000000005', 'stranger@example.com', 'authenticated', 'authenticated')$$,
  'P0001', 'not invited', 'an email with no invite cannot sign up');

select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', '{}', '{"name":"Asha","vpa":"asha@okicici"}');
select is(invite_friend('a8000000-0000-4000-8000-000000000001', ' Bala@Example.com '), 'invited', 'Asha invites Bala');
select is(invite_friend('a8000000-0000-4000-8000-000000000009', 'bala@example.com'), 'invited', 'inviting the same email again changes nothing');
select is((select count(*)::int from invites), 1, 'Asha has one invite');
select throws_ok($$select invite_friend('a8000000-0000-4000-8000-000000000002', 'asha@example.com')$$, '22023', 'that is you', 'Asha cannot invite herself');
select throws_ok($$select invite_friend('a8000000-0000-4000-8000-000000000002', 'not-an-email')$$, '22023', 'not an email', 'a typo is refused');
select throws_ok(
  $$insert into invites (id, email) values ('a8000000-0000-4000-8000-000000000003', 'sneaky@example.com')$$,
  '42501', null, 'invites are made only through invite_friend');

-- The limit: 5 for a member.
select invite_friend('a8000000-0000-4000-8000-000000000011', 'p1@example.com');
select invite_friend('a8000000-0000-4000-8000-000000000012', 'p2@example.com');
select invite_friend('a8000000-0000-4000-8000-000000000013', 'p3@example.com');
select invite_friend('a8000000-0000-4000-8000-000000000014', 'p4@example.com');
select throws_ok($$select invite_friend('a8000000-0000-4000-8000-000000000015', 'p5@example.com')$$, 'P0001', 'invite limit reached', 'a member has at most 5 invites');
update invites set deleted_at = now() where email = 'p4@example.com';
select is(invite_friend('a8000000-0000-4000-8000-000000000016', 'p5@example.com'), 'invited', 'withdrawing an invite frees its place');
select throws_ok($$update invites set deleted_at = null where email = 'p4@example.com'$$, 'P0001', null, 'a withdrawn invite stays withdrawn');
update invites set email = 'changed@example.com' where email = 'p5@example.com';
select is((select count(*)::int from invites where email = 'p5@example.com' and deleted_at is null), 1, 'an invite''s email cannot be changed');

-- An admin has no limit.
select pg_temp.act_as('dddddddd-0000-4000-8000-000000000004', 'deva@example.com', '{"role":"admin"}');
select invite_friend(gen_random_uuid(), 'd' || n || '@example.com') from generate_series(1, 6) n;
select is((select count(*)::int from invites), 6, 'an admin can invite more than 5');
select is((select count(*)::int from invites where email like 'p%'), 0, 'an admin reads only their own invites');

-- Bala signs up: the invite is used and Asha and Bala are linked.
reset role;
select lives_ok(
  $$insert into auth.users (id, email, aud, role, raw_user_meta_data) values ('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com', 'authenticated', 'authenticated', '{}')$$,
  'an invited email can sign up');
select isnt((select used_at from invites where email = 'bala@example.com'), null, 'Bala''s invite is marked used');
select is(
  (select accepted_at is not null and requester_name = 'Asha' and requester_vpa = 'asha@okicici' from friend_links
   where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and friend_user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  true, 'signing up links Bala with Asha, with Asha''s name and UPI ID');

-- ---- Friend links ----

select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002', 'bala@example.com');
select is((select count(*)::int from friend_links), 1, 'Bala sees the link to Asha');
select lives_ok(
  $$select respond_friend_link((select id from friend_links limit 1), true, 'Bala K', 'bala@okhdfc')$$,
  'Bala adds his name and UPI ID to the link');
select lives_ok(
  $$select respond_friend_link((select id from friend_links limit 1), true, 'Bala K', 'bala@okhdfc', array['bala.k@oksbi', '9876543210@ybl'], '9876543210')$$,
  'Bala adds his other UPI IDs and phone (decision 0021)');
select is((select friend_extra_vpas from friend_links limit 1), array['bala.k@oksbi', '9876543210@ybl'], 'the link carries Bala''s other UPI IDs');
select throws_ok(
  $$select respond_friend_link((select id from friend_links limit 1), true, 'Bala K', 'bala@okhdfc', array['Not A UPI'], null)$$,
  '22023', null, 'something that is not a UPI ID is refused');
select is(invite_friend(gen_random_uuid(), 'asha@example.com'), 'already_linked', 'Bala inviting Asha finds the existing link');
select is(invite_friend('b8000000-0000-4000-8000-000000000001', 'deva@example.com'), 'requested', 'inviting a member sends a friend request');
update friend_links set accepted_at = now(), friend_name = 'fake' where friend_email = 'deva@example.com';
select is((select accepted_at from friend_links where friend_email = 'deva@example.com'), null, 'a requester cannot accept their own request');
update friend_links set friend_extra_vpas = array['fake@okaxis'], friend_phone = '9999999999' where friend_email = 'deva@example.com';
select is((select cardinality(friend_extra_vpas) = 0 and friend_phone is null from friend_links where friend_email = 'deva@example.com'), true, 'a requester cannot write the friend''s other UPI IDs or phone');

-- Deva sees the request; Asha does not.
select pg_temp.act_as('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com');
select is((select count(*)::int from friend_links where friend_email = 'deva@example.com'), 0, 'Asha cannot see a request between Bala and Deva');
select throws_ok($$select respond_friend_link('b8000000-0000-4000-8000-000000000001', true, 'x', null)$$, '42501', null, 'Asha cannot answer it');
select pg_temp.act_as('dddddddd-0000-4000-8000-000000000004', 'deva@example.com');
select lives_ok($$select unlink_friend('b8000000-0000-4000-8000-000000000001')$$, 'Deva can unlink a request sent to him');

select * from finish();
rollback;
