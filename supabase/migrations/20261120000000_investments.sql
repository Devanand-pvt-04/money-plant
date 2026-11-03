-- Investments step (NW-5, NW-6, decision 0014).
-- Holdings now also hold shares, ETFs, gold bonds and bonds from an NSDL or
-- CDSL statement (several per demat account) and NPS schemes. Depository
-- statements carry no purchase cost for shares, so cost_known says whether
-- cost_paise is what the user paid (true) or the statement's value standing
-- in until they add it (false). Long-term savings schemes are deposits on
-- savings_scheme accounts.

alter table public.holdings
  add column kind text not null default 'fund'
    check (kind in ('fund', 'share', 'etf', 'gold_bond', 'bond', 'nps')),
  add column symbol text check (length(symbol) <= 40),
  add column cost_known boolean not null default true;

alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check check (type in (
  'bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd',
  'mutual_fund', 'stock', 'nps', 'savings_scheme', 'person', 'category', 'custom'
));

alter table public.deposits drop constraint deposits_kind_check;
alter table public.deposits add constraint deposits_kind_check
  check (kind in ('fd', 'rd', 'ppf', 'epf', 'nsc', 'kvp', 'ssy'));
