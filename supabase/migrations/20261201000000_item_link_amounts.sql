-- Shared items in the app (decision 0026, step 3). Each side's link records
-- what its own entry carries for the item: the kind, flow (from that side),
-- amount and currency at the time it linked. When the creator later changes
-- the item, the phone sees the difference, takes the old amount back out of
-- the entry and links the new one, on any of the user's phones.
--
-- ious, iou_payments and split_groups are no longer read or written by the
-- app from this update on. They are dropped in a later migration, once every
-- phone runs it, so an older app still syncs in between.

alter table public.item_links
  add column linked_kind text check (linked_kind in ('share', 'loan', 'repayment')),
  add column linked_flow text check (linked_flow in ('to_them', 'to_me')),
  add column linked_paise bigint check (linked_paise > 0),
  add column linked_currency text check (linked_currency ~ '^[A-Z]{3}$'),
  -- All four or none. Not tied to transaction_id, which the database sets to
  -- null by itself when an entry is removed for good.
  add constraint item_links_linked_whole check (
    (linked_kind is null and linked_flow is null and linked_paise is null and linked_currency is null)
    or (linked_kind is not null and linked_flow is not null and linked_paise is not null and linked_currency is not null)
  );

-- A friend's own link changing never needs to reach the other phone, but a
-- user's other phones should see it quickly.
alter publication supabase_realtime add table public.item_links;
