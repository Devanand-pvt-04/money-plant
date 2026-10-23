# 0007: Recurring payments, IOUs, splits and scan to pay (milestone 4)

Date: 2026-10-23. Proposed in the milestone 4 PRs, for Deva to review. Milestone 4 ships as three PRs: recurring payments, then people, IOUs and splits, then scan and pay.

| Decision | Choice | Why |
| --- | --- | --- |
| Where recurring logic runs | On the phone, in `packages/matcher` (detection, matching, pre-debit notices, shortfall). The `recurring` table only syncs the result | Works offline and uses the full ledger, which only the phone has with raw SMS context |
| Detection (REC-1) | Every gap between payments to one payee must fit a single cadence, with amounts within 10% of the median and at least 3 monthly or 4 weekly payments. Detected payments are proposals until the user tracks them | Strict enough that Swiggy or Amazon never qualify; the user confirms before reminders start |
| Pre-debit SMS (REC-1) | A bank's autopay notice updates or creates an active recurring payment. Formats are synthetic until real samples arrive (`fixtures/<bank>/predebit.synthetic.json`) | The bank has confirmed the mandate, so asking again adds a step with no benefit |
| Reminders (REC-3) | Local notifications (expo-notifications, best-effort delivery) at 9 am, 3 days and 1 day before, rebuilt after every change, with a shortfall warning for bank accounts | No server push service or exact-alarm permission needed; the phone already has the balances |
| Marking paid (REC-4) | The architecture's "Recurring match" rule, applied after each capture and on app open, catching up several periods after an import | Idempotent, so re-running it is always safe |
