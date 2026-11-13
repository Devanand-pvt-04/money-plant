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

The app moves to shared items in step 3, which also retires `ious`, `iou_payments` and `split_groups`. Apply this migration (`npx supabase db push`) any time before that step's update; nothing uses it yet.
