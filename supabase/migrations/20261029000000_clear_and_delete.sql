-- ACC-7 (clear my data) and ACC-4 (delete account).
--
-- clear_my_data removes everything the signed-in user stored and keeps the
-- sign-in. Rows nobody else can see are deleted outright. Rows a friend can
-- see (an IOU shared with them, and repayments on shared IOUs) are soft-deleted
-- instead, so the friend's phone learns at its next sync that they are gone,
-- and their text is cleared. Friends' own IOUs shared with this user stay
-- theirs: this user's links and answer are taken off, so they show as waiting
-- for an answer again.
--
-- Deleting the account happens in the delete-account edge function, which
-- deletes the auth user with the built-in service role. Every table cascades
-- from auth.users; the change below lets a friend's repayment rows go with an
-- IOU they were recorded against.

alter table public.iou_payments drop constraint iou_payments_iou_id_fkey;
alter table public.iou_payments add constraint iou_payments_iou_id_fkey
  foreign key (iou_id) references public.ious (id) on delete cascade;

create function public.clear_my_data()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- What friends can see becomes an empty, deleted row.
  update public.iou_payments p set deleted_at = coalesce(p.deleted_at, now()), transaction_id = null
  where p.user_id = me
    and exists (select 1 from public.ious i where i.id = p.iou_id and (i.user_id <> me or i.counterparty_email is not null));
  update public.ious set
    deleted_at = coalesce(deleted_at, now()),
    reason = null,
    owner_name = null,
    owner_vpa = null,
    transaction_id = null
  where user_id = me and counterparty_email is not null;
  update public.accounts a set
    deleted_at = coalesce(a.deleted_at, now()),
    name = 'Removed',
    vpa = null,
    email = null
  where a.user_id = me
    and exists (select 1 from public.ious i where i.person_account_id = a.id and i.user_id = me);

  -- Friends' IOUs shared with this user: take this user's side off.
  update public.ious set
    counterparty_user_id = null,
    counterparty_person_account_id = null,
    counterparty_transaction_id = null,
    counterparty_vpa = null,
    confirmed_at = null,
    declined_at = null
  where counterparty_user_id = me and user_id <> me;

  -- Everything else goes. Postings and sources cascade from transactions.
  delete from public.balance_anchors where user_id = me;
  delete from public.transactions where user_id = me;
  delete from public.rules where user_id = me;
  delete from public.budgets where user_id = me;
  delete from public.recurring where user_id = me;
  delete from public.split_groups where user_id = me;
  delete from public.ious where user_id = me and counterparty_email is null;
  delete from public.accounts a
  where a.user_id = me
    and not exists (select 1 from public.ious i where i.person_account_id = a.id);
  delete from public.account_types where user_id = me;
  delete from public.ai_usage where user_id = me;

  return now();
end;
$$;

revoke all on function public.clear_my_data() from public, anon;
grant execute on function public.clear_my_data() to authenticated;
