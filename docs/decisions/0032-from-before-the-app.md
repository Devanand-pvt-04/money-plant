# 0032: Shares and loans from before the app

Asked for by Deva on 2026-11-17, in the thread "Add old splits without a payment entry" (IOU-1, IOU-6, SPL-3).

## The problem

A share the user paid, or a loan, waits for "the entry you paid with" (decision 0026): until a bank entry is linked, nothing is written and the person's balance doesn't move. A debt from before the user started the app (an old score) has no entry to link, and the user doesn't want any account balance to change for it. They only want the person to owe them, and the money to land in whichever account it is paid back into.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| The choice | **No payment, it's from before** on an item waiting for its entry (a share the user paid, or a loan either way), and **From before, no payment** when adding: a chip on the split screen, and an option in the account sheet for a loan. Not for a repayment: Settle up's "settled another way" (decision 0027) covers that | One tap for the case Deva hit; nothing new to learn |
| What is written | The person's leg against a second hidden account, **From before the app** (type `settled`, id derived from `system:before`), in the item's currency, dated the item's day | No bank, card, cash, budget or spending number moves |
| People and net worth | The person owes (or is owed) the amount like any other item, so net worth includes it (decision 0018). The per-person "doubtful" switch still leaves it out | It is money owed now, even if the bill is old |
| Paying back | Settle up as usual (IOU-6) into the account it comes in to: that account goes up, the person's balance goes to zero, nothing counts as income | The money lands where it actually lands |
| Changing it | A new amount rewrites the entry with the new amount. "Link a payment instead" takes it off again, so a real bank entry can be linked later | The user can correct either way |
| The other phone | No change. A friend accepts a share as today (their spending and what they owe); for a shared loan they can pick "from before" on their side too | Each phone writes only its own money (decision 0026) |
| Server | Nothing new: the hidden account uses the existing `settled` type and the choice is this user's own link to their own entry | JS only, ships by OTA, no db push |

## Code

- `apps/mobile/src/lib/shared.ts`: `EntrySide` gains `{ before: true }`; `makeHiddenEntry` writes the person leg against "Settled outside the app" or "From before the app"; `markFromBefore(id)` for an item already saved; `createSplit` takes `'before'`; `ItemView.fromBefore`; `reconcileItems` rewrites a from-before entry when the amount changes.
- `app/item/[id].tsx` (the choice on a waiting item), `app/split.tsx` (chip), `app/item/new.tsx` and `components/money-side-sheet.tsx` (loan option). Activity shows the entry as "From before the app" with a clock icon (`TransactionRow.fromBefore`).
