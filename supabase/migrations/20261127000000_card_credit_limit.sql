-- Decision 0024 (LED-12): a credit card's credit limit, typed once by the
-- user. With it, the available limit printed in card SMS becomes the amount
-- the card really owes (limit minus available), stored as a balance anchor.
-- A column on accounts, so the existing row-level security covers it.
alter table public.accounts
  add column credit_limit_paise bigint
  check (credit_limit_paise is null or credit_limit_paise > 0);
