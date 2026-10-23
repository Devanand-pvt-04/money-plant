# 0004: Categories, rules and budgets (milestone 3)

Date: 2026-10-22. Proposed in the milestone 3 PR, for Deva to review.

| Decision | Choice | Why |
| --- | --- | --- |
| Categories | Category accounts with `parent_id`, two levels deep (CAT-5). A deferred trigger on the server rejects a third level. Standard categories carry a `category_key` such as `food.lunch`; categories the user makes get `custom`, `income.custom` or `<root>.custom` | Keys let the dictionary and the AI name a category without knowing the user's own names, and tell spending from income |
| Default categories | Seeded on first open with ids derived from the user id and the key | Two phones seed the same rows, so sync never duplicates them |
| Order of categorisation | User rules, then learned patterns, then the built-in merchant dictionary and the local merchant cache, then AI (CAT-2). Patterns run before the people check (CAT-4), so a learned "lunch at 1 pm, ₹150 to ₹250" pattern can place a payment to a person | Matches the pointer decision: the user's own choices win, and the AI only sees what nothing local could place |
| Learned patterns (CAT-8) | Proposed on the phone after 3 corrections to the same category within 30 days, with a ±25% amount band, a 2-hour time window and the same weekday set, account and payee kind. Stored as rules with `kind = pattern` and `status = proposed` until accepted; declined proposals are kept so they aren't offered again | Learned locally, not by the AI, as decided on 2026-10-22 |
| Edits stick | `user_set_fields` lists the fields the user changed (LED-8). Recategorising, merging a notification and transfer matching never overwrite them | User control pointer |
| "Why" labels (CAT-6) | Every entry stores `category_reason` (rule, pattern, dictionary, ai, user) and the rule id | The entry screen can say "Your rule: Swiggy → Food > Delivery" |
| AI privacy | The AI gets the merchant label, a UPI handle only when it has fewer than 6 digits, an amount band, the time of day and the category list. Payments to people never go to the AI | No phone numbers or account digits leave the parsed fields |
| AI cost | The categorise function checks a global cap (`AI_MONTHLY_CAP_USD`, default $5) and a per-user cap (`AI_USER_MONTHLY_CAP_USD`, default $1) in the `ai_usage` table before each call, by India calendar month. One Haiku call handles up to 25 merchants. Also set a spend limit in the Anthropic console as a second stop | Free tiers only, with Claude under a hard monthly cap |
| Shared merchant answers | Answers with confidence 0.8 or more go to the global `merchants` table, which only the service role writes. Unsure answers wait in review and are shared after the user confirms them | Matches the architecture notes; one answer serves every user |
| Budgets (BUD-1) | One row per category (or overall) per month it was set. A budget applies from that month until a later row changes it; a row with no limit removes it. Sub-category spending counts toward the parent | Setting a budget once covers every month, while past months keep the budget they had |
| Pace alerts | A local notification when spending passes the budget, or when more than 20% of the month has gone and the projection is over 110% of the budget. Each alert fires once per category per month | BUD-2, without a server push service |
| Custom account types | `account_types` rows with a fixed class (asset or liability) and a net worth switch. Accounts of these types use `type = custom` (ACC-6) | Chit funds, PF, gold and so on, without changing the ledger rules |
