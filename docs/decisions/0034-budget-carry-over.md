# 0034: Carrying a budget's leftover or overspend into the next month

Asked for by Deva on 2026-11-18, in the thread "Shape budget carry-over" (BUD-5).

## The problem

A month's budget started fresh every month. Money left in a category was forgotten, and an overspend didn't count against the next month, so a careful month earned nothing and an expensive one cost nothing. Deva wants to choose, per category and per month, whether a leftover carries forward or an overspend comes off the next month's budget. There is no fixed setting: the user answers each time.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Where it is asked | In the month review of last month, under "Leftovers and overspends", one question per budgeted category: "Carry ₹800 into November" or "Leave it", and "Take ₹1,200 off November" or "Leave it". While any are unanswered, the Budgets tab shows a card for the current month that opens the review | The review already opens on the 1st, and the card catches users who skip it |
| Which categories | Those with a budget in both months, at the level the budget sits (the parent, or each sub-category; BUD-1). A category with no budget in the new month gets no question | A carry needs a budget to land on |
| Amount | Fixed when the user answers: last month's budget (its own carry included) minus what it spent. A late SMS for last month doesn't change it. Answering again takes the amount afresh | Predictable; the new month never shifts on its own |
| Chaining | A carried amount is part of the month's budget, so its leftover can carry again into the month after | Behaves like an envelope; one rule, no exceptions |
| Skipping | No answer means nothing carries. The question stays open for the whole new month, then goes away | Nothing changes without the user's say |
| Changing an answer | Allowed while the new month is open, from the same review | Mistakes are cheap to fix |
| Carry all | A "Carry all" button answers every open question at once: leftovers carry and overspends come off | Saves a dozen taps; per-category answers stay possible |
| Floor | A budget never goes below ₹0. An overspend bigger than a month's budget takes it to ₹0 and the rest comes off the months after (see below) | A negative budget means nothing to a user |
| Separate from the budget | The carry is stored apart from the default and the one-month override, and shown as "₹5,000 + ₹800 from October". Changing or resetting the month's budget keeps the carry | Two different intentions; neither should erase the other |
| Totals | The month's total budget, pace, alerts and daily allowance all use the budget with its carry | The total is already the sum of category budgets (decision 0009) |
| Server | A new `budget_carries` table: one row per category per month it lands in, with a signed amount (positive carried in, negative taken off, zero for "Leave it") | Syncs to the user's other phones; needs a db push before the OTA, no new APK |

## Part 2: overspends that outlast a month

Asked for by Deva on 2026-11-20 in the same thread: an overspend bigger than next month's budget should keep coming off later months until it's cleared, as the default, with the user able to control it.

| Part | Choice | Why |
| --- | --- | --- |
| Default | After "Take off", each month takes as much as its budget allows (its budget plus anything carried in), oldest overspend first, until the overspend is cleared. No new question in later months | One decision, followed through |
| Spread | "How?" under "Take off" offers As needed or Over 2 to 6 months: equal parts, the first rounded up (₹7,000 over 3 months is ₹2,334, ₹2,333, ₹2,333). A month that can't take its part passes the shortfall on, and anything left after the last month comes off as needed | Keeps a big overspend from wiping out a whole month |
| New overspends | A later overspend is its own question and queues behind earlier ones | Same rule every month |
| Months without a budget | The overspend waits and comes off the next month that has a budget for that category | "As many months as required" |
| Budgets change | Months take from whatever budget they have; raising a later month clears it sooner | No stored schedule to fall out of date |
| Change and Stop | The category's budget page lists overspends still to come off, through which month, with Change (as needed or a spread) and Stop carrying the rest. Both apply from next month: the row stops after this month and, for Change, a new row continues it with what's left, so months already taken stay as they were | Control without rewriting history |
| Server | `budget_carries` gains `spread_months`, `stopped_from` and `continues_id`. Rows continuing an earlier overspend are not answers to a month's question. Answering a question again removes rows that continued it | Needs a db push before the OTA (Deploy runs it) |

## Code

- `supabase/migrations/20261203000000_budget_carries.sql`: the table, row-level security, `clear_my_data` deletes it. `supabase/tests/database/rls.test.sql` covers it.
- `packages/core/src/budget.ts`: `withCarries` (budget plus carry, floored at zero), `carryQuestions`, `absorbDebts` and `debtClearsBy` (part 2).
- `supabase/migrations/20261204000000_carry_spread.sql` (part 2): spread, stop and continues columns.
- `packages/db-schema`: `budgetCarries` (SQLite) and its remote mapping. `apps/mobile/src/lib/sync.ts` pushes and pulls it.
- `apps/mobile/src/lib/budgets.ts`: `monthOverview` applies carries (`BudgetLine.carry`); `carryChoices`, `answerCarry`, `carryAll`.
- `apps/mobile/src/app/month-review.tsx`: the "Leftovers and overspends" section. `app/(tabs)/budgets.tsx`: the card and the carry on each category; `app/budget/[id].tsx`: the carry under the month's budget.
