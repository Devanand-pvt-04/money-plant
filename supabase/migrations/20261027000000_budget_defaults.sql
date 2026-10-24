-- App review round 1 (BUD-1): a budget is a default for every month, with
-- one-month overrides on top. A null month is the default; a row with a month
-- overrides it for that month only.
--
-- Rows used to mean "from this month on". Each category's latest row becomes
-- its default, and the old rows are soft-deleted so phones pull the change.
-- The default's id is derived the way the phone derives it (lib/ids.ts):
-- sha256 of "<user id>:budget:default:<category id or overall>", shaped as a
-- UUID, so a phone setting the same default writes the same row.

create extension if not exists pgcrypto with schema extensions;

alter table public.budgets alter column month drop not null;

with latest as (
  select distinct on (user_id, category_account_id) user_id, category_account_id, limit_paise
  from public.budgets
  where deleted_at is null and month is not null
  order by user_id, category_account_id, month desc
),
hashed as (
  select
    user_id,
    category_account_id,
    limit_paise,
    encode(extensions.digest(user_id::text || ':budget:default:' || coalesce(category_account_id::text, 'overall'), 'sha256'), 'hex') as hex
  from latest
  where limit_paise is not null
)
insert into public.budgets (id, user_id, month, category_account_id, limit_paise)
select
  (substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-5' || substr(hex, 14, 3) || '-8' || substr(hex, 18, 3) || '-' || substr(hex, 21, 12))::uuid,
  user_id,
  null,
  category_account_id,
  limit_paise
from hashed
on conflict (id) do nothing;

update public.budgets set deleted_at = now() where month is not null and deleted_at is null;
