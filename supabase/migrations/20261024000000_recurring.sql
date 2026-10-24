-- Milestone 4: recurring payments (REC-1 to REC-4).
-- Autopays, EMIs, rent and subscriptions: detected from history and pre-debit
-- SMS on the phone, or added by hand. Reminders are scheduled on the phone, so
-- the server only stores the rows.

create table public.recurring (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  vpa text check (length(vpa) <= 256),
  merchant text check (length(merchant) <= 80),
  amount_paise bigint not null check (amount_paise > 0),
  cadence text not null check (cadence in ('weekly', 'monthly', 'quarterly', 'yearly')),
  anchor_day smallint check (anchor_day between 1 and 31),
  next_due date not null,
  account_id uuid references public.accounts (id),
  category_account_id uuid references public.accounts (id),
  status text not null check (status in ('active', 'paused', 'proposed', 'declined')),
  origin text not null check (origin in ('manual', 'history', 'pre_debit')),
  mandate_ref text check (length(mandate_ref) <= 64),
  last_paid_at timestamptz,
  -- No foreign key: the entry may reach the server after this row.
  last_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index recurring_user_updated_idx on public.recurring (user_id, updated_at);
create trigger recurring_set_updated_at before insert or update on public.recurring
for each row execute function public.set_updated_at();

alter table public.recurring enable row level security;

-- The account and category, when set, must be the user's own.
create function public.owns_accounts(p_account_ids uuid[])
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1 from unnest(p_account_ids) as a(id)
    where a.id is not null
      and not exists (select 1 from public.accounts x where x.id = a.id and x.user_id = (select auth.uid()))
  );
$$;

create policy "Users read their own recurring payments" on public.recurring for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create recurring payments on their own accounts" on public.recurring for insert
to authenticated with check (
  (select auth.uid()) = user_id and public.owns_accounts(array[account_id, category_account_id])
);
create policy "Users update recurring payments on their own accounts" on public.recurring for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and public.owns_accounts(array[account_id, category_account_id])
);
revoke all on public.recurring from anon;
grant select, insert, update on public.recurring to authenticated;
