# 0017: Multiple currencies

Decided by Deva on 2026-11-08, in the thread "Support multiple currencies". The app has assumed rupees everywhere: amounts in paise, ₹ with Indian grouping, and an SMS parser that reads only Rs, INR and ₹. `accounts.currency` existed, set to INR, but nothing read it.

Deva wants two cases covered, and wants the friends release held until this ships:

- **Friends living abroad**, whose own money is in another currency (for example AED, USD or GBP).
- **Deva's own foreign accounts**, such as a Wise USD balance, a forex card or a US broker, alongside rupee accounts.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Home currency (ACC-11) | Each person picks a home currency in the first-run wizard (INR by default) and can change it in Settings. Every total (Home, Activity, budgets, net worth, month review) shows in it. It lives in the user's profile metadata next to name and UPI ID | Friends abroad think in their own currency; Deva's totals stay in rupees |
| Account currency (ACC-12) | Each account has one currency, chosen when it is added (the home currency by default). It can be changed only while the account has no entries | A bank account holds one currency; changing it later would reinterpret old amounts |
| Storing amounts | Still whole numbers, now in the smallest unit of the posting's currency: paise for INR, cents for USD, fils for AED (3 decimals), whole yen. Columns keep their `_paise` names to avoid a rename across every table and query; the meaning is "minor units of the row's currency". Never floating point | Keeps the integer-only rule without a risky rename; `packages/core` holds a table of each currency's decimals |
| Postings | Every posting stores its currency. A bank, card, cash, deposit or investment account accepts postings only in its own currency. Category and person accounts accept any currency. A transaction's postings sum to zero in each currency (LED-1) | A $25 lunch paid from Wise is simply Wise −25.00 USD, Food +25.00 USD: no conversion is stored, and nothing changes if rates are revised |
| Moving money between currencies (LED-11) | A transfer from an INR account to a USD account records both amounts actually moved, for example HDFC −₹83,500 and Wise +$1,000. Two postings on a hidden Exchange account (+₹83,500, −$1,000) balance each currency. The entry shows the rate it implies and its cost against that day's market rate (fees and spread). The Exchange account is not spending and not in net worth | Both banks' amounts stay exact and match their SMS and statements; the cost of converting is visible instead of lost |
| Converting for totals (NW-7) | Totals convert each amount at the rate for the entry's date; balances and net worth use today's rate; net worth history uses each month's last rate. Each foreign account shows its own balance with the home value beside it | Budgets and past months don't drift when rates move, and net worth reflects what money is worth today |
| Rate source | A new `fx-rates` edge function, like `nav-prices`: the phone asks for the dates and currencies it needs, at most once a day for today's rates. It reads Frankfurter (European Central Bank reference rates, free, no key) and, for the currencies the ECB doesn't publish (such as AED, SAR and QAR), the free fawazahmed0 currency API on jsDelivr. Rates are stored on the phone only, as integers scaled by 10^9, and conversion uses integer arithmetic with one rounding per amount | Free and keyless, so no new secret. Rates are a day old at most, which Deva accepted for totals; they never change a stored amount |
| Budgets | Budget limits are in the home currency. Spending in other currencies counts at its date's rate. Changing the home currency asks to convert existing limits at today's rate | One budget per category stays simple, and a trip abroad still counts against Food |
| Foreign spends in Indian SMS (CAP-10) | An Indian card SMS like "USD 25.00 spent on HDFC card at AMAZON" creates an entry on the rupee card at that day's rate, marked "estimated rate". The statement row or a later SMS with the rupee amount replaces the amount and clears the mark; the forex markup lands on the same entry | The card is billed in rupees, so its balance must stay in rupees; the estimate is close until the real figure arrives |
| SMS from banks abroad | Not parsed yet. Friends abroad add entries with quick add and statement import; a message the app can't read can still be shared as a sample (CAP-9), which is how new banks get added | The parser only knows ICICI, HDFC, HSBC and SBI. Honest limit: friends abroad will type more than friends in India until their banks are added |
| IOUs and splits | An IOU and its repayments carry a currency, the currency of the account that paid or the payer's home currency. A shared IOU between friends with different home currencies stays in the IOU's currency on both sides, and each side's totals convert it. A person's balance shows one line per currency when they differ | Neither friend's view rounds the debt into a different number |
| Investments and deposits | Mutual funds, demat holdings, NPS and Indian savings schemes stay rupee-only. A foreign broker or foreign FD is a manual account (or custom type) in its own currency, with the balance updated by hand | AMFI, NSE and NPS prices are rupee sources; live foreign prices stay out of scope |
| Scan and pay, UPI links | Rupee only. Pay and settle buttons are hidden for IOUs in other currencies, which can be marked paid by hand | UPI works only in rupees |
| Display | `packages/core` formats every amount with its currency: rupees keep Indian grouping (₹1,25,000.00); other currencies use their symbol, their decimals and groups of three ($1,250.00, AED 1,250.000). Amounts in a non-home currency show the code if the symbol is shared (US$, A$) | Readable at a glance, and rupees look exactly as they do today |
| Export | The CSV export gains a currency column per amount, and a home-currency value column | Exports stay complete |

## Build order

All JavaScript and database changes; no native build. The migration must be pushed (`npx supabase db push`) before the over-the-air update.

1. Docs (this record, the PRD and the architecture notes).
2. Foundations: currency table and formatter in `packages/core`, `currency` on postings, IOUs, IOU payments and recurring payments (default INR, so existing rows are unchanged), sync of the new columns, RLS test cases, the `fx-rates` function and the phone's rate cache. Nothing visible changes yet.
3. In the app: home currency in the wizard and Settings, currency on new accounts, every screen showing amounts in their own currency, quick add and entry edit in an account's currency, and cross-currency transfers.
4. Totals: Home, Activity, budgets, net worth and its history, month review and Health in the home currency; foreign spends from Indian SMS; export.
5. Then the friends release resumes from its release kit (decision 0016).
