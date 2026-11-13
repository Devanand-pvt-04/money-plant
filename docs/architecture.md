# Money Plant architecture notes

21 Oct 2026, updated 3 Nov 2026 · Deva. Source of truth: the Claude Doc at https://claude.ai/artifact/EiHKUZaKrn8w9JaessqF2U. Keep this file in sync with it.

Money Plant is one React Native app (Expo, TypeScript) for Android, with iOS to follow. It has a Supabase backend in Mumbai and a shared TypeScript core for parsing and ledger rules. These notes describe how to build what `docs/PRD.md` specifies.

## System overview

Each phone captures and parses transactions and keeps the full ledger locally. Supabase stores the synced copy, shares IOUs between friends, and runs the AI jobs and fetches fund prices.

```
React Native app (Expo), on Android now and iOS later
  Capture: Android SMS (Kotlin receiver) | UPI alerts (notification listener)
           | iOS Shortcuts (Swift App Intent) | imports and manual entry
     -> Shared TypeScript core: parser, matcher, categoriser, ledger rules
     -> Encrypted SQLite ledger (expo-sqlite + SQLCipher, works offline)  <- Review inbox (uncertain items the user confirms)
     -> Budgets | Net worth | Reminders | IOUs
        ^ sync: parsed rows only, never raw SMS
        v
Supabase, Mumbai region
  Postgres + RLS (ledger, shared IOUs) | Edge functions (sync, AI, imports)
  | CAS parser (Python) | Scheduled jobs (month reviews)
        ^ keys stay server-side
        v
External services
  Deva's PC: AI worker + Ollama (pulls AI jobs) | SMTP (email OTP) | AMFI, exchanges (prices) | Expo push
```

Every capture path feeds the same TypeScript core, so Android, iOS and the backend agree on how a message becomes a ledger entry.

## Tech stack

Everything is TypeScript except a few small native modules. The parser and ledger rules are written once and run on both the phone and the server.

| Layer | Choice | Why |
| --- | --- | --- |
| Mobile app | React Native with Expo (development builds), TypeScript | One codebase for Android and iOS; Expo modules make custom native code manageable |
| Navigation and UI | Expo Router; a small in-house component set | File-based routes; keeps the bundle lean |
| Local database | expo-sqlite with SQLCipher (`useSQLCipher` config plugin); key in SecureStore | Encrypted at rest, works offline, maintained with the Expo SDK, and also stores the auth session |
| Local queries | Drizzle ORM | Typed schema shared with the server's Postgres schema |
| State | TanStack Query for server data; Zustand for UI state | Simple, well-known patterns |
| Native modules | Kotlin: SMS receiver and notification listener. Swift (later): App Intent for Shortcuts | The only platform-specific code |
| Backend | Supabase: Postgres, Auth, Row-Level Security, Storage, Edge Functions (TypeScript on Deno), scheduled jobs | Managed, Mumbai region, free tier |
| Sign-in | Supabase Auth with email OTP through a free SMTP sender. Phone OTP comes later via a DLT-registered provider such as MSG91 | Email is free; SMS OTPs cost money |
| CAS and statement PDFs | A small Python service (`services/cas-parser`: casparser for CAS, a table reader for bank statement PDFs) on Render's free tier, called only by edge functions with a shared secret | casparser is Python; files and passwords are never stored |
| AI | A self-hosted open-weights model (7 to 8B, 4-bit) on Ollama on Deva's PC, fed by a job queue in Postgres (milestone 6) | No usage fees or prepaid credits, and Deva owns the model; an 8 GB GPU fits this size |
| Push notifications | Expo Notifications (FCM, plus APNs later) | Reminders and review prompts |
| Monitoring | Sentry (free plan) | Crash and error reports |
| CI | GitHub Actions with EAS Build | Builds the APK |

## Repository layout

The repo is a single pnpm monorepo, so the shared core is a normal package that both the app and the edge functions import.

```
money-plant/
  CLAUDE.md                     stack, conventions, commands, rules
  apps/
    mobile/                     Expo app (screens, routes, native modules)
      modules/sms-reader/       Kotlin: SMS receiver, notification listener
      modules/shortcut-intent/  Swift: App Intent for iOS Shortcuts (later)
  packages/
    core/                       ledger types, posting rules, money in minor units, currencies
    parser/                     bank SMS templates, generic parser, fixtures
    matcher/                    dedupe, transfers, refunds, IOU settlement
    categoriser/                rules, merchant dictionary, AI fallback client
    db-schema/                  Drizzle schema shared by SQLite and Postgres
  supabase/
    migrations/                 SQL, including row-level security policies
    functions/                  edge functions: categorise, parse-cas, parse-statement, nav-prices, stock-prices, fx-rates, ai-worker (milestone 6), delete-account
  services/
    cas-parser/                 Python + casparser, deployed separately
    ai-worker/                  Node worker and model evals, runs on Deva's PC (milestone 6)
  docs/
    PRD.md, architecture.md, decisions/
```

## Data model

The core of the app is a double-entry ledger. Each transaction has two or more postings that sum to zero, so every rupee leaves one account and lands in another. Budgets, net worth and IOUs are all queries over postings; none of them are stored as separate totals.

