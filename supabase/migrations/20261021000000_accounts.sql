-- Accounts: bank accounts, cards, cash, deposits, investments, people and categories.
-- Rows are created on the phone with client-generated UUIDs and synced here.
-- updated_at is set by the server on every write and is the pull cursor for sync.

create table public.accounts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in (
    'bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd',
    'mutual_fund', 'stock', 'person', 'category'
  )),
  name text not null check (length(name) between 1 and 80),
  institution text,
  last4 text check (last4 ~ '^[0-9]{4}$'),
  currency text not null default 'INR',
  opening_balance_paise bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index accounts_user_updated_idx on public.accounts (user_id, updated_at);

-- Server-owned timestamps: clients cannot backdate a change past another device's cursor.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

create trigger accounts_set_updated_at
before insert or update on public.accounts
for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;

-- Rows are soft-deleted (deleted_at), so there is no delete policy.
create policy "Users read their own accounts"
on public.accounts for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create their own accounts"
on public.accounts for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update their own accounts"
on public.accounts for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on public.accounts from anon;
grant select, insert, update on public.accounts to authenticated;
