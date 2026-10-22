-- Milestone 3: category tree, custom account types, rules and learned patterns,
-- budgets, the shared merchant dictionary and the AI spend cap.
-- (ACC-6, LED-8, CAT-1 to CAT-8, BUD-1 to BUD-3)

-- ---- Custom account types (ACC-6) ----

create table public.account_types (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  class text not null check (class in ('asset', 'liability')),
  in_net_worth boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index account_types_user_updated_idx on public.account_types (user_id, updated_at);
create trigger account_types_set_updated_at before insert or update on public.account_types
for each row execute function public.set_updated_at();

alter table public.account_types enable row level security;
create policy "Users read their own account types" on public.account_types for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their own account types" on public.account_types for insert
to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their own account types" on public.account_types for update
to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.account_types from anon;
grant select, insert, update on public.account_types to authenticated;

-- ---- Accounts: custom types and the two-level category tree (CAT-5) ----

alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check check (type in (
  'bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd',
  'mutual_fund', 'stock', 'person', 'category', 'custom'
));
alter table public.accounts
  add column account_type_id uuid references public.account_types (id),
  -- Deferred, so a parent and its children can arrive in one push in any order.
  add column parent_id uuid references public.accounts (id) deferrable initially deferred,
  add column category_key text check (category_key ~ '^[a-z_]+(\.[a-z_]+)?$');
alter table public.accounts add constraint accounts_custom_type_check
  check ((type = 'custom') = (account_type_id is not null));
alter table public.accounts add constraint accounts_parent_category_check
  check (parent_id is null or (type = 'category' and parent_id <> id));

-- A category's parent must be one of the user's own top-level categories, so the tree stays two levels deep.
create function public.check_category_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.accounts p
    where p.id = new.parent_id and p.user_id = new.user_id and p.type = 'category' and p.parent_id is null
  ) then
    raise exception 'category % must have a top-level category of the same user as parent', new.id
      using errcode = '23514';
  end if;
  if new.parent_id is not null and exists (
    select 1 from public.accounts c where c.parent_id = new.id and c.deleted_at is null
  ) then
    raise exception 'category % has sub-categories, so it cannot become one', new.id using errcode = '23514';
  end if;
  return new;
end;
$$;

create constraint trigger accounts_check_category_parent
after insert or update of parent_id on public.accounts
deferrable initially deferred
for each row execute function public.check_category_parent();

-- ---- Transactions: why-labels and fields the user set (CAT-6, LED-8) ----

alter table public.transactions
  add column category_reason text check (category_reason in ('rule', 'pattern', 'dictionary', 'ai', 'user')),
  add column category_rule_id uuid,
  add column user_set_fields jsonb not null default '[]' check (jsonb_typeof(user_set_fields) = 'array'),
  add column note text check (length(note) <= 500);

-- ---- Rules and learned patterns (CAT-3, CAT-7, CAT-8) ----

create table public.rules (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('rule', 'pattern')),
  status text not null check (status in ('active', 'paused', 'proposed', 'declined')),
  match jsonb not null check (match->>'kind' = kind),
  category_account_id uuid not null references public.accounts (id),
  auto_confirm boolean not null default true,
  hits integer not null default 0 check (hits >= 0),
  misses integer not null default 0 check (misses >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index rules_user_updated_idx on public.rules (user_id, updated_at);
create trigger rules_set_updated_at before insert or update on public.rules
for each row execute function public.set_updated_at();

alter table public.rules enable row level security;
create policy "Users read their own rules" on public.rules for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create rules on their own categories" on public.rules for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
);
create policy "Users update rules on their own categories" on public.rules for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
);
revoke all on public.rules from anon;
grant select, insert, update on public.rules to authenticated;

-- ---- Budgets (BUD-1) ----
-- A row applies from its month until a later row for the same category.
-- Null category: the overall budget. Null limit: no budget from that month on.
-- Ids are derived on the phone from user, month and category, so two phones
-- setting the same budget write the same row.

create table public.budgets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  category_account_id uuid references public.accounts (id),
  limit_paise bigint check (limit_paise > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index budgets_user_updated_idx on public.budgets (user_id, updated_at);
create trigger budgets_set_updated_at before insert or update on public.budgets
for each row execute function public.set_updated_at();

alter table public.budgets enable row level security;
create policy "Users read their own budgets" on public.budgets for select
to authenticated using ((select auth.uid()) = user_id);
create policy "Users create budgets on their own categories" on public.budgets for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and (category_account_id is null or exists (
    select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid())
  ))
);
create policy "Users update budgets on their own categories" on public.budgets for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and (category_account_id is null or exists (
    select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid())
  ))
);
revoke all on public.budgets from anon;
grant select, insert, update on public.budgets to authenticated;

