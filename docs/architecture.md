# Money Plant architecture notes

21 Oct 2026 · Deva. Source of truth: the Claude Doc at https://claude.ai/artifact/EiHKUZaKrn8w9JaessqF2U. Keep this file in sync with it.

Money Plant is one React Native app (Expo, TypeScript) for Android, with iOS to follow. It has a Supabase backend in Mumbai and a shared TypeScript core for parsing and ledger rules. These notes describe how to build what `docs/PRD.md` specifies.

## System overview

Each phone captures and parses transactions and keeps the full ledger locally. Supabase stores the synced copy, shares IOUs between friends, and runs the AI and price jobs.

```
React Native app (Expo), on Android now and iOS later
  Capture: Android SMS (Kotlin receiver) | UPI alerts (notification listener)
           | iOS Shortcuts (Swift App Intent) | imports and manual entry
     -> Shared TypeScript core: parser, matcher, categoriser, ledger rules
     -> Encrypted SQLite ledger (works offline)  <- Review inbox (uncertain items the user confirms)
     -> Budgets | Net worth | Reminders | IOUs
        ^ sync: parsed rows only, never raw SMS
        v
Supabase, Mumbai region
  Postgres + RLS (ledger, shared IOUs) | Edge functions (sync, AI, imports)
  | CAS parser (Python) | Scheduled jobs (prices, month reviews)
        ^ keys stay server-side
        v
External services
  Anthropic API (Haiku, Sonnet) | SMTP (email OTP) | AMFI, exchanges (prices) | Expo push
```

Every capture path feeds the same TypeScript core, so Android, iOS and the backend agree on how a message becomes a ledger entry.

## Tech stack

Everything is TypeScript except a few small native modules. The parser and ledger rules are written once and run on both the phone and the server.

| Layer | Choice | Why |
| --- | --- | --- |
| Mobile app | React Native with Expo (development builds), TypeScript | One codebase for Android and iOS; Expo modules make custom native code manageable |
| Navigation and UI | Expo Router; a small in-house component set | File-based routes; keeps the bundle lean |
| Local database | SQLite via op-sqlite with SQLCipher | Fast, encrypted at rest, works offline |
| Local queries | Drizzle ORM | Typed schema shared with the server's Postgres schema |
| State | TanStack Query for server data; Zustand for UI state | Simple, well-known patterns |
| Native modules | Kotlin: SMS receiver and notification listener. Swift (later): App Intent for Shortcuts | The only platform-specific code |
| Backend | Supabase: Postgres, Auth, Row-Level Security, Storage, Edge Functions (TypeScript on Deno), scheduled jobs | Managed, Mumbai region, free tier |
| Sign-in | Supabase Auth with email OTP through a free SMTP sender. Phone OTP comes later via a DLT-registered provider such as MSG91 | Email is free; SMS OTPs cost money |
| CAS parsing | A small Python service running casparser on a free tier | casparser is Python; files are deleted after parsing |
| AI | Anthropic API: claude-haiku-5-5 for categorisation, claude-sonnet-5-5 for the month review, under a hard monthly cap | Haiku is fast and cheap for many small calls; Sonnet writes better for the monthly review |
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
    core/                       ledger types, posting rules, money in paise
    parser/                     bank SMS templates, generic parser, fixtures
    matcher/                    dedupe, transfers, refunds, IOU settlement
    categoriser/                rules, merchant dictionary, AI fallback client
    db-schema/                  Drizzle schema shared by SQLite and Postgres
  supabase/
    migrations/                 SQL, including row-level security policies
    functions/                  edge functions: categorise, month-review, prices, sync
  services/
    cas-parser/                 Python + casparser, deployed separately
  docs/
    PRD.md, architecture.md, decisions/
