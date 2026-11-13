# 0028: UI revamp round 2 (Review, People, Bank SMS)

Decided by Deva on 2026-11-13, in the thread "Review screens for a UI revamp". Most screens reached their final shape in decision 0015 and the people work (decisions 0026, 0027). An internal review found the screens that still used the older look: big cards with stacked full-width buttons and paragraphs of explanation. [Mockups](https://claude.ai/artifact/53P5dgzmBFTw2LgYq2RQ8k) (today next to proposed). Deva approved all suggestions. The palette, the charcoal money card and the design language of decision 0015 stay.

## Choices

| Screen | Choice | Why |
| --- | --- | --- |
| Review (LED-6) | A money card on top: how many are left, about how long, and how many already have a category. Filter pills: All, Questions, By payee, Older (only those with something in them). Questions (balance gaps, cards in credit, new senders, learned patterns, suggested recurring payments) become one-line rows in a tinted panel; tapping one opens a sheet with its choices. Entries are compact rows grouped by day: the category is a chip that opens the picker, a round check confirms, a payment to a person shows small "I lent this / Paid back / Split" chips. Swipe right confirms, swipe left removes (after a confirm), as today. A bar at the bottom confirms every entry that already has a category | The inbox is the most used screen after Home. A row takes one tap instead of a card with five controls; long explanations move into the sheet where the choice is made |
| Balance gap sheet (LED-7, decision 0024) | The sheet shows the bank's figure and the app's figure side by side, then the same choices as today as option rows with one line each. The user always chooses | Same behaviour, less text up front |
| People tab | A money card: overall you'll get back (or owe), owed to you and you owe with how many people, and round shortcuts (Split a bill, Lend, Repayment, Add a person). Items waiting for an answer show as tinted banners that open the item. Filter pills: All, Owe you, You owe, Settled. Each amount says "owes you" or "you owe". People with nothing open sit under Settled. One way to add: the shortcuts; the header button and the floating button go | Matches the person page (decision 0027) and the other tabs; one place to start each action |
| Bank SMS (CAP-2, CAP-11) | A status money card: whether new messages are read, the permissions ticked, and the privacy line. "Read older SMS" and "Import a bank statement" are rows; the range picker opens in a sheet. Senders are rows (account, counts); tapping one opens a sheet to change or pick its account, unlink, ignore or read again. Messages the app couldn't read and "Test a message" sit under "Help the app read your bank", each opening a sheet | A settings page that says it is working, not a wall of text |
| Recurring payment page | The money card shows the amount, how often and the next date; actions are round shortcuts (I paid this one, Skip, Pause or Resume). Editing stays the same form, opened with a pencil | Same shape as the entry and person pages |
| Shared item page | Change and Remove move to the header and a quiet link; the edit form opens in a sheet | Fewer stacked buttons |
| Month review, category month | Their headline numbers sit on the money card | Every drill-in looks like its tab |
| Wording for friends | Where the app names the AI PC or who receives a shared sample, Deva sees "your PC" and "Share"; friends keep "Deva's PC" and "Share with Deva" (the consent screen already says Deva runs the server and the AI). The Speed log is shown only to the admin | Accurate for both; developer tools stay out of friends' Settings |

## Code

JS only, no new build, no migration.

- `components/review-rows.tsx`: the question rows and their sheets (gap, card in credit, new sender, pattern, suggested recurring payment).
- `app/review.tsx`: money card, filters, day groups, compact rows, confirm bar.
- `app/(tabs)/people.tsx`: money card, shortcuts, waiting banners, filters.
- `app/capture.tsx`: status card, rows and sheets.
- `app/recurring/[id].tsx`, `app/item/[id].tsx`, `app/month-review.tsx`, `app/budget/[id].tsx`: money card headers.
- `lib/admin.ts`: `useIsAdmin()` (the `admin` role in app metadata, decision 0016).
