# 0033: Patterns that adapt, and a speed and correctness pass

Asked for by Deva on 2026-11-17, in the thread "Review the code for optimisations" (CAT-8, HOME-2, LED-6).

## The problem

Learned patterns (decision 0004) never changed once accepted. When a habit moved a little, such as breakfast going from ₹40 to ₹60, or from 9:30 to 10:15, the app either proposed a second, nearly identical pattern, or, when the new pattern overlapped the old one, it proposed nothing and the user kept correcting by hand. A declined pattern blocked anything overlapping it forever, even after the user's habits changed. A pattern the user kept correcting kept guessing.

The same review found four places where the app did needless or incomplete work:

- Activity read only the newest 500 entries and picked the month from those, so once a user had more, older months showed only some of their entries, their totals came out too low, and search couldn't find them. Review had the same limit.
- Every sync asked the server for the rows at its cursor again, counted them as new, and so made the screen in view reload after every sync even when nothing had changed.
- Balances (every posting, fund and share values, deposit interest) were worked out up to three times for one Home load.
- Messages waiting for an account were read again on every catch-up, and an inbox scan rebuilt the categoriser (rules, categories, the whole merchant cache) for every message.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Widening a pattern | When at least 3 recent corrections to a category fall just outside a pattern the user has for it (amounts up to a quarter above or below, hours up to an hour either side, same account, payee kind and some of the same days), Review asks "Update pattern: Breakfast" to widen it to cover both. Accepting changes the existing pattern (it keeps its note, its confirm setting and its history); "Keep it as it is" declines the wider version | One pattern per habit, not a pile of near-copies, and the user still approves every change |
| A separate habit | Corrections far from any existing pattern still make a new pattern, as before | A dinner habit isn't a wider breakfast |
| Declined ideas | A declined pattern or widening blocks proposals only until 3 corrections fall outside what was declined | "No" means "not this", not "never anything near this" |
| Pausing | An active pattern corrected at least 3 times, and more often than it was right, shows "Pattern often corrected" in Review with Pause it, Change it (opens the rule) and Keep it as it is. Keeping it asks again only after 3 more corrections (remembered on the phone) | A pattern that has gone stale stops guessing, without the app deciding on its own |
| Activity and Review | Activity reads every entry of the month in view, or of the filter's dates; Review reads every entry waiting. The filter sheet's "Show N entries" says "Show entries" when the dates in the sheet differ from the ones loaded | Older months and their totals are complete |
| Sync | A pull counts only rows newer than its cursor (timestamps compared to the microsecond) | Screens reload only when something came in |
| Balances | One result is shared by every part of a screen that asks within 2 seconds, until the ledger changes | Home works balances out once instead of three times |
| Waiting messages | Read again only when the app's code, the user's accounts or their sender choices changed since the last read | Catching up every 2 minutes no longer re-reads them all |
| Inbox scans | One categoriser and store serve every message of a scan | Faster first imports and range re-reads |
| Server | Nothing new | JS only, ships by OTA, no db push |

## Code

- `packages/categoriser/src/patterns.ts`: `proposePatterns` proposes widenings (`PatternProposal.replaces`); `widenedPattern`, `shouldOfferPause`.
- `apps/mobile/src/lib/entries.ts`: `acceptWidening`, `pausePattern`, `keepPattern`, `keptAtMisses`. `components/review-rows.tsx` and `app/review.tsx`: the update and pause questions.
- `apps/mobile/src/lib/ledger.ts`: `listTransactions` takes `from` and `to`, with no default limit; `listAccountBalances` shares one result per ledger change (`ledgerGeneration` in `lib/events.ts`). `app/(tabs)/activity.tsx` loads its range.
- `packages/db-schema/src/remote.ts`: `isLater`, `newSince`; `lib/sync.ts` counts only new rows, `lib/realtime.ts` leaves change notices to sync.
- `apps/mobile/src/lib/capture.ts`: `waitingState` gates `readWaitingSenders`; `scanContext` during an inbox scan.
