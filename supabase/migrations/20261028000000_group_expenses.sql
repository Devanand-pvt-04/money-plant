-- App review round 1 (SPL-3): an expense added to a group is tagged with the
-- group's id, so the group page lists its expenses and each member's balance
-- within the group. No foreign key: a phone may push the entry before the
-- group, and a deleted group leaves its entries untouched.

alter table public.transactions add column split_group_id uuid;

-- ---- push_transactions: carry split_group_id ----

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