```

## Data model

The core of the app is a double-entry ledger. Each transaction has two or more postings that sum to zero, so every rupee leaves one account and lands in another. Budgets, net worth and IOUs are all queries over postings; none of them are stored as separate totals.

**Account types.** Asset accounts (bank, cash, wallet, FD, RD, mutual fund, stock). Liability accounts (credit card, loan). People accounts (one per friend, for IOUs). Category accounts (Food, Rent, Salary and so on, for income and spending).

Example: paying ₹450 to Swiggy from HDFC savings is one transaction with two postings: HDFC savings −450, Food +450. Lending ₹2,000 to Ravi is HDFC savings −2,000, Ravi +2,000. When Ravi pays it back, the postings reverse.

| Table | Key fields | Notes |
| --- | --- | --- |
| users | id, phone, email, created_at | Supabase Auth owns identity |
| accounts | id, user_id, type, name, institution, last4, currency, opening_balance_paise | Includes category and people accounts |
| transactions | id, user_id, occurred_at, description, merchant_id, status (pending, confirmed), confidence, updated_at, deleted_at | One real-world money movement |
| postings | id, transaction_id, account_id, amount_paise | Postings for each transaction sum to zero |
| sources | id, transaction_id, kind (sms, notification, statement, cas, manual, shortcut), external_ref (UPI RRN, card auth code), parsed_fields (JSON), received_at | A transaction can have several after merging; raw text is never stored on the server |
| merchants | id, normalised_name, upi_handles, default_category, created_by (dictionary, ai) | Global table shared across users |
| rules | id, user_id, match (merchant, VPA, keyword, amount range), category_account_id | User rules win over everything |
| budgets | id, user_id, month, category_account_id, limit_paise | One row per category per month |
| recurring | id, user_id, payee, amount_paise, cadence, next_due, source_account_id, mandate_ref | Detected or added manually |
| ious | id, lender_user_id, borrower_user_id or person account, amount_paise, reason, due_date, status | Shared row when both people use the app |
| holdings | id, user_id, account_id, instrument (ISIN or scheme code), units, cost_paise, as_of | Rebuilt from each CAS import |
| prices | instrument, date, price | Global, filled daily |
| balance_anchors | id, account_id, balance_paise, observed_at, source_id | Balances seen in SMS and statements, used for reconciliation |
| month_reviews | id, user_id, month, summary (JSON), suggestions, created_at | Output of the AI month review |

All money is stored as integer paise. Every table has updated_at and deleted_at columns (soft delete) for sync.

## Capture pipeline

Every source ends in the same five steps on the phone: parse, match, categorise, post, and queue for sync.

**Sources.**

- **Android SMS.** A Kotlin BroadcastReceiver for SMS_RECEIVED checks each sender ID (for example VM-HDFCBK, AX-ICICIT) against an allowlist, then starts a headless JS task with the message. On first run, the app reads the past 6 months of the SMS inbox through the same path.
- **Android notifications.** A NotificationListenerService watches only UPI app packages (GPay, PhonePe, Paytm, Cred, BHIM, slice and others) and passes each notification's title and text to the same task. These notifications mostly add payee names.
- **iOS Shortcuts (later).** A Swift App Intent named "Add bank message" takes the message text and sender. A guided setup walks the user through creating a "When I get a message from <bank>" automation that runs without asking. The intent writes to a shared queue, which the app processes on its next launch or background refresh.
- **Statement import.** The user shares a CSV, XLS or PDF into the app. CSV and XLS files are parsed on the phone. PDFs go to an edge function that extracts the tables and returns rows, and the file is then deleted.
- **CAS import.** The PDF and its password go to the cas-parser service, which returns holdings and transactions. The file is deleted after parsing.
- **Manual.** Quick add pre-fills the last-used account and guesses a category from the merchant the user types.

**The five steps.**

1. **Parse.** `packages/parser` tries the bank's templates (regex with named groups for amount, direction, account last 4, merchant or VPA, reference, balance and date). If none match, a generic parser looks for an amount and direction keywords. Failures are counted per sender for CAP-8.
2. **Match.** `packages/matcher` checks whether this source belongs to an existing transaction (see the next section).
3. **Categorise.** `packages/categoriser` applies user rules, then the merchant dictionary. If the merchant is still unknown, it queues an AI request.
4. **Post.** A transaction with two postings is written to the local database. Its status is pending or confirmed, depending on confidence.
5. **Queue for sync.** The change is pushed to Supabase on the next sync.

## Matching and reconciliation

The matcher runs these rules in order and stops at the first that fits. The thresholds are starting values, to be tuned on real data.

| Rule | Condition | Result |
| --- | --- | --- |
| Same reference | Same UPI RRN, card auth code or NEFT UTR as an existing source | Attach as another source; raise confidence |
| Same payment, no reference | Same account last 4, same amount, same direction, within 10 minutes | Attach as another source |
| Self-transfer | Debit in one owned account and credit of the same amount in another owned account within 24 hours | Merge into one transfer transaction with no category |
| Card bill payment | Debit from a bank account to a payee that matches an owned card's issuer, and a card credit within 3 days | Post as a transfer to the card's liability account |
| Refund | Credit from a merchant that had an earlier debit of an equal or larger amount in the last 60 days | Post against the original category |
| IOU settlement | Credit or debit with a person who has an open IOU, for an amount up to the outstanding balance | Reduce the IOU; mark it settled at zero |
| Recurring match | Debit to a recurring payee within 3 days of next_due and within 10% of the amount | Mark that occurrence paid; move next_due forward |
| None | Anything else | New transaction |

**Reconciliation.** Each balance anchor (a balance seen in an SMS or statement) is compared with the ledger's computed balance at that moment. A gap of more than ₹1 creates a review item. The item shows the time window where an entry is probably missing or wrong, and offers a one-tap "add adjustment" as a last resort.

## Sync design

The phone holds the working copy and Supabase holds the shared record. Sync works per row, and the last writer wins. That is enough when each user mostly edits only their own data.

- Every row has a client-generated UUID plus updated_at and deleted_at, so the phone can create rows offline without ID clashes.
- **Push:** the phone sends the rows changed since its last successful push to a sync edge function, which upserts them under row-level security.
- **Pull:** the phone asks for rows with updated_at after its last pull cursor and applies them locally.
- **Conflicts:** the last writer wins per row, with two exceptions. In shared IOUs, changes to the amount or due date need the other person's confirmation. Postings are always replaced as a set together with their transaction.
- **Triggers:** sync runs on app open, after each capture, and every 15 minutes in the background where the OS allows.
- **Realtime:** Supabase Realtime pushes IOU changes, so a friend sees a confirmation or settlement within seconds.

If conflicts become a real problem, a sync library (for example PowerSync or ElectricSQL) can replace this hand-written sync later.

## AI services

Two edge functions call the Anthropic API. The app never holds the API key, and each call sends only what its task needs. A hard monthly spend cap applies.

### Categorisation (categorise function)

1. The phone asks for a category for a merchant label it couldn't resolve locally.
2. The function checks the global merchants table. On a hit, it returns immediately.
3. On a miss, it calls claude-haiku-5-5 with the merchant label, the VPA handle if any, an amount band (for example ₹100 to ₹500), the time of day and the list of category names. It asks for structured output: category, normalised merchant name and confidence.
4. Results with a confidence of 0.8 or more are cached in the merchants table for everyone. Lower-confidence results go to the user's review inbox and are cached only after a user confirms them.
5. Payments to people (a personal VPA, or a name with no business keywords) skip AI and go straight to the review inbox (CAT-4).

### Month review (month-review function)

1. A scheduled job runs on the 1st for each user, after the previous month's sync.
2. The function computes the facts in SQL: spend per category against budget and the 3-month average, the top 10 transactions in each overspent category, recurring payments that changed, and IOUs that went overdue.
3. It sends those facts, with merchant names and amounts, to claude-sonnet-5-5 and asks for a short review. The review has a headline, 2 to 4 causes each linked to transaction IDs, and budget suggestions as structured data.
4. The function checks that every number in the review appears in the facts it sent. It drops any suggestion that references a missing transaction, so the review can't invent figures.
5. The result is stored in month_reviews and a push notification is sent.

**Cost control.** Because merchants are cached, most AI calls happen in the first few weeks. After that, a typical user should need only a few categorisation calls a week plus one review a month. A per-user monthly cap and a global hard cap stop runaway usage.

## Security and privacy

Data gets server-side protection for now, as decided. The design keeps a later move to end-to-end encryption possible.

| Control | How |
| --- | --- |
| Row-level security | Every user table has a user_id = auth.uid() policy. ious rows are visible to both lender and borrower. merchants and prices are read-only for clients |
| Encryption at rest | Supabase-managed for Postgres and Storage. SQLCipher on the phone, with its key in Android Keystore or iOS Keychain |
| App lock | PIN plus biometrics before any screen shows money |
| Raw SMS | Never synced or logged; only parsed fields leave the parser |
| Uploaded files | Statements and CAS PDFs are kept for at most 1 hour and deleted after parsing; passwords are never stored |
| Secrets | AI and SMTP keys live only in edge function secrets |
| Logging | Sentry, with amount, merchant and account fields scrubbed |
| Consent and rights | Consent screen at sign-up; export to CSV; deleting an account removes all its rows and files |
| Future E2E | Client-generated IDs, and server-side logic limited to sync, categorisation and the month review, keep a later move to encrypted payloads possible |

## Testing and release

The parser and matcher carry the accuracy promise, so they get the most thorough tests.

- **Parser fixtures.** One folder per bank of anonymised real SMS (names, account digits and references replaced), with the expected parsed fields. Every friend's bank gets fixtures before it is marked as supported. Coverage starts with ICICI, HDFC, HSBC and SBI.
- **Ledger property tests.** For random sequences of captures, postings always sum to zero and balances always equal the sum of postings.
- **Matcher scenarios.** Scripted cases for duplicate sources, self-transfers, card bills, refunds and IOU settlement.
- **AI evals.** A labelled set of 300 Indian merchant labels with expected categories. A model or prompt change must not lower accuracy.
- **End to end.** Maestro flows for first run, daily review and IOU settlement on an Android emulator.
- **Release.** GitHub Actions runs the tests on every PR. EAS Build produces an APK for Android friends; TestFlight builds come with the later iOS milestone. Parser rules ship as versioned config from Supabase Storage, so a change in a bank's SMS format can be fixed without an app update.
