-- Milestone 5, build 3: mutual fund holdings from a CAS (NW-3, decision 0010).
-- One row per scheme and folio, each on its own mutual_fund account. Units
-- and cost are as of the statement; the phone values them with AMFI's daily
-- NAV, which it keeps locally. What went in is ordinary postings.

create table public.holdings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  scheme text not null check (length(scheme) <= 200),
  isin text check (isin ~ '^IN[A-Z0-9]{10}$'),
  amfi_code text check (amfi_code ~ '^[0-9]{1,10}$'),
  folio text check (length(folio) <= 40),
  amc text check (length(amc) <= 120),
  -- 123.4560 units is 1234560.
  units_e4 bigint not null check (units_e4 >= 0),
  cost_paise bigint not null check (cost_paise >= 0),
  -- The NAV on the statement, 45.6789 is 456789, used until a fresher one arrives.
  nav_e4 bigint check (nav_e4 >= 0),
  nav_date date,
  -- The date the statement ends; postings after it are new money in or out.
  as_of date not null,
  sip_paise bigint check (sip_paise > 0),
  sip_day smallint check (sip_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index holdings_user_updated_idx on public.holdings (user_id, updated_at);
create index holdings_account_idx on public.holdings (account_id);
create trigger holdings_set_updated_at before insert or update on public.holdings
for each row execute function public.set_updated_at();

alter table public.holdings enable row level security;

create policy "Users read their own holdings" on public.holdings for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create holdings on their own accounts" on public.holdings for insert
to authenticated with check ((select auth.uid()) = user_id and public.owns_accounts(array[account_id]));
create policy "Users update holdings on their own accounts" on public.holdings for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id and public.owns_accounts(array[account_id])
);
revoke all on public.holdings from anon;
grant select, insert, update on public.holdings to authenticated;
