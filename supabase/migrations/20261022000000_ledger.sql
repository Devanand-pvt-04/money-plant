-- Milestone 2: the double-entry ledger (LED-1, LED-2, LED-7).
-- transactions -> postings (sum to zero) and sources (at least one). Raw SMS text
-- has no column here: only parsed fields are ever synced.

-- ICICI prints only the last 3 digits of an account.
alter table public.accounts drop constraint accounts_last4_check;
alter table public.accounts add constraint accounts_last4_check check (last4 ~ '^[0-9]{3,4}$');

create table public.transactions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null,
  counterparty text check (length(counterparty) <= 120),
  kind text not null check (kind in ('expense', 'income', 'transfer', 'adjustment')),
  status text not null check (status in ('pending', 'confirmed')),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index transactions_user_updated_idx on public.transactions (user_id, updated_at);
create index transactions_user_occurred_idx on public.transactions (user_id, occurred_at);

create table public.postings (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  amount_paise bigint not null check (amount_paise <> 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index postings_transaction_idx on public.postings (transaction_id);
create index postings_account_idx on public.postings (account_id);

create table public.sources (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  kind text not null check (kind in ('sms', 'notification', 'statement', 'cas', 'manual', 'shortcut')),
  sender text,
  external_ref text,
  fingerprint text not null,
  parsed_fields jsonb not null default '{}',
  received_at timestamptz not null,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, fingerprint)
);

create index sources_transaction_idx on public.sources (transaction_id);

create table public.balance_anchors (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  balance_paise bigint not null,
  observed_at timestamptz not null,
  source_id uuid not null references public.sources (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index balance_anchors_user_updated_idx on public.balance_anchors (user_id, updated_at);

create trigger transactions_set_updated_at before insert or update on public.transactions
for each row execute function public.set_updated_at();
create trigger postings_set_updated_at before insert or update on public.postings
for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before insert or update on public.sources
for each row execute function public.set_updated_at();
create trigger balance_anchors_set_updated_at before insert or update on public.balance_anchors
for each row execute function public.set_updated_at();

-- Row-level security: each user sees only their own rows. Child rows must point
-- at the user's own transaction and accounts. Soft delete only, so no delete policies.
alter table public.transactions enable row level security;
alter table public.postings enable row level security;
alter table public.sources enable row level security;
alter table public.balance_anchors enable row level security;

create policy "Users read their own transactions" on public.transactions for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their own transactions" on public.transactions for insert
to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own transactions" on public.transactions for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users read their own postings" on public.postings for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create postings on their own transactions and accounts" on public.postings for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.transactions t where t.id = transaction_id and t.user_id = (select auth.uid()))
  and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = (select auth.uid()))
);
create policy "Users update postings on their own transactions and accounts" on public.postings for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.transactions t where t.id = transaction_id and t.user_id = (select auth.uid()))
  and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = (select auth.uid()))
);

create policy "Users read their own sources" on public.sources for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create sources on their own transactions" on public.sources for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.transactions t where t.id = transaction_id and t.user_id = (select auth.uid()))
);
create policy "Users update sources on their own transactions" on public.sources for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.transactions t where t.id = transaction_id and t.user_id = (select auth.uid()))
);

create policy "Users read their own balance anchors" on public.balance_anchors for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create balance anchors on their own accounts" on public.balance_anchors for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = account_id and a.user_id = (select auth.uid()))
);
create policy "Users update their own balance anchors" on public.balance_anchors for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.transactions, public.postings, public.sources, public.balance_anchors from anon;
grant select, insert, update on public.transactions, public.postings, public.sources, public.balance_anchors to authenticated;

-- Pushes transactions together with their postings and sources in one database
-- transaction, and refuses any live entry whose postings don't sum to zero or
-- that has no source. Runs as the caller, so row-level security still applies.
-- Postings missing from the new set are soft-deleted: postings are replaced as a set.
create function public.push_transactions(payload jsonb)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  tx_id uuid;
  posting_count int;
  posting_sum numeric;
  source_count int;
begin
  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be an array' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(payload) loop
    tx_id := (item->>'id')::uuid;

    insert into public.transactions as t
      (id, occurred_at, counterparty, kind, status, confidence, review_reason, created_at, deleted_at)
    values (
      tx_id,
      (item->>'occurred_at')::timestamptz,
      item->>'counterparty',
      item->>'kind',
      item->>'status',
      (item->>'confidence')::numeric,
      item->>'review_reason',
      coalesce((item->>'created_at')::timestamptz, now()),
      (item->>'deleted_at')::timestamptz
    )
    on conflict (id) do update set
      occurred_at = excluded.occurred_at,
      counterparty = excluded.counterparty,
      kind = excluded.kind,
      status = excluded.status,
      confidence = excluded.confidence,
      review_reason = excluded.review_reason,
      deleted_at = excluded.deleted_at;

    update public.postings p set deleted_at = now()
    where p.transaction_id = tx_id
      and p.deleted_at is null
      and p.id not in (select (x->>'id')::uuid from jsonb_array_elements(item->'postings') x);

    insert into public.postings as p (id, transaction_id, account_id, amount_paise, created_at)
    select (x->>'id')::uuid, tx_id, (x->>'account_id')::uuid, (x->>'amount_paise')::bigint,
           coalesce((x->>'created_at')::timestamptz, now())
    from jsonb_array_elements(item->'postings') x
    on conflict (id) do update set
      account_id = excluded.account_id,
      amount_paise = excluded.amount_paise,
      deleted_at = null
    where p.transaction_id = excluded.transaction_id;

    insert into public.sources as s
      (id, transaction_id, kind, sender, external_ref, fingerprint, parsed_fields, received_at, confidence, created_at)
    select (x->>'id')::uuid, tx_id, x->>'kind', x->>'sender', x->>'external_ref', x->>'fingerprint',
           coalesce(x->'parsed_fields', '{}'::jsonb), (x->>'received_at')::timestamptz,
           (x->>'confidence')::numeric, coalesce((x->>'created_at')::timestamptz, now())
    from jsonb_array_elements(item->'sources') x
    on conflict (id) do update set
      transaction_id = excluded.transaction_id,
      external_ref = excluded.external_ref,
      parsed_fields = excluded.parsed_fields,
      confidence = excluded.confidence,
      deleted_at = null;

    if item->>'deleted_at' is null then
      select count(*), coalesce(sum(amount_paise), 0) into posting_count, posting_sum
      from public.postings where transaction_id = tx_id and deleted_at is null;
      if posting_count < 2 or posting_sum <> 0 then
        raise exception 'transaction % does not balance (% postings, sum %)', tx_id, posting_count, posting_sum
          using errcode = '23514';
      end if;
      select count(*) into source_count
      from public.sources where transaction_id = tx_id and deleted_at is null;
      if source_count = 0 then
        raise exception 'transaction % has no source', tx_id using errcode = '23514';
      end if;
    end if;

    return next tx_id;
  end loop;
end;
$$;

revoke all on function public.push_transactions(jsonb) from public, anon;
grant execute on function public.push_transactions(jsonb) to authenticated;
