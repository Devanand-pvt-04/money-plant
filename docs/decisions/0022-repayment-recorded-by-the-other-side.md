# 0022: A repayment the other side recorded first

Found by Deva on 2026-11-12, in the thread "Fix duplicate people in IOUs and splits". A friend confirmed a ₹68.67 split (their phone added "borrowed" to their ledger), then paid Deva back by UPI. Deva's phone saw the money first and recorded the repayment. The shared IOU then showed settled on both phones, so the friend's phone treated it as closed and never matched their own UPI payment to Deva. Their ledger kept the loan without the repayment, and People said they still owed ₹68.67.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| What a payment can repay | Matching (automatic, "Paid me back" / "I paid back", Review guesses) uses what this user's own ledger hasn't recorded (`unrecorded`), not what both sides agree is left | Each ledger needs its own repayment entry; the shared IOU only says how much is still owed |
| What the IOU shows | Unchanged: owed is the amount minus the larger side's repayments | Both people see the same number |
| When it's already linked by the other side | The IOU screen says the repayment isn't linked in this user's ledger yet, points to the payment in Activity, and offers "Record a repayment" for cash | So the person's balance can be fixed by hand when the payment didn't come from an SMS |

JS only.
