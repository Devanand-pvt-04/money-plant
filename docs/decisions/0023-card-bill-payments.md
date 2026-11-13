# 0023: Card bill payments read from the bank's side

Found by Deva on 2026-11-13. An ICICI statement row `BIL/INFT/…/CC BillPay-7002/Self` paid Deva's credit card bill, but the import saved it as uncategorised money out. The matcher only knew a card bill payment when the card's own "payment received" message was in the ledger too; the row's own words that it paid a card (and which one) were ignored. The SMS path had the same gap, and a bank SMS that named a credit card ("A/c XX123 debited … towards Credit Card XX7002") was read as a spend on the card instead of a debit from the account.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| How a card bill is recognised | Wording in the SMS or statement remarks, for any bank: "CC BillPay", "CC payment", "credit card", "BILLPAY … CARD", "card bill/dues", ICICI's PAVC code, plus the 4 digits printed after it. Only on debits from a non-card account. Parsed into `cardBill: { last4 }` (LED-4) | Works without a bank list (decision 0017); the digits are a parsed field, so no raw text leaves the phone |
| Which card | The user's credit card whose last digits match: the transfer is confirmed. No digits printed, or the user's only card has no digits yet: the transfer waits in Review ("Looks like a transfer"). Digits that match none of the cards: it stays money out | A wrong guess between two cards moves a balance; asking costs one tap |
| The card's own message later | Attaches to the transfer within 3 days instead of becoming money in | One payment, one entry |
| An entry the SMS already made as money out | The statement row turns it into the card transfer, unless the user set its category or kind | Fixes past payments on the next import |
| Imported before the card existed | Importing the same statement again turns the old row into the transfer | Re-import otherwise skips rows it has seen |
| "Not a transfer: split it" on such a transfer | Turns it back into money out and removes the card's side | There is no card message to split off |
| No card account at all | Stays money out for now | Adding a card from a bill payment needs its balance, which the debit doesn't give; to discuss |

JS only.
