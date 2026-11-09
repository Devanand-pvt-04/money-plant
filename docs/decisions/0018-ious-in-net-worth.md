# 0018: Lent and borrowed money in net worth

Decided by Deva on 2026-11-09, in the thread "Count lent and borrowed money in net worth". NW-1 always listed "money owed", but net worth only added up the user's own accounts. Lending ₹5,000 from a bank account made net worth drop by ₹5,000, though the money is still the user's; borrowing made it rise.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| What counts | Each person account's balance, in the home currency at today's rate (NW-7). Above zero is lent (an asset), below zero is borrowed (a liability) | Person balances already come from postings (IOUs, splits, someone else paying, repayments), so lending moves money from a bank account to a person account and net worth stays the same. No new totals are stored |
| Where it shows | A "Lent and borrowed" row on Accounts with "Lent ₹X · Borrowed ₹Y", opening People. Lent adds to "You own", borrowed to "You owe". It stays out of the "where it sits" bar, which shows the user's own accounts | Keeps IOUs apart from bank balances |
| Doubtful loans | Per person: "Count what they owe in net worth" on the person's page, shown while they owe the user. Turned off, only what they owe is left out; what the user owes them still counts | A doubtful loan is about a person, and their balance is one number across IOUs and splits. Leaving out a real debt would make net worth look better than it is |
| Where the choice is kept | The Supabase user's metadata (`doubtful_people`, a list of person account ids), like the home currency | Every device gets it with no table, migration or native change, so it ships as an over-the-air update. Changing it needs the network |
| History | Months rebuilt from the ledger include counted person accounts. Months already saved on the phone keep their saved value | Saved months were the true figure as then defined; rewriting them would need values the phone no longer has |

The pure sums live in `packages/core/src/owed.ts` with tests; `apps/mobile/src/lib/networth.ts` loads people and applies them.
