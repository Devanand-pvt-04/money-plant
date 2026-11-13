-- Who a person is (decision 0025). A person is one record with any number of
-- identifiers: UPI IDs, a mobile number, bank accounts (digits + bank) and the
-- payee names their banks print. Every payment is matched through them.
--
-- `person_identifiers` holds what this user knows about each of their people.
-- Ids are derived on the phone from the identifier itself (a strong one) or
-- from the identifier and the person (a payee name), so two phones learning
-- the same UPI ID write the same row and a strong identifier can't sit on two
-- people.
--
-- `my_identifiers` is the user's own profile: their UPI IDs, phone, bank
-- accounts and the names their banks print. Accepted friends read the ones
-- marked shared, so their phones recognise payments from any of them.
--
-- accounts.vpa stays the UPI ID used to pay a person. accounts.extra_vpas and
-- accounts.phone, and the extra UPI ID and phone columns on friend_links
-- (decision 0021), are copied here and no longer written by the app.

create function public.valid_identifier(p_kind text, p_value text, p_label text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    -- Postgres caps a regex repetition at 255, so the length is checked on its own.
    when 'upi' then p_value = lower(p_value) and length(p_value) <= 323 and p_value ~ '^[a-z0-9._-]{2,}@[a-z][a-z0-9.-]{1,64}$'
    when 'phone' then p_value ~ '^[6-9][0-9]{9}$'
    when 'bank_account' then p_value ~ '^[0-9]{3,18}$' and (p_label is null or p_label ~ '^[a-z]{2,20}$')
    when 'payee_name' then p_value ~ '^[a-z]+( [a-z]+)*$' and length(p_value) between 2 and 80
    else false
  end;
$$;

revoke all on function public.valid_identifier(text, text, text) from public, anon;
grant execute on function public.valid_identifier(text, text, text) to authenticated;

-- ---- What the user knows about their people ----

create table public.person_identifiers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('upi', 'phone', 'bank_account', 'payee_name')),
  value text not null,
  -- The bank of a bank account ("hdfc"); null for other kinds.
  label text,
  source text not null check (source in ('typed', 'learned', 'friend', 'contact')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (public.valid_identifier(kind, value, label))
);

create index person_identifiers_user_updated_idx on public.person_identifiers (user_id, updated_at);
create index person_identifiers_person_idx on public.person_identifiers (person_account_id);

create trigger person_identifiers_set_updated_at before insert or update on public.person_identifiers
for each row execute function public.set_updated_at();

alter table public.person_identifiers enable row level security;

create function public.owns_person(p_account uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account and a.user_id = (select auth.uid()) and a.type = 'person'
  );
$$;

revoke all on function public.owns_person(uuid) from public, anon;
grant execute on function public.owns_person(uuid) to authenticated;

create policy "Users read their own people's identifiers" on public.person_identifiers for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users add identifiers to their own people" on public.person_identifiers for insert
to authenticated with check ((select auth.uid()) = user_id and public.owns_person(person_account_id));
create policy "Users change their own people's identifiers" on public.person_identifiers for update
to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id and public.owns_person(person_account_id));

revoke all on public.person_identifiers from anon;
grant select, insert, update on public.person_identifiers to authenticated;

-- ---- The user's own profile ----

create table public.my_identifiers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('upi', 'phone', 'bank_account', 'payee_name')),
  value text not null,
  label text,
  -- Friends see it. A bank account is only ever its digits as typed (last 4 by default) and its bank.
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (public.valid_identifier(kind, value, label))
);

create index my_identifiers_user_idx on public.my_identifiers (user_id, updated_at);

create trigger my_identifiers_set_updated_at before insert or update on public.my_identifiers
for each row execute function public.set_updated_at();

alter table public.my_identifiers enable row level security;

-- Two users with an accepted, live friend link (ACC-9).
create function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.friend_links l
    where l.accepted_at is not null and l.declined_at is null and l.deleted_at is null
      and ((l.user_id = p_a and l.friend_user_id = p_b) or (l.user_id = p_b and l.friend_user_id = p_a))
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

create policy "Users read their own profile, friends its shared part" on public.my_identifiers for select
to authenticated using (
  (select auth.uid()) = user_id
  or (shared and deleted_at is null and public.are_friends((select auth.uid()), user_id))
);
create policy "Users add to their own profile" on public.my_identifiers for insert
to authenticated with check ((select auth.uid()) = user_id);
create policy "Users change their own profile" on public.my_identifiers for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.my_identifiers from anon;
grant select, insert, update on public.my_identifiers to authenticated;