**Account types.** Asset accounts (bank, cash, wallet, FD, RD, mutual fund, stock). Liability accounts (credit card, loan). People accounts (one per friend, for IOUs; no two share an email or UPI ID, and two entries for one person are merged by moving their postings, decision 0020). Category accounts (Food, Rent, Salary and so on, for income and spending).

**Custom account types.** Users can add their own types (Chit fund, PF, Gold). Each one sits on a fixed class, asset or liability, which decides the sign of its balance and how net worth adds up. Built-in behaviour (FD interest, fund prices, card bill detection) stays attached to the built-in types; a custom type is a plain manual account.

**Category tree.** A category account can have a parent category account, two levels deep (Food > Lunch). Postings may land on a parent. Reports and budgets roll children up into their parent. Because postings point at the category's id, moving, renaming or merging a category keeps its history. Each user category maps to a standard category key (for example `food.lunch`), so the shared merchant dictionary works across users whose trees differ. When a key points at a child the user doesn't have, the entry lands on the parent (`food.groceries` falls back to `food`). Categories under the `investments` and `cash` roots, and transfers between the user's own accounts, are not spending: budgets and spending totals leave them out (BUD-1).

Example: paying ₹450 to Swiggy from HDFC savings is one transaction with two postings: HDFC savings −450, Food +450. Lending ₹2,000 to Ravi is HDFC savings −2,000, Ravi +2,000. When Ravi pays it back, the postings reverse. A split is the same idea: a ₹1,200 dinner for four is HDFC savings −1,200, Food > Eating out +300, and +300 to each of three friends' person accounts. Converting an entry into a split replaces its postings and keeps its sources.