-- ---- Shared merchant dictionary ----
-- Global, read-only for clients. Only the categorise edge function writes it,
-- with the service role. It holds merchant names and standard category keys,
-- never anything about a user.

-- set_updated_at also pins user_id, which global tables don't have.
create function public.set_updated_at_global()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  normalised_name text not null unique check (length(normalised_name) between 1 and 80),
  display_name text,
  upi_handles text[] not null default '{}',
  category_key text not null check (category_key ~ '^[a-z_]+(\.[a-z_]+)?$'),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  created_by text not null check (created_by in ('dictionary', 'ai', 'user_confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger merchants_set_updated_at before insert or update on public.merchants
for each row execute function public.set_updated_at_global();

alter table public.merchants enable row level security;
create policy "Signed-in users read the merchant dictionary" on public.merchants for select
to authenticated using (deleted_at is null);
revoke all on public.merchants from anon, authenticated;
grant select on public.merchants to authenticated;

-- ---- AI spend cap ----
-- One row per user per month, written only by the categorise edge function.
-- Users can read their own usage.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  -- Millionths of a US dollar, so the cap is checked in integers.
  cost_micro_usd bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, month)
);

create trigger ai_usage_set_updated_at before insert or update on public.ai_usage
for each row execute function public.set_updated_at_global();

alter table public.ai_usage enable row level security;
create policy "Users read their own AI usage" on public.ai_usage for select
to authenticated using ((select auth.uid()) = user_id);
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- Adds a call's usage to the user's month and returns the month's totals for
-- the user and for everyone. Service role only.
create function public.record_ai_usage(p_user_id uuid, p_input_tokens bigint, p_output_tokens bigint, p_cost_micro_usd bigint)
returns table (user_cost_micro_usd bigint, user_calls integer, total_cost_micro_usd bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  this_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  insert into public.ai_usage as u (user_id, month, calls, input_tokens, output_tokens, cost_micro_usd)
  values (p_user_id, this_month, 1, p_input_tokens, p_output_tokens, p_cost_micro_usd)
  on conflict (user_id, month) do update set
    calls = u.calls + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cost_micro_usd = u.cost_micro_usd + excluded.cost_micro_usd;
  return query
    select
      (select a.cost_micro_usd from public.ai_usage a where a.user_id = p_user_id and a.month = this_month),
      (select a.calls from public.ai_usage a where a.user_id = p_user_id and a.month = this_month),
      (select coalesce(sum(a.cost_micro_usd), 0)::bigint from public.ai_usage a where a.month = this_month);
end;
$$;

-- This month's spend so far, for the cap check before a call. Service role only.
create function public.ai_usage_this_month(p_user_id uuid)
returns table (user_cost_micro_usd bigint, user_calls integer, total_cost_micro_usd bigint)
language sql
security definer
set search_path = ''
as $$
  with m as (select date_trunc('month', now() at time zone 'Asia/Kolkata')::date as month)
  select
    coalesce((select a.cost_micro_usd from public.ai_usage a, m where a.user_id = p_user_id and a.month = m.month), 0)::bigint,
    coalesce((select a.calls from public.ai_usage a, m where a.user_id = p_user_id and a.month = m.month), 0)::integer,
    coalesce((select sum(a.cost_micro_usd) from public.ai_usage a, m where a.month = m.month), 0)::bigint;
$$;

revoke all on function public.record_ai_usage(uuid, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.ai_usage_this_month(uuid) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, bigint, bigint, bigint) to service_role;
grant execute on function public.ai_usage_this_month(uuid) to service_role;

-- ---- push_transactions: carry the new columns ----

create or replace function public.push_transactions(payload jsonb)
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
      (id, occurred_at, counterparty, kind, status, confidence, review_reason,
       category_reason, category_rule_id, user_set_fields, note, created_at, deleted_at)
    values (
      tx_id,
      (item->>'occurred_at')::timestamptz,
      item->>'counterparty',
      item->>'kind',
      item->>'status',
      (item->>'confidence')::numeric,
      item->>'review_reason',
      item->>'category_reason',
      (item->>'category_rule_id')::uuid,
      coalesce(item->'user_set_fields', '[]'::jsonb),
      item->>'note',
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
      category_reason = excluded.category_reason,
      category_rule_id = excluded.category_rule_id,
      user_set_fields = excluded.user_set_fields,
      note = excluded.note,
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
