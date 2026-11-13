# 0027: Split types, a clearer split screen, and settling another way

Decided by Deva on 2026-11-13, in the thread "Rework IOUs and splits", after the first multi-person split (decision 0026, step 4) shipped. Deva found the split screen hard to use (a wall of person chips, two split modes), asked for the split types that Splitwise and the UPI apps offer, and asked for "mark as paid" when no payment exists to link: a mutual understanding, or a payment by some other means, which must not change any bank balance. [Mockups](https://claude.ai/artifact/EL4oGGXGeQs4mMs7rV6iMi). Deva asked to keep the app's existing palette, theme and design language.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Split screen | Its own screen (`/split`), separate from loans and repayments. Bill total and what it was for first, then who (avatars and an Add button that opens a people sheet with search, people you share with most first, someone new or from contacts), then how. Every person has a row, and so does the user. A bar at the bottom says whether it adds up and what the others owe | One question at a time; nothing hidden behind chips |
| Split types | **Equally** (tick who's in), **Amounts** (type each; the user's row is the rest), **Percent** (must reach 100%), **Shares** (whole units: 2 for a couple, 1 each for the rest), **Adjust** (equal, plus or minus an amount for someone) | What Splitwise offers; covers trips and couples |
| Leftover paise | Stay with the user when they are in the split; otherwise go one each to the first people, so the parts always add up to the bill | No paise lost, never a fraction |
| What is saved | Unchanged from decision 0026: one share per other person, tied by `group_ref`. The user's own part is what stays on the entry's category | No new server shape for split types; the type is how the user typed it, not data |
| Settle up | A **Settle up** button on a person (and on an open item) asks the amount (their whole balance by default, less for a part payment) and how it was paid: **it came into / went out of my bank** (link the entry, as today), **cash or another account** (a typed entry on that account), or **settled another way** | One place for every way a debt ends |
| Settled another way | A repayment item with `settled_outside = true`. Each phone writes the person leg against its own hidden **Settled outside the app** account (type `settled`, one per user, like the currency exchange account). It is not an account the user owns, not spending, not income | No bank, cash, budget or spending number moves. The person's balance goes to zero. Net worth drops by what they owed, which is true: that money isn't coming |
| Both phones | The other phone writes its own side when the item arrives, with no question to answer (it says it was settled; nothing enters a bank). Only the person who recorded it can change or remove it, as for every item | Same number on both phones; the creator-only rule stays |

## Code

- `supabase/migrations/20261202000000_settled_outside.sql`: `shared_items.settled_outside` (only on a repayment), account type `settled` (any currency). Tests in `shared_items.test.sql`.
- `packages/matcher/src/shared-items.ts`: `splitBill(total, method, rows, meIndex)` for every split type, with the leftover rule. Tests alongside.
- `apps/mobile/src/lib/shared.ts`: `EntrySide` gains `{ outside: true }`; `settledAccountId()` makes the hidden account; `reconcileItems` writes the other phone's side of an item settled outside.
- Screens: `app/split.tsx` (the new split screen, with `components/people-sheet.tsx`), `app/settle.tsx` (Settle up), the person page (Settle up), the item page (Settle up on an open loan or share). `item/new` keeps loans, repayments and a share someone else paid.
