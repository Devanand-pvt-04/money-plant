-- Decision 0027: settling a debt another way. A repayment can say it was
-- settled outside the app (a mutual understanding, paid in kind, let go). No
-- money moves in either person's accounts: each phone writes the person leg
-- against its own hidden "Settled outside the app" account, of type
-- 'settled', which is neither an account the user owns nor spending.

alter table public.shared_items
  add column settled_outside boolean not null default false,
  add constraint shared_items_settled_outside_repayment check (not settled_outside or kind = 'repayment');

alter table public.accounts drop constraint accounts_type_check;
alter table public.accounts add constraint accounts_type_check check (type in (
  'bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd',
  'mutual_fund', 'stock', 'nps', 'savings_scheme', 'person', 'category', 'custom', 'exchange', 'settled'
));

-- Settling in another currency works the same way as a person or category leg.
create or replace function public.account_takes_any_currency(p_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_type in ('person', 'category', 'exchange', 'settled') $$;
