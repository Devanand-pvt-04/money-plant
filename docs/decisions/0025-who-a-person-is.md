# 0025: Who a person is

Decided by Deva on 2026-11-13, in the thread "Rework IOUs and splits", as step 1 of the IOU and split redesign ([proposal](https://claude.ai/artifact/1h9WB7JF8hmPw5wqT23iWi)). GPay only knows UPI IDs and Splitwise knows no banks at all. Money Plant has to recognise one friend across every bank account, UPI app and contact they use. Until now a person was a few columns (one email, a main UPI ID, ten extra, one phone), names were matched loosely, and nothing stopped two people holding the same thing. That is how one friend became two people (decision 0020).

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Model | A person is one record with any number of identifiers: UPI ID, mobile number, bank account (digits + bank), payee name. Each records where it came from: typed, learned, friend, contact | One place to match against, whatever the payment says |
| Strong and weak | UPI IDs, mobile numbers and bank accounts with their bank are strong. A payee name, or account digits without a bank, are weak | Names collide ("RAVI K"); UPI IDs and accounts don't |
| One owner | A strong identifier belongs to one person only. Its row id is derived from the identifier, so two phones write the same row and it can't sit on two people. Typing one that someone else has is refused with "merge them instead" | Removes the root of the duplicate-people mix-up |
| Matching | A strong identifier on exactly one person is certain. A payee name exactly one person has learned is used too. Account digits without a bank, or the person's own name, only suggest. Two candidates at the same level are no match | Never picks between two people silently |
| Learning | Tagging a payment to a person learns its UPI ID, the number in it, the account and the payee name, without asking. The person screen lists them, and each one can be removed | Fewer prompts, easy to undo |
| The user's own profile | Each user keeps their own UPI IDs, mobile, bank accounts and the names their banks print, in `my_identifiers`. Accepted friends read the ones marked shared; bank accounts keep only their last 4 digits and bank | A friend's phone recognises a payment from any of their accounts or apps |
| Friends | On each sync a friend's person takes the friend's shared identifiers, and drops ones the friend removed. Someone without an email who has one of the friend's strong identifiers is that friend and gets the email | The contact-then-friend case resolves itself |
| Self-transfers | A payment to or from one of the user's own strong identifiers is never asked about as a person | Paying your own other account is not a payment to a person |
| Duplicates | "Same person?" also pairs two people with the same bank account | Same rule as UPI IDs |
| Old data | The migration copies people's UPI IDs and phone, and the user's own from their sign-in metadata. Payee names linked on a phone become learned identifiers on that phone's next sync. `accounts.extra_vpas`, `accounts.phone` and the friend link's extra UPI ID and phone columns stay but are no longer the source | No data lost; old app versions keep working until the update |

`accounts.vpa` stays the UPI ID used to pay a person; it counts as one of their identifiers.

## Code

- `supabase/migrations/20261129000000_person_identifiers.sql`: both tables, row-level security (friends read only shared rows, through `are_friends`), the copy of old data, and `clear_my_data` clearing identifiers too. Tests: `rls.test.sql`, `identity.test.sql`.
- `packages/matcher/src/identity.ts`: normalising, strength, matching, clashes, self-transfers, with tests.
- `apps/mobile/src/lib/identity.ts`: the phone's store, sync of friends' profiles, the user's own profile.

## Later

Reading the other side's bank account from IMPS and NEFT SMS and statement rows needs the parser to tell it from the user's own account, with fixtures per bank. Until then bank accounts are matched where a payment carries them and are typed or shared by the friend.

The database change must be applied (`npx supabase db push`) before the over-the-air update.
