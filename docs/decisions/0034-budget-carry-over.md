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
| Floor | A budget never goes below ₹0; an overspend bigger than the next month's budget takes it to ₹0 and the rest is dropped | A negative budget means nothing to a user |
| Separate from the budget | The carry is stored apart from the default and the one-month override, and shown as "₹5,000 + ₹800 from October". Changing or resetting the month's budget keeps the carry | Two different intentions; neither should erase the other |
| Totals | The month's total budget, pace, alerts and daily allowance all use the budget with its carry | The total is already the sum of category budgets (decision 0009) |
| Server | A new `budget_carries` table: one row per category per month it lands in, with a signed amount (positive carried in, negative taken off, zero for "Leave it") | Syncs to the user's other phones; needs a db push before the OTA, no new APK |

## Code

- `supabase/migrations/20261203000000_budget_carries.sql`: the table, row-level security, `clear_my_data` deletes it. `supabase/tests/database/rls.test.sql` covers it.
- `packages/core/src/budget.ts`: `withCarries` (budget plus carry, floored at zero), `carryQuestions`.
- `packages/db-schema`: `budgetCarries` (SQLite) and its remote mapping. `apps/mobile/src/lib/sync.ts` pushes and pulls it.
- `apps/mobile/src/lib/budgets.ts`: `monthOverview` applies carries (`BudgetLine.carry`); `carryChoices`, `answerCarry`, `carryAll`.
- `apps/mobile/src/app/month-review.tsx`: the "Leftovers and overspends" section. `app/(tabs)/budgets.tsx`: the card and the carry on each category; `app/budget/[id].tsx`: the carry under the month's budget.
