# 0007: Recurring payments, IOUs, splits and scan to pay (milestone 4)

Date: 2026-10-23. Proposed in the milestone 4 PRs, for Deva to review. Milestone 4 ships as three PRs: recurring payments, then people, IOUs and splits, then scan and pay.

| Decision | Choice | Why |
| --- | --- | --- |
| Where recurring logic runs | On the phone, in `packages/matcher` (detection, matching, pre-debit notices, shortfall). The `recurring` table only syncs the result | Works offline and uses the full ledger, which only the phone has with raw SMS context |
| Detection (REC-1) | Every gap between payments to one payee must fit a single cadence, with amounts within 10% of the median and at least 3 monthly or 4 weekly payments. Detected payments are proposals until the user tracks them | Strict enough that Swiggy or Amazon never qualify; the user confirms before reminders start |
| Pre-debit SMS (REC-1) | A bank's autopay notice updates or creates an active recurring payment. Formats are synthetic until real samples arrive (`fixtures/<bank>/predebit.synthetic.json`) | The bank has confirmed the mandate, so asking again adds a step with no benefit |
| Reminders (REC-3) | Local notifications (expo-notifications, best-effort delivery) at 9 am, 3 days and 1 day before, rebuilt after every change, with a shortfall warning for bank accounts | No server push service or exact-alarm permission needed; the phone already has the balances |
| Marking paid (REC-4) | The architecture's "Recurring match" rule, applied after each capture and on app open, catching up several periods after an import | Idempotent, so re-running it is always safe |
| People | A person is a `person` account with an optional UPI ID and email, added by name or from the phone's contact picker | Balances stay sums of postings, and contacts never leave the phone (SPL-4) |
| Sharing IOUs (IOU-2) | One row per IOU, visible to the user signed in with the person's email. The other side answers through a database function that writes only their fields. No invite email is sent; the user shares a message from the phone | No SMTP or paid email service, and no way for either side to rewrite the other's answer |
| Repayments (IOU-4) | Each side records the repayments its own ledger saw; what is owed is the amount minus the larger side's total | Both phones can settle from their own SMS without double counting and without merging the two ledgers |
| Splits (SPL-1, SPL-2) | Personal only: shares move to person accounts in the payer's ledger, and each share is also a lent IOU. Someone else's payment is a manual entry with a borrowed IOU | Friends need not use the app, and settling a share reuses IOU settlement |
| Groups (SPL-3) | A group is a list of the user's people; its balances are each member's whole balance | Shared groups between app users come after the friends release |
| Contacts (SPL-4) | expo-contacts, READ_CONTACTS only (set in app.json), matched by the mobile number in a UPI ID or a name only one contact fits. App version 0.4.0, which needs a new build | The contact list and the link to a contact stay on the phone |