| Table | Key fields | Notes |
| --- | --- | --- |
| users | id, phone, email, created_at | Supabase Auth owns identity |
| accounts | id, user_id, type, account_type_id, parent_id, category_key, name, institution, last4, currency, opening_balance_paise, auto_confirm, vpa, extra_vpas, phone, email, icon, credit_limit_paise | Includes category and people accounts. parent_id, category_key and icon apply to categories (icon is a Material Community Icons name the user picked; null means the app picks one from the name and key); account_type_id to custom types; vpa, extra_vpas, phone and email to people (pay links, matching payments by any UPI ID or the mobile number inside one, sharing IOUs; decision 0021); credit_limit_paise to credit cards (decision 0024; a shared limit across cards comes later) |
| account_types | id, user_id, name, icon, class (asset, liability), in_net_worth | User-defined account types |
| transactions | id, user_id, occurred_at, description, merchant_id, status (pending, confirmed, ignored), confidence, category_reason (rule, pattern, dictionary, ai, user, refund), category_rule_id, user_set_fields, split_group_id, updated_at, deleted_at | One real-world money movement. user_set_fields lists the fields automation must not overwrite. category_rule_id is the rule or pattern that placed it, or, for a refund, the entry it gives money back for (LED-5). split_group_id tags an expense added to a group (SPL-3) |
| postings | id, transaction_id, account_id, amount_paise, currency | Postings for each transaction sum to zero in each currency. An owned account (bank, card, cash, deposit, investment) takes postings only in its own currency; category and person accounts take any (decision 0017) |
| sources | id, transaction_id, kind (sms, notification, statement, cas, manual, shortcut, app_payment), external_ref (UPI RRN, card auth code), parsed_fields (JSON), received_at | A transaction can have several after merging; raw text is never stored on the server |
| merchants | id, normalised_name, upi_handles, default_category, created_by (dictionary, ai) | Global table shared across users |
| rules | id, user_id, kind (rule, pattern), match (merchant, VPA, keyword, amount range; for patterns also time window, weekdays, account, payee kind), category_account_id, auto_confirm, paused, hits | User rules win over everything; learned patterns come next |
| split_groups | id, user_id, name, member_account_ids | A trip or flatmates, as a list of the user's person accounts. A member's balance within the group is the sum of their postings on the group's tagged entries |
| ignored_senders | id, user_id, sender | Senders whose messages never create entries |
| budgets | id, user_id, month, category_account_id, limit_paise | month is null for a category's default, which applies to every month; a row with a month overrides the default for that month only. Removing the override restores the default. Every row has a category: the month's total is the sum of the rows in effect, and a parent's row and its children's rows never coexist (BUD-1) |
| recurring | id, user_id, name, vpa, merchant, amount_paise, currency, cadence, anchor_day, next_due, account_id, category_account_id, status (active, paused, proposed, declined), origin (manual, history, pre_debit), mandate_ref, last_paid_at, last_transaction_id | Detected or added manually. next_due is a calendar date on the phone's clock |
| ious | id, user_id (owner), owner_name, owner_email, owner_vpa, person_account_id, direction (lent, borrowed), amount_paise, currency, reason, occurred_on, due_date, transaction_id, counterparty_email, counterparty_user_id, counterparty_person_account_id, counterparty_transaction_id, counterparty_vpa, confirmed_at, declined_at | One row per IOU. With counterparty_email set, the other person sees it and answers through respond_iou |
| iou_payments | id, user_id, iou_id, amount_paise, currency, paid_at, transaction_id | Repayments each side's ledger saw. What is still owed is the amount minus the larger side's total |
| deposits | id, user_id, account_id, kind (fd, rd, ppf, epf, nsc, kvp, ssy), amount_paise (the FD's principal or the RD's monthly instalment), rate_bp, start_date, maturity_date, payout (reinvest, monthly, quarterly; RDs reinvest), paid_from_account_id, payee, closed_at | The terms of an FD or RD account, one per account. Interest is computed on the phone with quarterly compounding, and the value today is shown, not posted. Debits that pay into the deposit become transfers into its account; the account's balance follows the instalment schedule; the maturity credit becomes a transfer out of it, with the interest posted as income, and closes it | PPF and Sukanya Samriddhi compound yearly on the lowest balance between the 5th and the month's end, NSC compounds yearly and pays at 5 years, KVP doubles at maturity, and EPF's balance comes from the passbook (decision 0014). These sit on `savings_scheme` accounts
| holdings | id, user_id, account_id, kind (fund, share, etf, gold_bond, bond, nps), scheme, isin, amfi_code, folio, amc, units_e4, cost_paise, cost_known, symbol, nav_e4, nav_date, as_of, sip_paise, sip_day | Funds: one per scheme and folio, each on its own mutual_fund account, updated by each CAS import. Shares, ETFs, gold bonds and bonds: one per ISIN on the `stock` account of their demat account, from an NSDL or CDSL CAS, with the statement value standing in as cost (`cost_known` false) until the user adds what they paid; the account balance on the statement date is the sum of `cost_paise`. NPS: one per scheme on an `nps` account (decision 0014). The account's balance is the cost on `as_of`, so later SIPs add to it. Its value is the units at the latest NAV plus money in or out since `as_of` |
| app_errors | id, user_id, message, stack, source (screen, global), fatal, app_version, update_id, channel, occurred_at | The error log (decision 0011). Phones only insert; numbers are scrubbed from the message and stack before they leave the phone |
| navs (phone only) | amfi_code, isin, nav_e4, date | The latest AMFI NAV for each scheme held. The phone asks the nav-prices edge function once a day; it reads AMFI's public NAV file and returns only the schemes asked for. Nothing is stored on the server |
| prices (phone only) | key (ISIN, or `nps:` and the scheme name), price_e4, date | The latest closing price for each share, ETF, gold bond and bond held, and the NPS NAV for each NPS scheme. The phone asks the stock-prices edge function at most every 6 hours; it reads the day's NSE closing-price file (BSE as a fallback) and the NPS Trust NAV file and returns only what was asked for. Nothing is stored on the server |
| fx_rates (phone only) | date, currency, per_inr_e9 | Exchange rates against INR as integers scaled by 10^9, for today and for each date that has an entry in another currency. The phone asks the fx-rates edge function, at most once a day for today's rates; it reads Frankfurter (ECB reference rates) and, for currencies the ECB doesn't publish, the fawazahmed0 currency API. Nothing is stored on the server (decision 0017) |
| balance_anchors | id, account_id, balance_paise, observed_at, source_id | Balances seen in SMS and statements, used for reconciliation. For a credit card the balance is the amount owed, negative: credit limit minus the available limit in a card SMS, or the total due in a statement SMS (decision 0024) |
| ai_jobs | id, user_id, kind, payload, status, result, attempts, claimed_at, updated_at, deleted_at | The AI queue (milestone 6). Users read their own jobs; only the ai-worker function claims and completes them |

All money is stored as whole numbers in the smallest unit of its currency: paise for rupees, cents for dollars, fils for dirhams (1/100) and Kuwaiti dinars (1/1000), whole yen. The `_paise` column names stayed when currencies arrived (decision 0017); read them as "minor units of the row's currency". Every table has updated_at and deleted_at columns (soft delete) for sync.

## Currencies

Decision 0017. Each user has a home currency, kept in their profile metadata with their name and UPI ID (INR by default). Each account has one currency (`accounts.currency`), fixed once it has entries.

- **Storing.** Postings, IOUs, IOU payments and recurring payments carry a currency. `packages/core` holds each ISO 4217 currency's decimals and symbol, and every amount helper takes the currency. Nothing stores a converted amount.
- **Balancing.** A transaction balances per currency. A $25 lunch from a USD account is USD −25.00 on the account and USD +25.00 on Food. A transfer from an INR account to a USD account records both real amounts, and two postings on a hidden per-user Exchange account (INR +, USD −) balance each currency. The Exchange account is not spending and not in net worth; its converted balance on a transfer is the cost of converting.
- **Converting.** Totals convert at integer rates from `fx_rates`: entries at their date's rate (budgets, Activity, month review), balances at today's rate (net worth), history at each month's last rate. One rounding per converted amount, half to even. A missing rate falls back to the nearest earlier date and the total shows "approximate".
- **Foreign spends in SMS.** The parser reads ISO codes (USD, EUR, AED and so on) beside amounts. On a rupee card or account, the entry is posted in rupees at the day's rate with `estimated_fx` in its parsed fields; a statement row or SMS with the rupee amount for the same reference replaces it.
- **Display.** `formatMoney(amount, currency)` keeps Indian grouping for rupees and groups of three for the rest. Screens pass the posting's currency, never assume ₹.

