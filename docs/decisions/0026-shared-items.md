# 0026: Shared items (loans, splits and repayments between two people)

Decided by Deva on 2026-11-13, in the thread "Rework IOUs and splits", as step 2 of the redesign ([proposal](https://claude.ai/artifact/1h9WB7JF8hmPw5wqT23iWi)). The old IOU stored a loan and a split share the same way, as "lent" or "borrowed". When a friend split a bill with Deva and Deva confirmed it as borrowed, his phone added the share into his bank balance, although no money arrived. The two phones also kept separate copies that drifted apart when the owner edited or deleted (decision 0020). All IOU, split and people data was removed on 2026-11-13 and People was paused (PR #90) until this redesign ships.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| One shared record | `shared_items`: one row both people read (kind, flow, amount, currency, day, reason, the other person's email). Only the creator changes it | No copies to drift apart |
| Three kinds | **share**: one paid for something the other owes part of. **loan**: money moved. **repayment**: money moved back | Each kind says what goes into each ledger |
| Flow | From the creator's side: `to_them` (value went to the other person) or `to_me`. The other side sees it flipped | One field covers "I paid for you", "you paid for me", lending, borrowing and paying back |
| Each phone writes only its own money | A share where value came to the viewer makes spending plus "I owe", with no bank leg. A share the viewer paid, a loan or a repayment links the viewer's own bank entry: part of its category moves to the person, and the bank leg never changes | Fixes the borrowed-share bug for good |
| Links | `item_links`: each user's private link from an item to their person and their own entry. Row-level security lets a user link only items they are part of, their own people and their own entries | Neither side can touch the other's ledger |
| Answer | A friend accepts or declines a share (`answer_shared_item`). A new amount, kind or flow asks again; a new reason doesn't. Loans and repayments need no answer: the other side links its bank entry when it shows up | Nothing enters a ledger unseen |
| Balance | What two people owe each other is the sum of their shared items. A declined share never counts; one waiting counts for its creator only (their ledger already has it). Each phone compares this with its person account and shows any gap as "not linked on your side" | One number on both phones once answered |
| Finding the other side's entry | For a loan or repayment: an entry of exactly the amount, money in the right direction, within 3 days. The payee being that person (decision 0025) comes first, then the closest day | The friend's own SMS is the truth for their bank |
| People not on Money Plant | The same items, one-sided on the creator's phone. If they become friends later, items with their email reach them when the link is accepted | Most lending is with people who don't use the app |
| Groups | `group_ref` ties the shares of one group bill together; settling is person by person (step 4) | Simpler to trust; no debt simplification for now |

## Code

- `supabase/migrations/20261130000000_shared_items.sql`: tables, guard, row-level security, `answer_shared_item`, `friend_with_email`, items reaching a new friend, `clear_my_data`. Tests: `shared_items.test.sql`, `rls.test.sql`.
- `packages/matcher/src/shared-items.ts`: balance, postings each kind makes, linking and unlinking an entry, finding the other side's entry, status, ledger gap. Tests alongside.

## Step 3: the app

- `supabase/migrations/20261201000000_item_link_amounts.sql`: each link records what its entry carries for the item (kind, flow, amount, currency), so a change made later on the item is taken back out exactly, on any of the user's phones. `item_links` joins the realtime publication.
- `apps/mobile/src/lib/shared.ts`: items from the viewer's side, creating them with the user's side (an entry of theirs, a payment typed by hand, or the category of a share someone else paid), linking and unlinking, accepting and declining, finding candidates, Review's guesses, and `reconcileItems`, which runs after each sync and capture.
- Screens: `item/new` (from People, a person, the Split shortcut, or an entry's Split / I lent it / I paid back / I borrowed it / Paid me back), `item/[id]`, the People tab ("Waiting for you"), the person page. An entry that carries items shows them, and its category is changed for what is left after the people's parts.
- The People maintenance notice (PR #90) is gone. Due dates and their reminders are not part of shared items; the person page's Remind shares a message with a UPI "pay me" link.
- The app no longer reads or writes `ious`, `iou_payments` or `split_groups`; the phone drops its copies. The server tables stay until every phone has this update, so an older app still syncs, and a later migration drops them.

| Decision | Choice | Why |
| --- | --- | --- |
| Removed or changed items | The phone undoes its own link: the amount goes back to the entry's category (or Uncategorised, which sends the entry to Review), and an entry made only for the item (a share entry, a typed payment) is removed. A new amount is linked again to the same entry when it still fits | The ledger follows the shared row without the user redoing anything |
| Linking on its own | A loan or repayment links itself only when exactly one entry fits and its payee is that person (decision 0025). Otherwise Review asks "Is this the money you lent Ravi?" | No guessing on money between people |
| A friend who isn't in People yet | Their items show as "A friend" until the next sync makes them a person; answering waits for that | The friend link is what makes them a person (ACC-9) |

Deploy: `npx supabase db push` (both migrations) before the update.

## Step 4: one bill, several people

Decided by Deva on 2026-11-13 ("Yes proceed").

- The split form takes several people for a bill the user paid. Shares are equal (with or without the user, who keeps the odd paise) or typed per person. `createSplit` makes one share per person with one `group_ref`, all or none, and each one comes off the entry's category; what is left there is the user's own part.
- Each friend sees and answers only their own share, and each settles person by person. The creator's item page lists the other shares of the same bill.
- Named groups that remember a set of people (a trip, flatmates) aren't built yet; the server's `split_groups` table stays retired.
- No migration: `group_ref` was already on `shared_items`.
