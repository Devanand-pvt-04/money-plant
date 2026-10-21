# 0002: SMS capture and ledger (milestone 2)

Date: 2026-10-21. Proposed in the milestone 2 PR, for Deva to review.

| Decision | Choice | Why |
| --- | --- | --- |
| Native capture | A local Expo module (`apps/mobile/modules/sms-reader`): an SMS_RECEIVED receiver, a notification listener limited to UPI and bank apps, and a headless JS task | Every capture path runs the same TypeScript pipeline, also when the app is closed. No constant background service |
| Missed messages | On each app open, read the SMS inbox from the last processed message onward | The receiver can be blocked by the OS; the inbox is the backstop, and fingerprints make re-reading harmless |
| Duplicate protection | Fingerprint = SHA-256 of normalised sender, the service centre timestamp (`date_sent`) and the text | The receiver and the inbox both see the same `date_sent`, so the same message never becomes two entries |
| Raw text | Stored only in the phone's encrypted database (`sources.raw_text`, `capture_log.raw_text` for failures). Never synced, logged or sent to AI | LED-2 wants the user to see the source; the privacy rule says the text never leaves the phone |
| Uncategorised postings | Until milestone 3, the other side of every entry is a per-user "Uncategorised spending" or "Uncategorised income" category account, with an id derived from the user id | Keeps double entry from day one; derived ids stop two phones creating duplicate category accounts |
| Opening balances | Each account has a local reference point: the balance the user typed (and when), or the earliest balance the bank reported in an SMS. The opening balance is recomputed from it after every capture | Importing 6 months of history never changes a balance the user or bank stated; reconciliation (LED-7) then flags real gaps |
| Account digits | `accounts.last4` accepts 3 or 4 digits; "234" matches "1234" | ICICI prints only 3 digits |
| Debit cards | A debit card spend goes to the bank's only savings account when the card number is unknown | Debit card numbers differ from account numbers |
| Transfers and card bills | A debit and a credit of the same amount between two own accounts within 24 hours (3 days with a card) merge into one transfer. Confirmed automatically only when both messages share a reference; otherwise it waits in review | Balance-neutral either way; a wrong merge is a one-tap split |
| Server writes | Transactions sync through `push_transactions`, a database function that writes the entry, its postings and sources in one database transaction and rejects unbalanced or sourceless entries | Enforces the ledger rules server-side without an edge function |
| Parser formats | Templates per bank plus a generic fallback. Current fixtures are synthetic; real anonymised samples go in `fixtures/<bank>/real.json` | No real messages were available when this was written |
