-- Fixes 20261204000000_carry_spread: its insert and update policies on
-- budget_carries read budget_carries itself to check continues_id, which
-- Postgres refuses as infinite recursion, so no carry could be saved. The
-- check now goes through a security definer function, which reads the table
-- without row-level security: a row can continue only one of the caller's
-- own rows.

create function public.owns_budget_carry(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.budget_carries c where c.id = p_id and c.user_id = (select auth.uid()))
$$;

revoke all on function public.owns_budget_carry(uuid) from public, anon;
grant execute on function public.owns_budget_carry(uuid) to authenticated;

drop policy "Users create budget carries on their own categories" on public.budget_carries;
drop policy "Users update budget carries on their own categories" on public.budget_carries;
create policy "Users create budget carries on their own categories" on public.budget_carries for insert
to authenticated with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
  and (continues_id is null or public.owns_budget_carry(continues_id))
);
create policy "Users update budget carries on their own categories" on public.budget_carries for update
to authenticated using ((select auth.uid()) = user_id) with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.accounts a where a.id = category_account_id and a.user_id = (select auth.uid()))
  and (continues_id is null or public.owns_budget_carry(continues_id))
);
