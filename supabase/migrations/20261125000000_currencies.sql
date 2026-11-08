-- Multiple currencies (decision 0017; ACC-12, LED-11). Amounts stay whole
-- numbers in `_paise` columns, now read as minor units of the row's currency
-- (paise for INR, cents for USD, fils for AED). Existing rows are INR.

-- ---- Currencies on accounts, postings, IOUs and recurring payments ----

alter table public.accounts
  add constraint accounts_currency_check check (currency ~ '^[A-Z]{3}$');

alter table public.postings
  add column currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$');

alter table public.ious
  add column currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$');

alter table public.iou_payments
  add column currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$');

alter table public.recurring
  add column currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$');

-- A hidden account per user balances transfers between currencies (LED-11).
alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check check (type in (
  'bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd',
  'mutual_fund', 'stock', 'nps', 'savings_scheme', 'person', 'category', 'custom', 'exchange'
));

-- Accounts whose postings may be in any currency. Every other account takes
-- postings only in its own currency.
create function public.account_takes_any_currency(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_type in ('person', 'category', 'exchange') $$;

-- An account's currency can change only while nothing is posted to it, so old
-- amounts are never read in a different currency (ACC-12).
create function public.accounts_currency_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency
     and not public.account_takes_any_currency(new.type)
     and exists (select 1 from public.postings p where p.account_id = new.id and p.deleted_at is null) then
    raise exception 'account % has entries; its currency cannot change', new.id using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger accounts_currency_guard before update of currency on public.accounts
for each row execute function public.accounts_currency_guard();

-- ---- IOUs: a change of currency asks the other side to confirm again ----

create or replace function public.ious_guard()
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
      if (new.amount_paise, new.currency, new.direction, new.due_date)
         is distinct from (old.amount_paise, old.currency, old.direction, old.due_date) then
        new.confirmed_at := null;
        new.declined_at := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---- push_transactions: carry each posting's currency, balance per currency ----

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
  unbalanced_currency text;
  wrong_currency_posting uuid;
  source_count int;
begin
  if jsonb_typeof(payload) <> 'array' then
    raise exception 'payload must be an array' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(payload) loop
    tx_id := (item->>'id')::uuid;

    insert into public.transactions as t
      (id, occurred_at, counterparty, kind, status, confidence, review_reason,
       category_reason, category_rule_id, user_set_fields, note, split_group_id, created_at, deleted_at)
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
      (item->>'split_group_id')::uuid,
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
      split_group_id = excluded.split_group_id,
      deleted_at = excluded.deleted_at;

    update public.postings p set deleted_at = now()
    where p.transaction_id = tx_id
      and p.deleted_at is null
      and p.id not in (select (x->>'id')::uuid from jsonb_array_elements(item->'postings') x);

    -- Phones from before decision 0017 send no currency: their postings are INR.
    insert into public.postings as p (id, transaction_id, account_id, amount_paise, currency, created_at)
    select (x->>'id')::uuid, tx_id, (x->>'account_id')::uuid, (x->>'amount_paise')::bigint,
           coalesce(x->>'currency', 'INR'),
           coalesce((x->>'created_at')::timestamptz, now())
    from jsonb_array_elements(item->'postings') x
    on conflict (id) do update set
      account_id = excluded.account_id,
      amount_paise = excluded.amount_paise,
      currency = excluded.currency,
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
      select count(*) into posting_count
      from public.postings where transaction_id = tx_id and deleted_at is null;
      select currency into unbalanced_currency
      from public.postings where transaction_id = tx_id and deleted_at is null
      group by currency having sum(amount_paise) <> 0
      limit 1;
      if posting_count < 2 or unbalanced_currency is not null then
        raise exception 'transaction % does not balance (% postings, % unbalanced)', tx_id, posting_count, unbalanced_currency
          using errcode = '23514';
      end if;
      select p.id into wrong_currency_posting
      from public.postings p join public.accounts a on a.id = p.account_id
      where p.transaction_id = tx_id and p.deleted_at is null
        and not public.account_takes_any_currency(a.type)
        and p.currency <> a.currency
      limit 1;
      if wrong_currency_posting is not null then
        raise exception 'posting % is not in its account''s currency', wrong_currency_posting
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

revoke all on function public.account_takes_any_currency(text) from public, anon;
grant execute on function public.account_takes_any_currency(text) to authenticated;
