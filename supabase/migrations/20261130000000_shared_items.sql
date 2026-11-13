-- Shared items (decision 0026): what two people owe each other, as one row
-- both read. Replaces ious, iou_payments and split_groups, which the app stops
-- using in the next step and a later migration drops.
--
-- Three kinds, each saying exactly what goes into each ledger:
--   share:     one paid for something the other owes part of. No money moves
--              for the person who owes; their phone adds spending plus
--              "I owe", with no bank leg.
--   loan:      money moved from one to the other.
--   repayment: money moved back.
-- `flow` is from the creator's side: 'to_them' when value went from the
-- creator to the other person (they now owe the creator more, or the creator
-- owes them less), 'to_me' the other way.
--
-- Only the creator changes an item. The other person answers a share
-- (accept or decline) through answer_shared_item. Each side links the item to
-- its own ledger entry in item_links, which only that side reads.

create table public.shared_items (
  id uuid primary key,
  -- The creator.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('share', 'loan', 'repayment')),
  flow text not null check (flow in ('to_them', 'to_me')),
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  occurred_on date not null,
  reason text check (length(reason) <= 120),
  -- For a share: the creator's category name, suggested to the other person.
  category_name text check (length(category_name) <= 60),
  -- Groups come in a later step; items of one group bill share this id.
  group_ref uuid,
  -- The other person on Money Plant. Null for someone who isn't: the item is
  -- then one-sided, on the creator's phone only.
  counterparty_email text check (counterparty_email = lower(counterparty_email) and length(counterparty_email) <= 254),
  -- Set by the server when the email is an accepted friend's.
  counterparty_user_id uuid references auth.users (id) on delete set null,
  -- The other person's answer to a share. Loans and repayments need none.
  answer text check (answer in ('accepted', 'declined')),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index shared_items_user_updated_idx on public.shared_items (user_id, updated_at);
create index shared_items_counterparty_updated_idx on public.shared_items (counterparty_user_id, updated_at);

create trigger shared_items_set_updated_at before insert or update on public.shared_items
for each row execute function public.set_updated_at();

-- The caller's accepted friend with this email, if any.
create function public.friend_with_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where p_email is not null and lower(u.email) = lower(p_email) and public.are_friends((select auth.uid()), u.id)
  limit 1;
$$;

revoke all on function public.friend_with_email(text) from public, anon;
grant execute on function public.friend_with_email(text) to authenticated;

-- The creator writes everything but the answer. The other side is found from
-- the email, and only among accepted friends. A changed amount, kind or flow
-- on a share asks again; a change of person starts over. answer_shared_item
-- runs as the table owner, so it passes through.
create function public.shared_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  if tg_op = 'INSERT' or new.counterparty_email is distinct from old.counterparty_email then
    new.counterparty_user_id := public.friend_with_email(new.counterparty_email);
    new.answer := null;
    new.answered_at := null;
  else
    new.counterparty_user_id := old.counterparty_user_id;
    if new.kind is distinct from old.kind or new.flow is distinct from old.flow or new.amount_paise is distinct from old.amount_paise
       or new.currency is distinct from old.currency then
      new.answer := null;
      new.answered_at := null;
    else
      new.answer := old.answer;
      new.answered_at := old.answered_at;
    end if;
  end if;
  if new.kind <> 'share' then
    new.answer := null;
    new.answered_at := null;
  end if;
  return new;
end;
$$;

create trigger shared_items_guard before insert or update on public.shared_items
for each row execute function public.shared_items_guard();

alter table public.shared_items enable row level security;

create policy "People read items they are part of" on public.shared_items for select
to authenticated using ((select auth.uid()) = user_id or (select auth.uid()) = counterparty_user_id);
create policy "Users create their own items" on public.shared_items for insert
to authenticated with check ((select auth.uid()) = user_id);
create policy "Creators change their items" on public.shared_items for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.shared_items from anon;
grant select, insert, update on public.shared_items to authenticated;

-- The other person accepts or declines a share.
create function public.answer_shared_item(p_id uuid, p_accept boolean)
returns void
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
  update public.shared_items i set
    answer = case when p_accept then 'accepted' else 'declined' end,
    answered_at = now()
  where i.id = p_id and i.deleted_at is null and i.kind = 'share' and i.counterparty_user_id = me;
  if not found then
    raise exception 'item % is not a share with you', p_id using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.answer_shared_item(uuid, boolean) from public, anon;
grant execute on function public.answer_shared_item(uuid, boolean) to authenticated;

-- Whether the caller is part of an item (creator or the other side).
create function public.part_of_item(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shared_items i
    where i.id = p_item and ((select auth.uid()) = i.user_id or (select auth.uid()) = i.counterparty_user_id)
  );
$$;

revoke all on function public.part_of_item(uuid) from public, anon;
grant execute on function public.part_of_item(uuid) to authenticated;

-- ---- Each side's link to its own ledger ----

create table public.item_links (
  -- Derived on the phone from the item, so each user has one link per item.
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.shared_items (id) on delete cascade,
  -- This user's person for the other side.
  person_account_id uuid not null references public.accounts (id) on delete cascade,
  -- This user's own entry for the item: their bank entry, or the entry the
  -- app made for an accepted share. Null until linked.
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index item_links_user_updated_idx on public.item_links (user_id, updated_at);
create index item_links_item_idx on public.item_links (item_id);

create trigger item_links_set_updated_at before insert or update on public.item_links
for each row execute function public.set_updated_at();

alter table public.item_links enable row level security;

create function public.owns_transaction(p_tx uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tx is null or exists (select 1 from public.transactions t where t.id = p_tx and t.user_id = (select auth.uid()));
$$;

revoke all on function public.owns_transaction(uuid) from public, anon;
grant execute on function public.owns_transaction(uuid) to authenticated;

create policy "Users read their own links" on public.item_links for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users link items they are part of to their own ledger" on public.item_links for insert
to authenticated with check (
  (select auth.uid()) = user_id and public.part_of_item(item_id)
  and public.owns_person(person_account_id) and public.owns_transaction(transaction_id)
);
create policy "Users change their own links" on public.item_links for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and public.part_of_item(item_id)
  and public.owns_person(person_account_id) and public.owns_transaction(transaction_id)
);

revoke all on public.item_links from anon;
grant select, insert, update on public.item_links to authenticated;

-- Items made before two people became friends reach the other side when the
-- link is accepted.
create function public.attach_items_to_friend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is not null and new.declined_at is null and new.deleted_at is null and new.friend_user_id is not null then
    update public.shared_items i set counterparty_user_id = new.friend_user_id
    where i.user_id = new.user_id and i.counterparty_user_id is null and i.counterparty_email = lower(new.friend_email);
    update public.shared_items i set counterparty_user_id = new.user_id
    where i.user_id = new.friend_user_id and i.counterparty_user_id is null and i.counterparty_email = lower(new.requester_email);
  end if;
  return null;
end;
$$;

revoke all on function public.attach_items_to_friend() from public, anon, authenticated;

create trigger friend_links_attach_items after insert or update on public.friend_links
for each row execute function public.attach_items_to_friend();

-- A friend's new item or answer shows up within seconds.
alter publication supabase_realtime add table public.shared_items;

-- ---- Clearing data ----

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
  update public.shared_items set
    deleted_at = coalesce(deleted_at, now()),
    reason = null,
    category_name = null
  where user_id = me;
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
  delete from public.item_links where user_id = me;
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
