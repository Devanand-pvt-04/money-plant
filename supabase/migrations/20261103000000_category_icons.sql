-- Review 4 (decision 0013): an icon the user picked for a category (CAT-1).
-- Null means the app picks one from the category's name and standard key.

alter table public.accounts
  add column icon text check (icon ~ '^[a-z0-9-]{1,64}$');

-- LED-5: a refund takes the category of the payment it reverses; category_rule_id then holds that payment's id.
alter table public.transactions drop constraint if exists transactions_category_reason_check;
alter table public.transactions
  add constraint transactions_category_reason_check
  check (category_reason in ('rule', 'pattern', 'dictionary', 'ai', 'user', 'refund'));
