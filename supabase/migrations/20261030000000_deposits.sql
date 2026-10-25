-- Milestone 5, build 2: the terms of FDs and RDs (NW-1, NW-2, decision 0010).
-- Interest, maturity and the value today are worked out on the phone; the
-- server only stores the terms. What went in is ordinary postings on the
-- deposit's account.

create table public.deposits (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind text not null check (kind in ('fd', 'rd')),
  -- The principal for an FD, the monthly instalment for an RD.
  amount_paise bigint not null check (amount_paise > 0),
  -- 7.25% is 725.
  rate_bp integer not null check (rate_bp between 0 and 3000),
  start_date date not null,
  maturity_date date not null check (maturity_date > start_date),
  payout text not null default 'reinvest' check (payout in ('reinvest', 'monthly', 'quarterly')),
  paid_from_account_id uuid references public.accounts (id) on delete set null,
  -- Part of the payee name on instalment debits, for example SHIVALIK.
  payee text check (length(payee) <= 80),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (kind = 'fd' or payout = 'reinvest')
);

create index deposits_user_updated_idx on public.deposits (user_id, updated_at);
create index deposits_account_idx on public.deposits (account_id);
create trigger deposits_set_updated_at before insert or update on public.deposits
for each row execute function public.set_updated_at();

alter table public.deposits enable row level security;

create policy "Users read their own deposits" on public.deposits for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create deposits on their own accounts" on public.deposits for insert
to authenticated with check (
  (select auth.uid()) = user_id and public.owns_accounts(array[account_id, paid_from_account_id])
);
create policy "Users update deposits on their own accounts" on public.deposits for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and public.owns_accounts(array[account_id, paid_from_account_id])
);
revoke all on public.deposits from anon;
grant select, insert, update on public.deposits to authenticated;
