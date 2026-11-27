# 0037: A clearer Rules screen, counts that add up, and patterns that earn trust

Asked for by Deva on 2026-11-27, in the thread "Make rules and patterns clearer" (CAT-7, CAT-8).

## The problem

Settings → Rules and patterns listed each rule as `Payments to "kpclean" → Household · Confirms directly · right 0 · corrected 0`, and each pattern as one long sentence. It was hard to read, and the numbers were wrong.

"Right" went up only when the user pressed Confirm on an entry in Review, or picked the category the rule had already chosen. A rule or pattern that confirms directly never sends its entries to Review, so it stayed at 0 however often it was right. Picking the same category also marked the entry as the user's, which dropped the rule's link. Because the pause question (decision 0033) compares corrections with right answers, a pattern that confirmed directly was offered for pausing after 3 corrections even when it had been right dozens of times.

Patterns widened when habits drifted and could be paused, but one that asked first kept asking forever, and one corrected often could only be paused, not made to ask first.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Right ("kept") | Counted from the entries: confirmed entries that still carry the rule's or pattern's category (`category_rule_id`, reason rule or pattern). The stored `hits` column is no longer written or read | Correct for rules that confirm directly, correct for every past entry straight after the update, and it can't drift from the ledger |
| Corrected ("changed") | Still stored (`misses`), counted when the user picks a different category | The correction clears the entry's link, so it can't be counted from entries |
| Picking the same category | Keeps the rule's link and reason, so it counts as kept | It was the rule's answer |
| Filing by itself | A pattern that asks first and is kept at least 8 times, and at least 8 times per change, shows "Pattern often right" in Review: File by itself (also confirms entries waiting with its guess) or Keep asking me (asked again after 8 more kept, remembered on the phone) | Trust is earned from the user's own answers, and the user still decides |
| Asking first | The "Pattern often corrected" question gains Ask me first for a pattern that files by itself. Like Keep it as it is, it asks again only after 3 more changes | A softer step than pausing |
| The screen | Mockup D (a mix of B and C): a summary card (entries sorted, kept, changed), Rules and Patterns tabs, cards grouped by top-level category. A rule card shows the payee, its category and chips (UPI ID, amount, direction); a pattern card shows its category and chips (time, days, amount, payee kind, account). Each card shows Files by itself, Asks first or Paused, and a kept/changed bar | Easier to scan; the conditions read as pieces instead of one sentence |
| Server | Nothing new | JS only, ships by OTA, no db push |

Mockups: https://claude.ai/artifact/HCKZ8bXKehAStCZfgbmSYJ

## Code

- `apps/mobile/src/lib/rules-store.ts`: `keptCounts`, `toRule(row, kept)`; `countCorrection` replaces `countRuleOutcome`.
- `apps/mobile/src/lib/entries.ts`: same-category picks keep the rule's link; `askFirst`, `trustPattern`, `keepAsking`, `askedAtRight`.
- `packages/categoriser/src/patterns.ts`: `shouldOfferAutoConfirm`, `patternParts`.
- `apps/mobile/src/app/rules.tsx`: the new screen. `components/review-rows.tsx`, `app/review.tsx`: the two questions.