## Capture pipeline

Every source ends in the same five steps on the phone: parse, match, categorise, post, and queue for sync.

**Sources.**

- **Android SMS.** A Kotlin BroadcastReceiver for SMS_RECEIVED skips full phone numbers, then passes on any business sender (an alphanumeric header such as VM-HDFCBK or ENBD, or a short code of up to 6 digits) whose text has an amount and a money word, plus any sender the user added in Settings → Capture, and starts a headless JS task with the message (CAP-11, decision 0017). Every sender takes the same path (decision 0019): a sender the user linked posts to that account; otherwise the account comes from the bank's own templates where the app has them, or from account digits matching exactly one of the user's accounts; failing both, the message waits in Review until the user picks the account. Waiting messages are read again before every inbox scan. On first run, and later from settings, the app reads the SMS inbox for a date range the user picks (6 months by default) through the same path (CAP-2). Dedupe by reference and source makes a repeated range safe.
- **Android notifications.** A NotificationListenerService reads only the built-in UPI and bank app packages (GPay, PhonePe, Paytm, Cred, BHIM, slice and others) and passes each notification's title and text to the same task (CAP-3). They add payee names to SMS entries. Every other app's notifications are dropped unread (decision 0019; until the next APK, the 0.11.0 listener still passes on their app names and the JavaScript drops them).
- **iOS Shortcuts (later).** A Swift App Intent named "Add bank message" takes the message text and sender. A guided setup walks the user through creating a "When I get a message from <bank>" automation that runs without asking. The intent writes to a shared queue, which the app processes on its next launch or background refresh.
- **Statement import.** The user picks a PDF in the app (CSV and XLS, parsed on the phone, come later). The PDF and its password, if any, go to the parse-statement edge function, which passes them to the Python service (`statement.py`). The service reads the transaction table by word positions and returns each row's date, remarks, amounts and balance, plus the bank and the account's last 4 digits. The holder's name and address and the full account number are never returned, and nothing is stored. On the phone, `parseStatementRow` turns the remarks into a payee, UPI reference and channel. After a preview, each row runs through the pipeline as a `statement` source. It attaches to the SMS entry with the same reference, or failing that, the same amount on the same day or a day either side. Otherwise it becomes the other leg of a transfer, or a new entry categorised like an SMS one. The last row's balance becomes a balance anchor at the end of its day. Importing the same statement again changes nothing. ICICI's layout is supported first; other banks follow with their own anonymised fixtures.
- **CAS import.** The user picks the CAS PDF and types its password. The parse-cas edge function, called as the signed-in user, passes both to the Python service with a secret only the function holds, and returns folios, schemes, units, cost and transactions. Nothing is stored on the way. Each scheme still held becomes a mutual fund account with its holdings. Purchases and redemptions in the statement are matched to bank debits and credits already in the ledger (within ₹1, a week before to a day after, to a fund payee such as a clearing house, RTA or the AMC) and become transfers, and one debit that bought several schemes is split between them. After the import, debits of a fund's SIP amount to a fund payee become transfers into it, one per fund a month.
- **Demat CAS import.** The same flow and function as the CAS import, for an NSDL or CDSL statement. casparser returns each demat account's shares, ETFs, bonds and mutual funds, and the NPS schemes when the PRAN is linked. Owner names, PAN and DP and client IDs are dropped in the service, keeping only the client ID's last 4 digits. Each demat account becomes a `stock` account; a mutual fund whose ISIN matches a fund already held is skipped, since the RTA CAS keeps it, and any other becomes a holding on the demat account valued by AMFI NAV. Debits to and credits from a known broker payee become transfers into and out of the demat account (decision 0014).
- **Manual.** Quick add pre-fills the last-used account and guesses a category from the merchant the user types.
- **Scan and pay.** The app hands a payment to the user's UPI app and logs it with an `app_payment` source (see Scan and pay below).

**The five steps.**

1. **Parse.** `packages/parser` tries the bank's templates (regex with named groups for amount, direction, account last 4, merchant or VPA, reference, balance and date). If none match, or the sender has no templates, a generic parser looks for an amount with its currency (codes, symbols, both decimal styles) and direction keywords. Failures are counted per sender for CAP-8.
2. **Match.** `packages/matcher` checks whether this source belongs to an existing transaction (see the next section).
3. **Categorise.** `packages/categoriser` applies user rules, then learned patterns, then the merchant dictionary. If the merchant is still unknown, it asks the shared dictionary, and from milestone 6 the AI. Patterns run before the payments-to-people check (CAT-4), so a bus conductor's personal UPI ID that matches the morning pattern is not asked about.
4. **Post.** A transaction with two postings is written to the local database. Its status is pending or confirmed, depending on confidence and the account's auto-confirm setting. If the transaction already exists, only fields not in user_set_fields are updated.
5. **Queue for sync.** The change is pushed to Supabase on the next sync.

## Learned patterns

Learned patterns (CAT-8) are computed on the phone from the user's own corrections. No AI call is involved, so they cost nothing and can always explain themselves.

