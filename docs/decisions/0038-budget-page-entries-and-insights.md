# 0038: A budget page that opens on its entries, with insights that help

Asked for by Deva on 2026-11-27, in the thread "Make the budget page more useful" (BUD-3).

## The problem

A budget's page showed four month bars, "Where it went" grouped by the payee exactly as each bank wrote it, and "Largest entries". One shop showed up as four rows (AMAZON PAY INDI, AMAZON PAY IN E, Amazon India, AMAZON), the largest entries repeated those rows, and there was no way to see every entry that counts against the budget. Deva wants the entries first, and insights that say something useful.

## Choices

Deva looked at three mockups (entries first; a pace chart and tiles; Entries and Insights tabs) and asked for a mix of all three.

| Part | Choice | Why |
| --- | --- | --- |
| Header | Category, month, days left, and arrows to step to earlier months (not past the current one) | Any month's page is one tap away |
| Money card | Spent of budget, then a line of spending through the month against an even pace to the budget, with where today's pace ends drawn ahead. Under it: what's left, about how much a day, and where the month ends at this pace | Pace as a picture says more than a bar with a tick |
| Insight chips | Up to three one-liners under the card: over or under even pace, one entry that is a big part of the month, more or less than last month by the same day. A tap opens Insights | The headline facts without scrolling |
| Tabs | Entries (opens first) and Insights | Entries are what Deva wants first; insights stay one tap away |
| Entries | Every entry counted in this budget (sub-categories included), grouped by day with day totals. By place groups them by shop with a share; Biggest sorts by amount. Filters: top places, sub-categories, accounts, one at a time, showing the filtered count and total. Each row: place name (or the user's note), then the payee as the bank wrote it when that differs, the sub-category, the account | One list answers "what went into this budget" |
| Places | Payee spellings of one shop count as one place. A shop the built-in merchant dictionary knows by name takes that name ("Amazon"). Other names group when, cleaned and without spaces, one starts with the other (4 letters at least), and take their most used spelling. Kinds of place in the dictionary (Fuel, Cab, Rent and the like) never merge different shops. No guessing at misspellings ("Google Pay" is not "Google Play") | Matches how payee matching already works for recurring payments (2026-11-18) |
| Insights tab | Four tiles: safe to spend a day, where the month ends at this pace, the biggest entry's share (and the total without it), and last month by the same day. Then the last 6 months with the 3-month average, where it went (sub-category split and places with share bars; a place opens the entries filtered to it), recurring payments still due this month, overspends coming off (decision 0034), and the budget settings | Each answers a question a user has about a budget; the settings move here as they're used less often than the entries |
| Standout entry | Called out when one entry is at least a quarter of the month and there are others | Below that, one entry isn't the story |
| Month review | Uses the same place grouping for its top payees | One shop, one name, everywhere |

## Code

- `packages/categoriser/src/places.ts`: `groupPlaces` (tests in `places.test.ts`).
- `packages/core/src/budget.ts`: `daysInMonth`, `runningTotals`, `spentThrough`, `standout`.
- `apps/mobile/src/lib/budgets.ts`: `categoryBreakdown` groups places and, with `{ page: true }`, returns the entries with their accounts, 6 months, the running total, last month by the same day and recurring payments still due.
- `apps/mobile/src/app/budget/[id].tsx`: the page. The pace chart uses the plain-view `LineChart`, so this ships over the air with no new build.
