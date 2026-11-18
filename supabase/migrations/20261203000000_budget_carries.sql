-- Decision 0034: carrying a budget's leftover or overspend into the next
-- month (BUD-5). One row per category per month the carry lands in: a
-- positive amount was left over last month and carried in, a negative one
-- went over and comes off, and zero records that the user chose to leave it.
-- Kept apart from budgets, so changing or resetting the month's budget keeps
-- the carry. Ids are derived on the phone from user, month and category.

create table public.budget_carries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_account_id uuid not null references public.accounts (id),
  amount_paise bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index budget_carries_user_updated_idx on public.budget_carries (user_id, updated_at);
create index budget_carries_category_idx on public.budget_carries (category_account_id);
create trigger budget_carries_set_updated_at before insert or update on public.budget_carries
for each row execute function public.set_updated_at();

alter table public.budget_carries enable row level security;
create policy "Users read their own budget carries" on public.budget_carries for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create budget carries on their own categories" on public.budget_carries for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
);
create policy "Users update budget carries on their own categories" on public.budget_carries for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
);
revoke all on public.budget_carries from anon;
grant select, insert, update on public.budget_carries to authenticated;

-- Clear my data (ACC-7) deletes carries before the categories they point at.
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
  delete from public.budget_carries where user_id = me;
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