1. Each category correction records the entry's features: local time of day, weekday, amount, paying account, and payee kind (person or business).
2. After each correction, the app looks for 3 or more corrections to the same category in the last 30 days whose amounts fall in one band (±25%) and whose times fall in one 2-hour window.
3. When it finds them, it proposes a pattern, for example "₹15 to ₹25 from HDFC, weekdays 8 to 10 am, is Transport > Bus". The user accepts, edits or declines it.
4. An accepted pattern is stored as a rule of kind `pattern`. Matches arrive as pending suggestions labelled with the pattern, at confidence 0.7. Once the user turns on auto-confirm for that pattern, matches are confirmed directly.
5. Each confirmation or correction updates the pattern's hit count, and the rules screen (CAT-7) shows it.

## Splits and contacts

Splits are personal: they exist only in the payer's ledger, so friends need not use the app.

- **Converting an entry.** Splitting replaces the entry's postings with the user's share on the category and each friend's share on their person account. Sources stay attached, so dedupe and reconciliation are unaffected. Shares are worked out in integer paise (equally, exact amounts, percentages or shares), and leftover paise go one each to the first people. Each friend's share also becomes a lent IOU linked to the entry, so their repayment settles it. Undoing a split folds the shares back into the category, and is refused once someone has paid part of it back.
- **Someone else paid.** The user's share goes to the category, and a negative posting on the payer's person account records what the user owes. The entry has a `manual` source and no account of the user's, and a borrowed IOU links to it.
- **One flow.** Loans, splits and someone else paying all go through one "expense with people" sheet: amount, paid by, a checklist of people, and how (equally, amounts, percent or units). Underneath it writes the same postings and IOU rows as before. A loan is "you paid, all of it is theirs".
- **Groups.** A group is a named set of person accounts. An expense added from inside a group is tagged with its `split_group_id`, and the group page lists those expenses and each member's balance within the group. The per-person total on the People tab is still their whole balance with the user, netted across groups, splits and loans, so one payment per person settles everything.
- **Settling** reuses IOU settlement: a UPI pay link and the matcher's IOU settlement rule.
- **Contacts.** With the contacts permission (expo-contacts), the phone matches payees to contacts: by a 10-digit mobile number in the UPI ID (98xxxxxx10@ybl), then by fuzzy name match against the SMS or notification payee name. A match links the person account to the contact on the phone only. The contact list is never synced or uploaded.
- **Finding friends on the app** is by email invite for now. Shared groups between app users come after the friends release.

## IOUs

An IOU (IOU-1) is a loan between the user and a person account. Its ledger entry moves money between one of the user's accounts and the person, with kind `iou`: a bank entry already in the ledger is converted (its category leg moves to the person and its sources stay), or a new entry with a `manual` source is added. The person's balance is always the sum of their postings.

- **Sharing (IOU-2).** A person with an email shares every IOU with them: the server stores `counterparty_email`, and row-level security lets a user signed in with that email read the row. They confirm or decline through the `respond_iou` function, which only writes the answering side's fields, and say which entry in their own ledger is the loan (a candidate of the same amount within 3 days, or a new one). The `ious_guard` trigger keeps the owner from writing those fields, and clears the confirmation when the amount, direction or due date changes. Friends are found by the email the owner types; no email is sent, and the reminder message the user shares says to sign in with that address.
- **Repayments (IOU-4).** After each capture and on app open, a payment from a person who owes the user (or to one the user owes), for no more than is open, becomes a repayment: the entry moves to the person and `iou_payments` rows record the parts, oldest due first. A repayment the app did not see is recorded by hand with a manual entry. Each side records only what its own ledger saw, so the outstanding amount is the IOU minus the larger side's total and a repayment both sides saw is counted once.
- **Paying (IOU-3)** opens a `upi://pay` link to the person's UPI ID in the user's own UPI app. The user's own UPI ID, kept in their sign-in profile, goes into the "pay me" link in reminder messages (IOU-5).
- **Reminders (IOU-5)** are local notifications at 9 am the day before and on the due date.

## Scan and pay

The app never moves money (PAY-1, PAY-2). It reads a UPI QR, then hands the payment to the user's own UPI app.

1. The camera (expo-camera barcode scanning) reads the QR. A UPI QR is a `upi://pay` link with `pa` (payee UPI ID), `pn` (name) and optionally `am` (amount), `tn` (note) and `mc` (merchant code). Other QR codes are rejected.
2. The user confirms the amount, category and optional split. The app adds its own `tr` reference.
3. On Android the app starts the `upi://pay` intent for the chosen app's package, or a chooser, and waits for the activity result. UPI apps return a response string with `Status`, `txnId` and `responseCode`, but not reliably.
4. Before the UPI app opens, the app writes the entry with an `app_payment` source holding the payee, amount, our reference and, afterwards, the app's response. It waits in Review as "didn't say if it went through" (`payment_unconfirmed`). A SUCCESS response confirms it, a FAILURE removes it, and anything else asks "Did it go through?". Writing first means the entry survives Android killing Money Plant while the UPI app is open.
5. The user picks an account when confirming (the one they last paid this payee from), but the bank is really chosen inside the UPI app. The matcher merges the first debit SMS of the same amount within 10 minutes into the entry on any of the user's accounts, moves the entry to the account the SMS names, and confirms it. A shop's own `tr` reference, which may be signed, is passed through unchanged, and a QR that fixes the amount can't be changed.

