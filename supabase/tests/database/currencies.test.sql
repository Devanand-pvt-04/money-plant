-- Multiple currencies (decision 0017, LED-11, ACC-12): postings balance in
-- each currency, an account's postings are in its own currency, and an
-- account's currency is fixed once it has entries.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

set local session_replication_role = replica;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'asha@example.com', 'authenticated', 'authenticated');
set local session_replication_role = origin;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"asha@example.com","role":"authenticated"}', true);

insert into accounts (id, type, name, currency) values
  ('a0000000-0000-4000-8000-000000000001', 'bank', 'HDFC savings', 'INR'),
  ('a0000000-0000-4000-8000-000000000002', 'bank', 'Wise USD', 'USD'),
  ('a0000000-0000-4000-8000-000000000003', 'category', 'Food', 'INR'),
  ('a0000000-0000-4000-8000-000000000004', 'exchange', 'Currency exchange', 'INR'),
  ('a0000000-0000-4000-8000-000000000005', 'bank', 'New account', 'INR');

create function pg_temp.entry(p_id text, p_postings jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'id', p_id, 'occurred_at', now(), 'kind', 'expense', 'status', 'confirmed', 'confidence', 1,
    'postings', p_postings,
    'sources', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'kind', 'manual', 'fingerprint', p_id, 'received_at', now(), 'confidence', 1))));
$$;
grant execute on function pg_temp.entry(text, jsonb) to authenticated;

select lives_ok(
  $$select push_transactions(pg_temp.entry('a1000000-0000-4000-8000-000000000001', '[
    {"id":"a2000000-0000-4000-8000-000000000001","account_id":"a0000000-0000-4000-8000-000000000002","amount_paise":-2500,"currency":"USD"},
    {"id":"a2000000-0000-4000-8000-000000000002","account_id":"a0000000-0000-4000-8000-000000000003","amount_paise":2500,"currency":"USD"}]'))$$,
  'a $25 lunch from a USD account balances in dollars');

select lives_ok(
  $$select push_transactions(pg_temp.entry('a1000000-0000-4000-8000-000000000002', '[
    {"id":"a2000000-0000-4000-8000-000000000003","account_id":"a0000000-0000-4000-8000-000000000001","amount_paise":-8350000,"currency":"INR"},
    {"id":"a2000000-0000-4000-8000-000000000004","account_id":"a0000000-0000-4000-8000-000000000004","amount_paise":8350000,"currency":"INR"},
    {"id":"a2000000-0000-4000-8000-000000000005","account_id":"a0000000-0000-4000-8000-000000000004","amount_paise":-100000,"currency":"USD"},
    {"id":"a2000000-0000-4000-8000-000000000006","account_id":"a0000000-0000-4000-8000-000000000002","amount_paise":100000,"currency":"USD"}]'))$$,
  'rupees into dollars balances each currency through the exchange account');

select throws_ok(
  $$select push_transactions(pg_temp.entry('a1000000-0000-4000-8000-000000000003', '[
    {"id":"a2000000-0000-4000-8000-000000000007","account_id":"a0000000-0000-4000-8000-000000000001","amount_paise":-8350000,"currency":"INR"},
    {"id":"a2000000-0000-4000-8000-000000000008","account_id":"a0000000-0000-4000-8000-000000000002","amount_paise":8350000,"currency":"USD"}]'))$$,
  '23514', null,
  'rupees out and dollars in do not balance each other');

select throws_ok(
  $$select push_transactions(pg_temp.entry('a1000000-0000-4000-8000-000000000004', '[
    {"id":"a2000000-0000-4000-8000-000000000009","account_id":"a0000000-0000-4000-8000-000000000001","amount_paise":-2500,"currency":"USD"},
    {"id":"a2000000-0000-4000-8000-000000000010","account_id":"a0000000-0000-4000-8000-000000000003","amount_paise":2500,"currency":"USD"}]'))$$,
  '23514', null,
  'a rupee account refuses a posting in dollars');

select push_transactions(pg_temp.entry('a1000000-0000-4000-8000-000000000005', '[
  {"id":"a2000000-0000-4000-8000-000000000011","account_id":"a0000000-0000-4000-8000-000000000001","amount_paise":-45000},
  {"id":"a2000000-0000-4000-8000-000000000012","account_id":"a0000000-0000-4000-8000-000000000003","amount_paise":45000}]'));
select is(
  (select array_agg(distinct currency) from postings where transaction_id = 'a1000000-0000-4000-8000-000000000005')::text,
  '{INR}', 'a phone from before currencies sends none, and its postings are rupees');

select throws_ok(
  $$update accounts set currency = 'EUR' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'an account with entries keeps its currency');

update accounts set currency = 'AED' where id = 'a0000000-0000-4000-8000-000000000005';
select is((select currency from accounts where id = 'a0000000-0000-4000-8000-000000000005'), 'AED',
  'an empty account can change currency');

select throws_ok(
  $$update accounts set currency = 'dollars' where id = 'a0000000-0000-4000-8000-000000000005'$$,
  '23514', null,
  'a currency is a three-letter code');

select * from finish();
rollback;
