# 0031: SIP orders until units are allotted

Decided by Deva on 2026-11-17, in the thread "Track SIP orders until units are allotted" (NW-3).

## The problem

A SIP debit became a transfer into its fund, and the units it bought were estimated straight away from a line drawn between the CAS NAV and the latest NAV (decision 0013). Real orders take one to three days: the debit, then the money reaching the fund house, then units at the NAV of that day. A Sunday debit gets Monday's NAV, so the estimate could be a day or more off.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Stages | Each payment into a fund after its CAS is an order with three stages: **Paid** (the debit), **In progress** (waiting for the NAV of its day) and **Allotted** (units at that NAV). The fund page shows them on each payment in its history | Matches what fund apps show |
| Which NAV | By default the first NAV AMFI publishes **after** the debit day: Sunday, Saturday or Friday debits get Monday's NAV, Monday's gets Tuesday's. Holidays need no calendar: a day with no NAVs at all is skipped | Bank auto-debits usually reach the fund house a business day later; Deva picked this |
| Learned per fund | On each CAS import, the purchases are paired with payments into the fund up to 7 days before them. A weekday debit priced the same day votes for "same day", one priced the next business day for "next day"; the majority wins for that fund (kept on the phone), a tie keeps the default | Fixes funds and platforms that price on the debit day |
| While in progress | The money counts at what was paid: no gain yet, net worth unchanged | Nothing is known about its units yet |
| Picking up the NAV | Automatic. Once the expected day has come, the phone asks `nav-history` (new `after` field) at most every 3 hours for the first NAV on or after the order's day and keeps it in a local `nav_after` table (never synced; past NAVs don't change). A day that lists other schemes but not this one, or today before AMFI publishes, gives nothing yet, so a late NAV is never mistaken for the next day's | AMFI publishes a day's NAVs late that evening; no action needed from the user |
| NAV never arrives | Five days after the expected day, the order falls back to the old estimate (navOn) and says so | A scheme renamed or missing from AMFI's report shouldn't hide growth |
| Liquid and overnight funds | Same rule for now; they price at the previous day's NAV, but nobody has a SIP in one yet | Keep it simple |
| Not now | Reading the fund house's "units allotted" SMS (exact units). Needs a few anonymised samples first | Optional |

The next CAS still replaces all of this with the statement's units.

## Code

JS and one edge function, no new build, no migration.

- `packages/core/src/sip-order.ts`: `navFrom`, `firstWeekday`, `learnNavLag`, `sipOrder`, `ordersTotal`.
- `packages/core/src/fund-views.ts`: `holdingValue` takes the orders' inputs and returns `orders` and `pendingPaise`.
- `apps/mobile/src/lib/funds.ts`: `fundValues` passes each fund's lag and published NAVs; `fetchOrderNavs` runs from `refreshFunds`; `importCas` learns the lag.
- `packages/db-schema`: local-only `nav_after` table (local migration).
- `supabase/functions/nav-history`: `after` days. Deployed by the Edge functions workflow, or `npx supabase functions deploy nav-history`. Until it is deployed, orders stay in progress and fall back to the estimate after five days.
- Fund page (`app/account/[id].tsx`): each payment shows its stage and, once allotted, its units and the NAV's day.