Some UPI apps decline or limit payments started by another app, especially to personal UPI IDs. A test build checks Google Pay, PhonePe, a bank app and slice before milestone 3. Where an app refuses, the fallback is to log the entry and open that app's own scanner, or copy the UPI ID. IOU-3's pay links use the same hand-off and inherit the result.

## Recurring payments

Recurring payments (REC-1 to REC-4) are worked out on the phone from the ledger and pre-debit SMS. The server only stores the rows.

1. **From history.** After each capture and on app open, the phone looks at the last 200 days of spending. A payee (UPI ID, or the normalised merchant name) counts as recurring when every gap between payments fits one cadence (weekly 5 to 9 days, monthly 25 to 35, quarterly 80 to 100), the amounts stay within 10% of the median, there are at least 4 weekly or 3 monthly or quarterly payments, and the last one was no more than one and a half periods ago. It is proposed in the review inbox and the recurring screen; the user tracks it or says it is not recurring, and a declined payee is not proposed again.
2. **From pre-debit SMS.** Banks must send a notice before each e-mandate or standing-instruction debit. The parser reads the amount, payee, due date, account digits and mandate reference (`parsePreDebit`); the text stays on the phone. A notice updates the matching recurring payment's date and amount (by mandate reference, then payee), or starts a new one as active and monthly, since the bank has confirmed the mandate. Notices for dates already past are skipped, so a first-run import of old SMS does not create stale reminders.
3. **Added by hand** (REC-2), or from an entry with "Track as a recurring payment".
4. **Marked paid** (REC-4) by the "Recurring match" rule below: a debit to the payee within 3 days of the due date and 10% of the amount moves the due date forward by the cadence, keeping the day of the month (31 Jan, 28 Feb, 31 Mar). The user can also mark an occurrence paid or skip it.
5. **Reminders** (REC-3) are local notifications at 9 am, 3 days and 1 day before the due date, rebuilt after every change. When the paying account is a bank account whose balance is below everything due from it by that day, the reminder says by how much it may be short. Cards and loans get no shortfall warning.

## Matching and reconciliation

The matcher runs these rules in order and stops at the first that fits. The thresholds are starting values, to be tuned on real data.

| Rule | Condition | Result |
| --- | --- | --- |
| Same reference | Same UPI RRN, card auth code or NEFT UTR as an existing source | Attach as another source; raise confidence |
| Same payment, no reference | Same account last 4, same amount, same direction, within 10 minutes | Attach as another source |
| Payment started in the app | A debit of the same amount on any of the user's accounts, within 10 minutes after a scan-and-pay entry that has no SMS yet | Attach as another source; move the entry to that account and confirm it |
| Self-transfer | Debit in one owned account and credit of the same amount in another owned account within 24 hours | Merge into one transfer transaction with no category |
| Card bill payment | A card credit within 3 days of a bank debit of the same amount; or a bank debit whose SMS or statement remarks say it pays a credit card ("CC BillPay-7002", "towards Credit Card XX7002"), for any bank | Post as a transfer to the card's liability account. Confirmed when the printed last digits match the card; asks in Review when only the user's one card fits. The card's later "payment received" message attaches to it (decision 0023) |
| Refund | Credit from a merchant that had an earlier debit of an equal or larger amount in the last 60 days | Post against the original category |
| IOU settlement | Credit or debit with a person who has an open IOU, for an amount up to the outstanding balance | Reduce the IOU; mark it settled at zero |
| Recurring match | Debit to a recurring payee within 3 days of next_due and within 10% of the amount | Mark that occurrence paid; move next_due forward |
| None | Anything else | New transaction |

**Reconciliation.** Each balance anchor (a balance seen in an SMS or statement) is compared with the ledger's computed balance at that moment. A gap of more than ₹1 creates a review item. The item shows the time window where an entry is probably missing or wrong, and offers to add the missing entries, to record one "unrecorded spending" entry in that window, or to adjust the balance only. The user always chooses; nothing is fixed automatically. Card anchors need the card's credit limit (`accounts.credit_limit_paise`); a gap younger than 3 days waits, since pending authorisations hold limit too, and a gap that appears at once and stays is asked about as a limit change first (decision 0024).

## Sync design

The phone holds the working copy and Supabase holds the shared record. Sync works per row, and the last writer wins. That is enough when each user mostly edits only their own data.

- Every row has a client-generated UUID plus updated_at and deleted_at, so the phone can create rows offline without ID clashes.
- **Push:** the phone sends the rows changed since its last successful push (local `dirty = 1`). In milestone 1 it upserts straight into the table under row-level security. A sync edge function takes over when push needs server-side validation (postings that must balance).
- **Pull:** the phone asks for rows with updated_at after its last pull cursor and applies them locally.
- **Conflicts:** the last writer wins per row, with two exceptions. In shared IOUs, changes to the amount or due date need the other person's confirmation. Postings are always replaced as a set together with their transaction.
- **Triggers:** sync runs on app open, after each capture, and every 15 minutes in the background where the OS allows.
- **Realtime:** Supabase Realtime pushes IOU changes, so a friend sees a confirmation or settlement within seconds.

