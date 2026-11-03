# 0014: Health screen, demat holdings and long-term savings

Decided by Deva on 2026-11-03, after the product review (https://claude.ai/artifact/Y4d8ip17UySU51xKu8oETu) and the investments discussion in the same thread.

## Order of work

| Step | What | Size | Why this place |
| --- | --- | --- | --- |
| 1 | Settings → Health (HOME-3) | About a day | Milestone 6 has to show it reached 90% categorised without edits, so measuring starts before it |
| 2 | Demat statement import (NW-5) | About 3 days | One NSDL or CDSL statement covers shares, ETFs, gold bonds, demat bonds and often NPS: the biggest gap for the least work |
| 3 | Long-term savings (NW-6) | About 3 days | PPF, EPF, NPS, NSC, KVP and Sukanya Samriddhi reuse the FD and RD maths |
| 4 | Milestone 6, AI | 2 to 3 weeks | Waits on Deva's five answers in the AI plan; steps 1 to 3 run meanwhile |
| 5 | Milestone 7, friends release | | AI first, because without it Review buries a new user |

Collecting friends' HDFC, HSBC and SBI samples (one set of anonymised SMS and one statement PDF each, from three to five friends) starts now, alongside steps 1 to 4, and feeds milestone 7.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Health (HOME-3) | Worked out on the phone over the last 30 days, nothing new stored on the server: share of entries captured automatically (any source but manual), share of automatic categories left unchanged, average time a day in Review, and for each bank account the gap between the ledger and the balance in its latest SMS. Each line shows the PRD target beside it | The PRD targets were never measured |
| Categories left unchanged | Counted on entries that came from SMS, a statement or a CAS and are confirmed: a category set by a rule, pattern, the dictionary, a refund match or the AI counts as accepted; a category the user set counts as edited. An entry the user categorised in Review with no guess counts as edited too, so the figure is a slight underestimate | The ledger keeps who set a category, not what it was before |
| Time in Review | The phone adds up the seconds the Review screen is open and the app is in front, per day, kept on the phone only | The 2-minute target is about Review |
| Demat import (NW-5) | An NSDL or CDSL CAS PDF through the same parse-cas function and Python service (casparser reads both). Each demat account becomes one Stocks account holding one row per share, ETF, gold bond or bond. Mutual funds held in demat join the existing fund accounts when the ISIN matches, otherwise they sit on the demat account valued by AMFI NAV. Owner names, PAN, DP and client IDs are dropped before the response, except the last 4 digits of the client ID, which name the account | One file a month covers every broker |
| Share prices | The phone asks a new stock-prices edge function at most every 6 hours for the ISINs it holds. The function reads the day's NSE closing-price file (BSE as a fallback for shares only listed there) and returns only those ISINs. Before the first fetch the statement's price is used | Free public files, same pattern as nav-prices |
| Cost of shares | Depository statements carry no purchase cost for shares. Cost is left unknown and the account shows value only, with "Add what you paid" on each holding (average price × quantity). Gain shows once a cost is known. A broker holdings file with average prices can fill it later | Showing value as cost would repeat the KFinTech zero-gain bug |
| Money to a broker | Debits to a known broker payee (Zerodha, Groww, Upstox, Angel One, ICICI Direct, HDFC Securities, Kotak Securities, Dhan) become transfers into the demat account, and credits from them transfers out, like SIPs into funds | Buying shares is not spending |
| Long-term savings (NW-6) | PPF, EPF, NSC, KVP and Sukanya Samriddhi are deposits with a new kind each. The rate is pre-filled with the current government rate and editable. PPF and Sukanya compound yearly on the lowest balance between the 5th and the month's end; NSC compounds yearly and pays at 5 years; KVP doubles the amount at its stated maturity. Payments matched by payee become transfers into the account. Interest is shown as an estimate and posted as income when credited | Reuses the FD and RD engine and its reminders |
| EPF | The balance is set from the EPFO passbook. If Deva shares an anonymised EPFO contribution SMS, a template reads its passbook balance as a balance check | Employer contributions never pass through the user's bank |
| NPS | Units per scheme come from the NSDL CAS when the PRAN is linked; otherwise the user types units per scheme from the NPS app. Value uses the NPS Trust daily NAV through the stock-prices function, falling back to the statement NAV. Contributions matched by payee become transfers in | NSDL statements include NPS; NAVs are public |
| Not built now | Crypto, digital gold in apps, P2P lending, foreign shares, property: custom account types with a balance the user sets (ACC-6) | No tester holds them yet |
| Storage | Migrations from 20261120000000, so they don't clash with milestone 6 (from 20261104000000). `holdings` gains `kind` (fund, share, etf, gold_bond, bond, nps) and a nullable cost; `deposits.kind` gains ppf, epf, nsc, kvp and ssy; `accounts.type` gains `savings_scheme` and `nps` | Smallest change to existing tables |
| Shipping | All three steps are JS and edge functions only, so they ship as over-the-air updates to app 0.9.0, each with its `npx supabase db push` or function deploy first | No new build needed |