-- ---- Copy what decision 0021 stored ----

-- The same derived id the phone makes: sha256("<user>:<name>") shaped like a UUID.
create function pg_temp.derived_id(p_user uuid, p_name text) returns uuid language sql as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-5' || substr(h, 14, 3) || '-8' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to(p_user::text || ':' || p_name, 'UTF8')), 'hex') as h) x
$$;

insert into public.person_identifiers (id, user_id, person_account_id, kind, value, source)
select distinct on (a.user_id, v.kind, v.value)
       pg_temp.derived_id(a.user_id, 'identifier:' || v.kind || ':' || v.value), a.user_id, a.id, v.kind, v.value, 'typed'
from public.accounts a
cross join lateral (
  select 'upi' as kind, lower(a.vpa) as value where a.vpa is not null
  union all select 'upi', lower(e) from unnest(a.extra_vpas) e
  union all select 'phone', a.phone where a.phone is not null
) v
where a.type = 'person' and a.deleted_at is null and public.valid_identifier(v.kind, v.value, null)
order by a.user_id, v.kind, v.value, a.created_at
on conflict (id) do nothing;

insert into public.my_identifiers (id, user_id, kind, value)
select distinct on (u.id, v.kind, v.value)
       pg_temp.derived_id(u.id, 'me:' || v.kind || ':' || v.value), u.id, v.kind, v.value
from auth.users u
cross join lateral (
  select 'upi' as kind, lower(u.raw_user_meta_data->>'vpa') as value where u.raw_user_meta_data->>'vpa' is not null
  union all select 'upi', lower(e) from jsonb_array_elements_text(
    case when jsonb_typeof(u.raw_user_meta_data->'extra_vpas') = 'array' then u.raw_user_meta_data->'extra_vpas' else '[]'::jsonb end) e
  union all select 'phone', u.raw_user_meta_data->>'phone' where u.raw_user_meta_data->>'phone' is not null
) v
where public.valid_identifier(v.kind, v.value, null)
order by u.id, v.kind, v.value
on conflict (id) do nothing;

-- ---- Clearing data also clears what the user knew about their people ----

create or replace function public.clear_my_data()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- What friends can see becomes an empty, deleted row.
  update public.iou_payments p set deleted_at = coalesce(p.deleted_at, now()), transaction_id = null
  where p.user_id = me
    and exists (select 1 from public.ious i where i.id = p.iou_id and (i.user_id <> me or i.counterparty_email is not null));
  update public.ious set
    deleted_at = coalesce(deleted_at, now()),
    reason = null,
    owner_name = null,
    owner_vpa = null,
    transaction_id = null
  where user_id = me and counterparty_email is not null;
  update public.accounts a set
    deleted_at = coalesce(a.deleted_at, now()),
    name = 'Removed',
    vpa = null,
    email = null,
    extra_vpas = '{}',
    phone = null
  where a.user_id = me
    and exists (select 1 from public.ious i where i.person_account_id = a.id and i.user_id = me);

  -- Friends' IOUs shared with this user: take this user's side off.
  update public.ious set
    counterparty_user_id = null,
    counterparty_person_account_id = null,
    counterparty_transaction_id = null,
    counterparty_vpa = null,
    confirmed_at = null,
    declined_at = null
  where counterparty_user_id = me and user_id <> me;

  -- Everything else goes. Postings and sources cascade from transactions.
  delete from public.person_identifiers where user_id = me;
  delete from public.balance_anchors where user_id = me;
  delete from public.transactions where user_id = me;
  delete from public.rules where user_id = me;
  delete from public.budgets where user_id = me;
  delete from public.recurring where user_id = me;
  delete from public.split_groups where user_id = me;
  delete from public.ious where user_id = me and counterparty_email is null;
  delete from public.accounts a
  where a.user_id = me
    and not exists (select 1 from public.ious i where i.person_account_id = a.id);
  delete from public.account_types where user_id = me;
  delete from public.ai_usage where user_id = me;

  return now();
end;
$$;

revoke all on function public.clear_my_data() from public, anon;
grant execute on function public.clear_my_data() to authenticated;
