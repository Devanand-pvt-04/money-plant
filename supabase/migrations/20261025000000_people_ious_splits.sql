-- Milestone 4: people, IOUs, splits and groups (IOU-1 to IOU-5, SPL-1 to SPL-3).
--
-- People are person accounts in each user's own ledger. An IOU is one row that
-- both people can see when the owner adds the other person's email: the other
-- person sees it once they sign in with that address, and confirms or declines
-- it through respond_iou. Each side records the repayments its own ledger saw
-- in iou_payments; what is still owed is the amount minus the larger side's
-- total, worked out on the phone.

-- ---- Ledger: repayments and loans are their own kind of entry ----

alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('expense', 'income', 'transfer', 'adjustment', 'iou'));

-- ---- People: a UPI ID to pay and match, and an email to share IOUs ----

alter table public.accounts
  add column vpa text check (length(vpa) <= 256),
  add column email text check (email = lower(email) and length(email) <= 254);
alter table public.accounts add constraint accounts_person_fields_check
  check (type = 'person' or (vpa is null and email is null));

-- ---- IOUs ----

create table public.ious (
  id uuid primary key,
  -- The owner: the person who recorded it.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name text check (length(owner_name) <= 80),
  -- Set by the server from the owner's sign-in, so the other side knows who it is.
  owner_email text,
  owner_vpa text check (length(owner_vpa) <= 256),
  person_account_id uuid not null references public.accounts (id),
  -- From the owner's side.
  direction text not null check (direction in ('lent', 'borrowed')),
  amount_paise bigint not null check (amount_paise > 0),
  reason text check (length(reason) <= 200),
  occurred_on date not null,
  due_date date,
  -- The owner's ledger entry for the loan. No foreign key: it may arrive later.
  transaction_id uuid,
  -- Sharing (IOU-2). Only respond_iou writes the counterparty_* columns and the response times.
  counterparty_email text check (counterparty_email = lower(counterparty_email) and length(counterparty_email) <= 254),
  counterparty_user_id uuid references auth.users (id) on delete set null,
  counterparty_person_account_id uuid references public.accounts (id) on delete set null,
  counterparty_transaction_id uuid,
  counterparty_vpa text check (length(counterparty_vpa) <= 256),
  confirmed_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index ious_user_updated_idx on public.ious (user_id, updated_at);
create index ious_counterparty_user_idx on public.ious (counterparty_user_id, updated_at);
create index ious_counterparty_email_idx on public.ious (counterparty_email, updated_at);
create trigger ious_set_updated_at before insert or update on public.ious
for each row execute function public.set_updated_at();

-- Keeps the owner from writing the other side's fields, and asks the other
-- side to confirm again when the amount, direction or due date changes.
create function public.ious_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_email := lower(auth.jwt()->>'email');
    new.counterparty_user_id := null;
    new.counterparty_person_account_id := null;
    new.counterparty_transaction_id := null;
    new.counterparty_vpa := null;
    new.confirmed_at := null;
    new.declined_at := null;
    return new;
  end if;
  if (select auth.uid()) = old.user_id then
    new.owner_email := old.owner_email;
    if new.counterparty_email is distinct from old.counterparty_email then
      new.counterparty_user_id := null;
      new.counterparty_person_account_id := null;
      new.counterparty_transaction_id := null;
      new.counterparty_vpa := null;
      new.confirmed_at := null;
      new.declined_at := null;
    else
      new.counterparty_user_id := old.counterparty_user_id;
      new.counterparty_person_account_id := old.counterparty_person_account_id;
      new.counterparty_transaction_id := old.counterparty_transaction_id;
      new.counterparty_vpa := old.counterparty_vpa;
      new.confirmed_at := old.confirmed_at;
      new.declined_at := old.declined_at;
      if (new.amount_paise, new.direction, new.due_date) is distinct from (old.amount_paise, old.direction, old.due_date) then
        new.confirmed_at := null;
        new.declined_at := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger ious_guard before insert or update on public.ious
for each row execute function public.ious_guard();

alter table public.ious enable row level security;

create policy "People read IOUs they are part of" on public.ious for select
to authenticated using (
  (select auth.uid()) = user_id
  or (select auth.uid()) = counterparty_user_id
  or (counterparty_email is not null and counterparty_email = lower((select auth.jwt())->>'email'))
);
create policy "Users create IOUs with their own people" on public.ious for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = person_account_id and a.user_id = (select auth.uid()) and a.type = 'person')
);
create policy "Owners update their IOUs" on public.ious for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = person_account_id and a.user_id = (select auth.uid()) and a.type = 'person')
);
revoke all on public.ious from anon;
grant select, insert, update on public.ious to authenticated;

