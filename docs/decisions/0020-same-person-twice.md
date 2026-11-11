# 0020: The same person twice (merge, remove, stale shared IOUs)

Decided by Deva on 2026-11-11, in the thread "Fix duplicate people in IOUs and splits". A friend was added from phone contacts under another name before he joined Money Plant, so after he joined Deva had him twice ("Peakesh Reddy" with his UPI ID, and "Tushar" from the friend link with his email and the same UPI ID). Fixing it by hand left a mess on both phones:

- Giving the contact the friend's email shared every IOU with them, including a loan already paid back. The friend can't see repayments before confirming, so it looked owed.
- The friend confirmed it, which added a loan entry to his ledger. Deva then deleted the IOU; it vanished from the friend's phone but his loan entry stayed, so his People tab said he owed ₹150.
- An IOU taken back by changing or removing the email is hidden from the friend by row-level security, so the change never reached his phone and his copy stayed forever.
- Opening a borrowed IOU with nothing left to pay crashed the screen (a UPI link for ₹0).

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Duplicates at entry | Saving an email or UPI ID another person already has is refused, with "merge them instead" on the person screen. Only a field that changed is checked, so an older clashing pair can still be renamed | Two people with one email is the root of the mix-up |
| Suggesting merges | People shows "Same person?" for pairs with the same email, the same UPI ID, or the same name where one has no email. "Not the same" hides the pair on this phone | Catches the contact-then-friend case right after the friend joins, without guessing silently |
| Merge | Moves every entry leg, IOU, group membership, phone contact, payee name and a missing UPI ID to the kept person, then removes the other. The kept one is the person with an email (the Money Plant member). Two different emails can't merge | Balances stay sums of postings; entries keep their ids and sources |
| Sharing on merge or new email | Only open IOUs are shared; settled ones stay private. A settled IOU shared with an email that is changing is taken back | A settled IOU reaches the other person without its repayments and looks owed |
| Remove person | Someone nothing refers to is removed as before. Someone with history is removed only when settled (no balance, no open IOU, in no group, not linked by email); their past entries keep their name | Lets the user tidy up without losing history; open money must be settled or merged first |
| Owner deletes or takes back a shared IOU | On the other phone, what that user's ledger added for it is undone like the owner's delete: an entry typed by hand goes, a bank SMS entry goes back to review. Their own repayment records on it are dropped locally | Otherwise the entry stays behind and the person looks owed |
| Hidden shared IOUs | Each sync lists the shared IOU ids the server still shows; any other shared IOU on the phone is marked gone | The pull is incremental, so a row that became hidden never comes down |
| Pay link | No UPI link when nothing is owed | Fixes the crash |

All of it is JS only, so it ships over the air to 0.11.0. Pure rules are in `packages/matcher/src/people.ts` with tests; the merge is `apps/mobile/src/lib/merge-people.ts`.

## Later (not in this change)

Several UPI IDs per person, and for the user: one main ID for paying, extra IDs only for recognising payments, learned when a payment is tagged and shared through the friend link. Needs a database change, so it comes as a separate step.