If conflicts become a real problem, a sync library (for example PowerSync or ElectricSQL) can replace this hand-written sync later.

## AI services

AI runs on a self-hosted open model on Deva's PC, not a paid API (decision 0006). It is built in milestone 6, just before the friends release, in the four builds of decision 0012. Until then, categorising uses rules, learned patterns and the merchant dictionary, and the month review shows numbers without an AI write-up.

**How it runs.**

- Ollama on Deva's PC (16 GB RAM, RTX 4060 with 8 GB VRAM) serves a 7 to 8B open-weights model at 4-bit quantisation. The model is chosen in milestone 6 by testing two or three candidates on the labelled merchant set (see Testing).
- AI work is a queue in Postgres (`ai_jobs`: user_id, kind (categorise, month_review, icon), payload, status (queued, running, done, failed), result, attempts, claimed_at and the usual timestamps). Users read only their own jobs. Edge functions and the phone add jobs; nothing calls a model except the worker.
- A Node worker on the PC (`services/ai-worker`, started by Task Scheduler at login) calls the `ai-worker` edge function every 30 seconds, claims up to 5 jobs (`for update skip locked`, so a job is never taken twice), runs them on Ollama at `localhost:11434` with a JSON schema, checks the answers and posts them back. It authenticates with `AI_WORKER_TOKEN`, kept in edge function secrets and in a git-ignored `.env` on the PC. It only makes outgoing connections, so nothing on the PC is exposed to the internet.
- A bad answer is retried once, then marked failed. A job left running for 10 minutes goes back to the queue. Categorise jobs queued for 30 days are dropped, finished jobs' payloads are cleared after 30 days, and the worker logs only job IDs and timings.
- Each user has an AI switch (Settings), on after the consent screen. With it off, nothing of theirs is queued.
- When the PC is off, jobs wait. Entries stay in the review inbox, and the month review's write-up arrives when the PC is next on.
- Jobs carry only what the task needs, the same fields the PRD's privacy rule allows. The consent screen (ACC-5) says that AI runs on Deva's PC.

### Categorisation (categorise function)

On the phone, `packages/categoriser` tries the user's rules, then learned patterns, then the built-in merchant dictionary and the local merchant cache. Only what's left goes to this function, in batches of up to 25.

