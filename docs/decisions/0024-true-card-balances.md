# 0024: True credit card balances

Status: proposed, for Deva to agree before any code.

Raised by Deva on 2026-11-13, after decision 0023. A card's balance today is only the sum of the entries the app saw. Bank SMS carry the account balance, so a bank account corrects itself (LED-7); card SMS don't carry the amount owed, so a missed spend stays missed. Deva's example: 5 card spends, 3 recorded, so the card shows −₹992. The bill is ₹3,102. Once the bill payment becomes a transfer to the card (decision 0023), the card shows **+₹2,110** when it is really at ₹0. Card statement PDFs are often hard to get, so the fix can't depend on them.

## Where the true amount owed comes from

Three sources, used in this order of trust. Each one becomes a balance anchor on the card, the same row a bank SMS balance makes today (`balance_anchors`), so the reconciliation that banks already have works for cards too.

| Source | What it gives | When |
| --- | --- | --- |
| Available limit in card SMS | Amount owed = credit limit − available limit, as of that SMS. Most Indian card spend, refund and payment SMS print it ("Avl Limit: INR 56,398.61"). The parser already reads it (`availableLimit`) and drops it | Every card SMS that prints it, once the card has a credit limit |
| Statement SMS | "Total due Rs.12,400.00 … Pay by 05-11-2026": the amount owed on the statement date. Read today but ignored | Once a month |
| The user | "Set current balance" (already on the account page) | Any time, for cards that send neither |

**Credit limit.** A new optional field on credit card accounts, typed once from the card app. Without it the available limit can't be turned into an amount owed, so those SMS add no anchor, and the card page asks for the limit with a short reason. The app can suggest the limit when it can work it out: on a day the user sets the balance, limit = amount owed + the available limit in that day's SMS. It still asks the user to confirm.

**Limit changes.** When the bank raises the limit, every SMS after it would show the card owing less than it does. A gap that appears all at once, with no entries around it, and stays the same over the next SMS is a limit change rather than a missed spend. The review item asks "Did your credit limit change to ₹X?" first.

**What the available limit includes.** Card EMIs block the whole unpaid principal, and some banks share one limit across a person's cards. Both are real money owed: an EMI's principal is debt, and a shared limit is entered once, on the main card, with the other cards marked "shares the limit of …". Pending authorisations also reduce the available limit for a day or two; a gap younger than 3 days waits before it is shown.

## What happens to a gap

The gap between the true amount owed and the recorded one is spending (or a fee) the app didn't see. In Deva's example it is ₹2,110. It is never hidden in the opening balance by default, because that would leave it out of budgets.

The review item ("₹2,110 of spending on ICICI Card ••7002 wasn't recorded, between 26 Oct and 13 Nov") offers:

1. **Add the missing entries**, when the user knows them. Quick add opens with the card and the date range filled in; the gap shrinks as entries are added.
2. **Record it as unrecorded card spending.** One expense entry on the card, uncategorised, dated in the gap window, with a "balance check" source. It counts in budgets and can be categorised or split later. **Recommended default.**
3. **Adjust the balance only.** The opening balance moves; no spending is added. For things that aren't spending (a limit change, an old balance from before the app).

Bank accounts keep their current fix ("trust the bank's balance") and gain options 1 and 2, so both behave the same.

## Safety check without any anchor

A card with no credit limit, no statement SMS and no balance set can still go wrong. A bill payment that would take a card above ₹0 is very likely the missing-spend case, not a real overpayment. The transfer is still made, and a review item asks: "This payment takes the card to +₹2,110. Did you spend that on the card without the app seeing it?" with options 2 and 3 above, plus "The card really is in credit".

## Data

| Change | Where |
| --- | --- |
| `credit_limit_paise` (nullable) and `limit_shared_with` (nullable account id) on `accounts` | Phone SQLite and a server migration. No new table, so the existing row-level security covers it |
| Anchors for `credit_card` accounts, with negative balances (amount owed) | `balance_anchors` as today; the pipeline writes them from `availableLimit` and from statement SMS |
| Statement SMS parsed as a card anchor instead of ignored | Parser: a "statement" result with total due and statement date, never an entry |
| Review reasons `card_gap` and `card_in_credit` | Matcher types and the Review screen |

Ships as an OTA plus `npx supabase db push` (db push first). No native change.

## Not in this decision

- Billing cycle, due dates and minimum due reminders. The statement SMS makes them possible later.
- Reward points and cashback.
- Reading card statement PDFs (CAP-5 already accepts them when the user has one; those rows are anchors too).