-- IOU-2: the other person confirms or declines, and links their own person
-- account and ledger entry. Calling it again updates the links.
create function public.respond_iou(
  p_id uuid,
  p_accept boolean,
  p_person_account_id uuid,
  p_transaction_id uuid,
  p_vpa text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  my_email text := lower((select auth.jwt())->>'email');
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_person_account_id is not null and not exists (
    select 1 from public.accounts a where a.id = p_person_account_id and a.user_id = me and a.type = 'person'
  ) then
    raise exception 'person account % is not yours', p_person_account_id using errcode = '42501';
  end if;
  update public.ious i set
    counterparty_user_id = me,
    counterparty_person_account_id = p_person_account_id,
    counterparty_transaction_id = p_transaction_id,
    counterparty_vpa = nullif(trim(p_vpa), ''),
    confirmed_at = case when p_accept then coalesce(i.confirmed_at, now()) else null end,
    declined_at = case when p_accept then null else now() end
  where i.id = p_id
    and i.deleted_at is null
    and i.user_id <> me
    and (i.counterparty_user_id = me or (i.counterparty_user_id is null and i.counterparty_email = my_email));
  if not found then
    raise exception 'IOU % is not shared with you', p_id using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.respond_iou(uuid, boolean, uuid, uuid, text) from public, anon;
grant execute on function public.respond_iou(uuid, boolean, uuid, uuid, text) to authenticated;

-- ---- Repayments each side saw (IOU-4) ----

create function public.is_iou_party(p_iou_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ious i
    where i.id = p_iou_id
      and (i.user_id = (select auth.uid()) or (i.counterparty_user_id = (select auth.uid()) and i.confirmed_at is not null))
  );
$$;

revoke all on function public.is_iou_party(uuid) from public, anon;
grant execute on function public.is_iou_party(uuid) to authenticated;

create table public.iou_payments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  iou_id uuid not null references public.ious (id),
  amount_paise bigint not null check (amount_paise > 0),
  paid_at timestamptz not null,
  -- The recording user's ledger entry. No foreign key: it may arrive later.
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index iou_payments_iou_idx on public.iou_payments (iou_id);
create index iou_payments_user_updated_idx on public.iou_payments (user_id, updated_at);
create trigger iou_payments_set_updated_at before insert or update on public.iou_payments
for each row execute function public.set_updated_at();

alter table public.iou_payments enable row level security;
create policy "People read repayments of their IOUs" on public.iou_payments for select
to authenticated using ((select auth.uid()) = user_id or public.is_iou_party(iou_id));
create policy "People record their own repayments" on public.iou_payments for insert
to authenticated with check ((select auth.uid()) = user_id and public.is_iou_party(iou_id));
create policy "People update their own repayments" on public.iou_payments for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and public.is_iou_party(iou_id));
revoke all on public.iou_payments from anon;
grant select, insert, update on public.iou_payments to authenticated;

-- ---- Personal split groups (SPL-3) ----

create table public.split_groups (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  -- The user's own person accounts.
  member_account_ids uuid[] not null default '{}' check (cardinality(member_account_ids) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index split_groups_user_updated_idx on public.split_groups (user_id, updated_at);
create trigger split_groups_set_updated_at before insert or update on public.split_groups
for each row execute function public.set_updated_at();

alter table public.split_groups enable row level security;
create policy "Users read their own groups" on public.split_groups for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create groups of their own people" on public.split_groups for insert
to authenticated with check ((select auth.uid()) = user_id and public.owns_accounts(member_account_ids));
create policy "Users update groups of their own people" on public.split_groups for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and public.owns_accounts(member_account_ids));
revoke all on public.split_groups from anon;
grant select, insert, update on public.split_groups to authenticated;

-- ---- Realtime: a friend's confirmation or repayment shows up within seconds ----

alter publication supabase_realtime add table public.ious, public.iou_payments;