1. The phone asks for a category for a merchant label it couldn't resolve locally.
2. The function checks the global merchants table. On a hit, it returns immediately. Otherwise it checks for a finished AI answer for that merchant from the last 30 days (anyone's job, since keys are standard).
3. Until milestone 6, a miss comes back as unknown, the entry waits in the review inbox, and the phone asks again after 30 days. From milestone 6, a miss becomes an AI job with the merchant label, the VPA handle if any, an amount band (for example ₹100 to ₹500), the time of day and the list of category names. The worker asks the model for structured output (category, normalised merchant name and confidence) using Ollama's JSON schema format.
4. Results with a confidence of 0.8 or more are applied with category_reason `ai` and the confidence, and cached in the merchants table for everyone. Lower-confidence results become one-tap suggestions in the review inbox and are not shared. The phone collects finished jobs when it syncs, and Activity shows how many merchants are still waiting for AI. A category the user confirms is shared through the merchants table, which already works before milestone 6.
5. Payments to people (a personal VPA, or a name with no business keywords) skip AI and go straight to the review inbox (CAT-4).

### Icon suggestions

When a new category's name matches no Material Design Icons name (CAT-1), the phone queues an `icon` job with the category name. The model answers with up to 5 plain English words ("shuttlecock", "racket" for Badminton), and the phone matches them against the icon font's names and aliases as it does for category names. The first match is applied if the category still has its name and no icon the user picked; the user can change it in Edit as before.

### Month review

1. In milestone 5 the phone computes the review from its own ledger and schedules a local notification for 9 am on the 1st. Nothing is stored on the server; which suggestions the user accepted or ignored is kept on the phone.
2. The facts: spend per category against budget and the 3-month average, the top payees and largest entries in each overspent category, spending outside budgets, money in, and uncategorised entries.
3. The review shows these facts directly: the headline, the categories and entries behind each overspend, and budget suggestions from the milestone 3 rules. From milestone 6, the phone sends these same facts, with the transaction IDs behind them, as a `month_review` AI job (decision 0012: no SQL copy of the review). Amounts go as whole rupees and payee names lose any long digit runs. The model writes a 2 to 3 sentence summary and one cause per overspent budget, each linked to that budget's largest entries by transaction ID. Budget suggestions stay with the milestone 3 rules.
4. The worker checks every ₹ figure against the facts (2% rounding allowed). A summary with a figure not in them fails the job, which is retried once; a cause with an unknown figure, category or transaction ID is dropped. If the job fails, the numbers review stays on its own.
5. The result stays in the job's `result` (there is no month_reviews table). The phone keeps it with the facts it was written from and shows it above the numbers only while they still match ("Being written on Deva's PC" until then); a changed number queues a new job. A catch-up queues last month's job once the month ends, at most hourly, so it is usually ready by the 9 am notification.

**Cost control.** Self-hosting has no per-call cost. The limits are the PC's uptime and speed, so jobs are batched (25 merchants per categorisation job) and merchants are cached for everyone. The `ai_usage` table and spend caps from decision 0004 are no longer used.

## Security and privacy

Data gets server-side protection for now, as decided. The design keeps a later move to end-to-end encryption possible.

| Control | How |
| --- | --- |
| Row-level security | Every user table (including account_types, split_groups and ignored_senders) has a user_id = auth.uid() policy. An ious row is also visible to the user signed in with its counterparty_email, who can change it only through respond_iou; iou_payments are visible to both people once the IOU is confirmed. merchants are read-only for clients |
| Encryption at rest | Supabase-managed for Postgres and Storage. SQLCipher on the phone, with its key in Android Keystore or iOS Keychain |
| App lock | A full-screen cover until the user unlocks with a fingerprint, face or the phone's own screen lock: on start and after 60 seconds in the background (decision 0011) |
| Raw SMS | Never synced or logged; only parsed fields leave the parser |
| Contacts | Read and matched only on the phone; never synced or uploaded |
| Uploaded files | Statements and CAS PDFs are read in memory and never stored; passwords are never stored |
| Secrets | AI and SMTP keys live only in edge function secrets |
| Logging | Crashes and uncaught errors go to an `app_errors` table (insert and read own rows only): the message and stack with numbers scrubbed, where it happened, app version, update id and channel. Queued in the phone's kv table first, so an error that ends the app is sent at the next start. No amounts, payees or SMS text |
| Backup | A weekly pg_dump of the `public` schema and `auth.users` to Deva's PC (scripts/backup), since the free plan keeps no restorable backups |
| Consent and rights | Consent screen once after sign-in, before any data shows (ACC-5); "Not now" signs out. Export (ACC-4) writes CSV files (entries, postings, accounts, budgets, recurring payments, IOUs) to a folder the user picks through Android's folder picker; SMS text is never included. Clear my data (ACC-7) calls a `clear_my_data` database function that deletes the user's rows. Rows a friend can see (a shared IOU, repayments on shared IOUs) are soft-deleted and emptied instead, so the friend's phone drops them at its next sync; friends' IOUs shared with the user lose the user's side and ask for an answer again. The phone then wipes its database except the session and returns to first run, and stamps `data_cleared_at` in the user's metadata so the user's other phones wipe themselves before they could push old rows back. Delete account (ACC-4) calls a `delete-account` edge function that deletes the auth user with the built-in service role, so every user table cascades (including a friend's repayments on the user's IOUs); the phone then wipes its database and signs out. IOUs owned by other users stay with them, with the counterparty cleared. Both ask for a typed word and offer the export first |
| Invites and friend links | Sign-up is invite only (ACC-8): a trigger on `auth.users` refuses a new sign-in unless an open row in `invites` has that email, and a second trigger marks the invite used and adds an accepted `friend_links` row with the inviter. Invites are made only through `invite_friend`, which caps members at 5 (admins, `app_metadata.role = 'admin'`, have no cap) and sends a friend request instead when the email is already a member. The friend answers through `respond_friend_link`, which writes only their side; either side ends a link with `unlink_friend`. After each sync the phone turns accepted links into person accounts with the friend's email and UPI ID, so IOUs share as before (ACC-9, decision 0016). Tested in `supabase/tests/database/invites.test.sql` |
| Future E2E | Client-generated IDs, and server-side logic limited to sync, categorisation and the month review, keep a later move to encrypted payloads possible |

## Testing and release

The parser and matcher carry the accuracy promise, so they get the most thorough tests.

- **Parser fixtures.** One folder per bank of anonymised real SMS (names, account digits and references replaced), with the expected parsed fields. Every friend's bank gets fixtures before it is marked as supported. Coverage starts with ICICI, HDFC, HSBC and SBI.
- **Ledger property tests.** For random sequences of captures, postings always sum to zero and balances always equal the sum of postings.
- **Matcher scenarios.** Scripted cases for duplicate sources, self-transfers, card bills, refunds and IOU settlement.
- **AI evals.** Deva's own tagged merchants (categories set or confirmed by hand), with the same fields a real job sends, scored by an eval script in `services/ai-worker` against each candidate model (decision 0012). A model or prompt change must not lower accuracy. Worker tests run in CI against a fake Ollama, so CI needs no GPU.
- **End to end.** Maestro flows for first run, daily review and IOU settlement on an Android emulator.
- **Release.** GitHub Actions runs the tests on every PR. EAS Build produces three Android apps that install side by side (decision 0011): production (`in.moneyplant.app`, update channel `production`), preview (`.preview`, channel `preview`) and the development build (`.dev`). JS fixes ship to preview first and then to production; native changes need new builds. Friends get the production APK; TestFlight builds come with the later iOS milestone. Parser rules ship as versioned config from Supabase Storage, so a change in a bank's SMS format can be fixed without an app update.
