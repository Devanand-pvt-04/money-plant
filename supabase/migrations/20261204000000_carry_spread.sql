-- Decision 0034, part 2: an overspend taken off comes off as many months as
-- it needs. By default each month takes what its budget allows; the user can
-- spread it in equal parts over 2 to 6 months instead, change that later, or
-- stop carrying the rest. A changed plan stops the old row and starts a row
-- that continues it (continues_id), so months already taken stay as they were.

alter table public.budget_carries
  add column spread_months smallint check (spread_months between 2 and 6),
  add column stopped_from date check (extract(day from stopped_from) = 1),
  add column continues_id uuid references public.budget_carries (id) on delete set null,
  add constraint budget_carries_spread_overspend check (spread_months is null or amount_paise < 0),
  add constraint budget_carries_continues_overspend check (continues_id is null or amount_paise < 0);

create index budget_carries_continues_idx on public.budget_carries (continues_id);

-- A row can continue only one of the user's own rows.
drop policy "Users create budget carries on their own categories" on public.budget_carries;
drop policy "Users update budget carries on their own categories" on public.budget_carries;
create policy "Users create budget carries on their own categories" on public.budget_carries for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
  and (continues_id is null or exists (select 1 from public.budget_carries c where c.id = continues_id and c.user_id = (select auth.uid())))
);
create policy "Users update budget carries on their own categories" on public.budget_carries for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
  and (continues_id is null or exists (select 1 from public.budget_carries c where c.id = continues_id and c.user_id = (select auth.uid())))
);
