-- Decision 0024 (LED-12): a credit card's billing cycle and its latest bill,
-- learned from statement SMS (or typed by the user). Columns on accounts, so
-- the existing row-level security covers them.
alter table public.accounts
  add column statement_day smallint check (statement_day is null or statement_day between 1 and 31),
  add column due_days smallint check (due_days is null or due_days between 0 and 60),
  add column bill_statement_on date,
  add column bill_due_on date,
  add column bill_total_paise bigint check (bill_total_paise is null or bill_total_paise >= 0),
  add column bill_minimum_paise bigint check (bill_minimum_paise is null or bill_minimum_paise >= 0);
