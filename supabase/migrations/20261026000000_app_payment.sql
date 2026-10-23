-- Milestone 4: scan and pay (PAY-1, PAY-2). A payment the user starts from
-- Money Plant is an entry with an app_payment source: the payee, amount, our
-- reference and what the UPI app answered. The bank SMS later merges into it.

alter table public.sources drop constraint sources_kind_check;
alter table public.sources add constraint sources_kind_check
  check (kind in ('sms', 'notification', 'statement', 'cas', 'manual', 'shortcut', 'app_payment'));
