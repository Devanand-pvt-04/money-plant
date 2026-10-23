# Money Plant PRD

21 Oct 2026, updated 23 Oct 2026 · Deva. Source of truth: the Claude Doc at https://claude.ai/artifact/2SAvEZkhZP9eW3s2xw4V8G. Keep this file in sync with it.

Money Plant is an Android app (iOS later) for Deva and friends. It keeps one accurate, cloud-synced ledger of all their money and fills it mostly without typing. This PRD defines the MVP. `docs/architecture.md` describes how it is built.

## Overview

The MVP succeeds if Deva and friends trust its monthly numbers and keep them up to date in under 2 minutes a day.

**Problem.** Money is spread across several bank accounts, cards, UPI apps, a broker, FDs and autopays, and each app shows only its own slice. Manual trackers are accurate but tedious. Bank-linked trackers cost money and miscategorise transactions. Personal IOUs live in Splitwise or in memory, and settling one takes manual back and forth.

**Users.** Deva and 20 to 50 friends: salaried, aged 22 to 35, on Android or iPhone. They use two or more UPI apps, at least one card, starter investments and a few autopays.

**Goals.**

1. Capture most transactions without typing.
2. Keep balances that match the bank.
3. Show budgets, overspending and its causes, with an AI month review.
4. Show net worth across accounts, deposits and investments.
5. Send a reminder before every autopay, EMI and IOU due date.
6. Track lending and borrowing between friends, settled through any UPI app.

**Success metrics.**

| Metric | Target | How it is measured |
| --- | --- | --- |
| Auto-captured share of transactions | 85% on Android, 50% on iPhone | Entries by source, per user per month |
| Balance accuracy | Within ₹1 of the bank after review | Ledger balance versus latest SMS balance or statement |
| Daily effort | Under 2 minutes | Time spent in the review inbox |
| Auto-categorisation accuracy | 90% accepted without change | Share of AI or dictionary categories the user does not edit |
| Retention | 60% of friends active after 30 days | Weekly active users |

These targets are starting guesses to test with the first friends, not benchmarks.

## MVP requirements

The MVP has 56 requirements across 11 areas. "Must" items block the first release to friends. "Should" items can follow within weeks.

### Accounts and sign-in

| ID | Requirement | Priority |
| --- | --- | --- |
| ACC-1 | Sign up and sign in with an email OTP (phone OTP after the MVP, since SMS OTPs cost money) | Must |
| ACC-2 | App lock with a PIN and fingerprint or Face ID | Must |
| ACC-3 | Data syncs across a user's devices and works offline | Must |
| ACC-4 | Export all data as CSV, and delete the account along with all its data | Must |
| ACC-5 | Onboarding consent screen that explains SMS reading, cloud sync, contacts and AI use | Must |
| ACC-6 | Custom account types: the user names a type (for example Chit fund, PF, Gold) and picks its class (asset or liability) and whether it counts toward net worth. Custom types behave as plain manual accounts | Must |

### Capture

| ID | Requirement | Priority |
| --- | --- | --- |
| CAP-1 | Android: read new bank and card SMS from known senders and create entries | Must |
| CAP-2 | Android: import the last 6 months of bank SMS on first run | Must |
| CAP-3 | Android: read UPI app notifications to add payee names to entries | Should |
| CAP-4 | iOS (after the Android MVP): accept bank SMS text from a Shortcuts automation, with a guided setup | Must |
| CAP-5 | Import bank and card statements (CSV, XLS, PDF, including password-protected PDFs) | Should |
| CAP-6 | Import CAS PDFs from NSDL, CDSL, CAMS and KFintech | Must |
| CAP-7 | Quick add for cash and manual entries in 3 taps, with smart defaults | Must |
| CAP-8 | Show parse failures per bank so broken formats are noticed | Should |

### Ledger and accuracy

| ID | Requirement | Priority |
| --- | --- | --- |
| LED-1 | Double-entry ledger: every entry moves money between two accounts | Must |
| LED-2 | Every entry stores its sources and a confidence score, and the user can see them | Must |
| LED-3 | Merge duplicates of the same payment from different sources | Must |
| LED-4 | Detect transfers between the user's own accounts and card bill payments | Must |
| LED-5 | Match refunds and reversals to the original debit | Should |
| LED-6 | Review inbox for low-confidence entries, new merchants and payments to people | Must |
| LED-7 | Compare the ledger balance with balances in SMS and statements, and flag gaps | Must |
| LED-8 | The user can edit every field of an entry. A field the user changed is never overwritten by re-parsing, dedupe, sync or AI; the parsed values stay visible in the source | Must |
| LED-9 | Mark an entry as not a real transaction, or ignore a sender; ignored entries stay ignored on re-import | Must |
| LED-10 | Per account, choose whether confident entries are confirmed automatically or always go to review | Should |

### Categories

| ID | Requirement | Priority |
| --- | --- | --- |
| CAT-1 | Editable default category set suited to India (rent, groceries, food delivery, fuel, recharge, EMI, SIP and more), with sub-categories | Must |
| CAT-2 | Categorise in this order: user rules, learned patterns, merchant dictionary, AI model | Must |
| CAT-3 | Let a correction become a rule ("always do this for this merchant") | Must |
| CAT-4 | For payments to people, ask once and remember per person; offer to create an IOU. Learned patterns run first, so a matched payment to a person (a bus conductor's UPI ID) is not asked about | Must |
| CAT-5 | Categories have two levels (Food > Lunch). An entry can sit on a parent; reports and budgets roll children up into the parent. Moving, renaming or merging a category keeps its history | Must |
| CAT-6 | Each entry shows why it got its category: a rule, a learned pattern, the merchant dictionary, or AI with its confidence | Must |
| CAT-7 | One screen lists all rules and learned patterns, each of which can be edited, paused or deleted | Must |
| CAT-8 | Learn patterns from corrections: when 3 or more corrections in 30 days agree on time of day, weekday, amount band, account and payee kind, propose a pattern the user accepts or edits. Matches start as suggestions and can auto-confirm once the user allows it | Must |

### Budgets and month review

| ID | Requirement | Priority |
| --- | --- | --- |
| BUD-1 | Monthly budget per category (parent or sub-category) and overall | Must |
| BUD-2 | Mid-month pace alerts when a category is on track to overspend | Must |
| BUD-3 | Overspend breakdown by category, merchant and largest transactions, versus budget and the last 3 months | Must |
| BUD-4 | Month review on the 1st: what went over, why, and suggested budget changes the user can accept in one tap. It starts as a numbers review; the AI-written explanation comes in milestone 6 | Must |

### Net worth and investments

| ID | Requirement | Priority |
| --- | --- | --- |
| NW-1 | Net worth across bank accounts, cash, cards, FDs/RDs, mutual funds, stocks and money owed | Must |
| NW-2 | Manual entry for FDs and RDs, with interest and maturity computed | Must |
| NW-3 | Daily mutual fund and stock values from public NAV and closing prices | Must |
| NW-4 | Net worth history chart by month | Should |

### Recurring payments

| ID | Requirement | Priority |
| --- | --- | --- |
| REC-1 | Detect recurring payments from history and from pre-debit SMS | Must |
| REC-2 | Let the user add a recurring payment manually (EMI, rent, subscription) | Must |
| REC-3 | Reminders 3 days and 1 day before, with a warning if the linked account looks short | Must |
| REC-4 | Mark a recurring payment paid automatically when the matching debit arrives | Must |

### Lending and borrowing

| ID | Requirement | Priority |
| --- | --- | --- |
| IOU-1 | Record money lent or borrowed: person, amount, reason, date, optional due date | Must |
| IOU-2 | If the other person uses the app, they see the same IOU and can confirm it | Must |
| IOU-3 | Settle with a UPI pay link that opens the user's chosen UPI app | Must |
| IOU-4 | Mark an IOU settled automatically when the matching payment SMS arrives; partial payments reduce the balance | Must |
| IOU-5 | Reminders before the due date, and a shareable reminder message for people not on the app | Should |

### Splits

Splits are personal in the MVP: they live in the payer's ledger, so friends don't need the app. Shared groups between app users come after the friends release.

| ID | Requirement | Priority |
| --- | --- | --- |
| SPL-1 | Split a payment among people equally, by exact amounts, percentages or shares. Any existing entry can be converted into a split; it keeps its sources | Must |
| SPL-2 | Record a split that someone else paid, as money the user owes | Must |
| SPL-3 | Groups (a trip, flatmates) with simplified balances; settle through IOU-3 and IOU-4 | Should |
| SPL-4 | Match payees to the phone's contacts by the phone number in a UPI ID or by payee name. Contacts are matched on the phone and never uploaded | Should |

### Scan and pay

The app never moves money. It hands the payment to the user's own UPI app and logs it.

| ID | Requirement | Priority |
| --- | --- | --- |
| PAY-1 | Scan a UPI QR code, confirm the amount, category and split, then open the chosen UPI app with everything filled in | Should |
| PAY-2 | Log the hand-off as an entry with an app payment source. Confirm it from the UPI app's response, or ask the user when there is none. A later bank SMS merges into it | Should |

### Home screen

| ID | Requirement | Priority |
| --- | --- | --- |
| HOME-1 | One screen with this month's spend versus budget, net worth, upcoming payments, money owed and items to review | Must |

## Key user flows

Six flows carry the MVP. Each should feel finished before anything else gets polished.

### First run (target: under 5 minutes)

1. Sign in with an email OTP.
2. Read the consent screen (SMS, sync, AI) and accept.
3. Android: grant SMS access. The app scans 6 months of bank SMS and lists the accounts and cards it found. iOS (later): follow the guided Shortcuts setup, then add accounts by hand.
4. Confirm or rename the detected accounts, and enter any opening balances the app couldn't find.
5. Optionally import a CAS PDF and add FDs.
6. Pick budgets: the app suggests one per category based on the past 3 months; accept or edit each.
7. Land on the home screen with real numbers.

### Daily review (target: under 2 minutes)

1. A notification says "4 to review".
2. The review inbox shows each item with its suggested category and source.
3. Swipe to accept, or tap to change the category, split the entry among people, or mark it as an IOU. Each item says why it got its category.
4. After a change, the app offers "always do this for this merchant". After several similar changes, it proposes a pattern ("₹15 to ₹25 on weekday mornings is Transport > Bus").

### Splitting a restaurant bill

1. The bank SMS creates a ₹1,200 entry at the restaurant.
2. The user taps Split, picks three friends from contacts, and splits equally.
3. The entry now counts ₹300 as Food > Eating out and ₹300 owed by each friend.
4. Each friend's share settles like an IOU, through a UPI link and the incoming SMS.

### Scan and pay

1. The user taps Scan, points the camera at a shop's UPI QR, and enters ₹80.
2. The app suggests a category, and the user picks Google Pay.
3. Google Pay opens with the payee and amount filled in; the user enters their UPI PIN there.
4. Back in Money Plant, the entry is logged. When the bank SMS arrives, it merges into the same entry.

### Lending to a friend and getting paid back

1. After the user pays a friend, the app asks what the payment was for. The user picks "lent" and adds a reason and due date.
2. If the friend uses the app, they get a request to confirm the IOU.
3. The friend taps Settle, which opens their UPI app with the amount filled in.
4. When the credit SMS reaches the lender's phone, the IOU is marked settled on both sides.

### Month review

1. On the 1st, a notification says the review is ready.
2. The review opens with the headline: total spent versus budget, and the main overspend.
3. It explains the causes with linked transactions ("4 weekend food orders added ₹3,200").
4. It proposes budget changes, and the user accepts, edits or ignores each one.

## Non-functional requirements

Accuracy and privacy rank above speed of delivery. A fast app with wrong totals fails as a product.

| Area | Requirement |
| --- | --- |
| Accuracy | No entry is created without a source. Amounts are stored as integer paise, never floating point |
| Accuracy | The parser test suite of anonymised real SMS for each supported bank must pass before every release |
| Privacy | Raw SMS text never leaves the phone; only parsed fields sync |
| Privacy | AI calls send only what the task needs. No account numbers, phone numbers or other people's names beyond the payee label |
| Privacy | Contacts are read and matched only on the phone; the contact list is never uploaded |
| Security | Row-level security, so each user reads only their own rows and the IOUs they are part of. Encryption at rest, and an encrypted local database |
| Security | Secrets (AI keys, SMS provider keys) live only on the backend, never in the app |
| Offline | Capture, review and all screens work offline; sync catches up when the phone is back online |
| UX | Home answers "is this month on track?" within 3 seconds of opening (HOME-1) |
| UX | A daily review takes under 2 minutes, with one tap or swipe per entry. Quick add takes 3 taps (CAP-7) |
| UX | Every automatic entry shows its source and why it got its category. Rupees use Indian grouping (₹1,25,000), with one consistent colour for money in and one for money out |
| UX | One design system across all screens, in light and dark mode. Text scales with the phone's font size, and tap targets are at least 48dp |
| Performance | The home screen opens in under 1 second with 2 years of data. An SMS becomes an entry within 5 seconds |
| Battery | No constant background service. Work is triggered by incoming SMS and notifications |
| Platforms | Android 10 and later. iOS 17 and later (needed for the Shortcuts message trigger) |
| Data residency | Backend hosted in India (Supabase, Mumbai region) |
| Compliance | Consent, data export and account deletion in line with India's DPDP Act. No investment advice. The app never moves money |

## Out of scope and future phases

These items are deliberately left out of the MVP.

| Item | Why not now | Earliest |
| --- | --- | --- |
| Account Aggregator | Needs a regulated partner | Future |
| End-to-end encryption | Server-side protection is enough for friends; E2E complicates AI and shared IOUs | Before any public launch |
| Gmail and email parsing | Restricted Gmail access requires a yearly security assessment | Phase 2 (a forwarding inbox instead) |
| Shared split groups between app users, Splitwise import | Personal splits cover the core need without friends installing the app | After the friends release |
| Finding friends on the app by phone number | Sign-in is email only, and hashed phone numbers are easy to reverse; friends are invited by email | With phone sign-in |
| Ask-anything AI chat | The month review delivers the main AI value first | Phase 2 |
| EPF, NPS, gold, property, loan amortisation | These can be added as custom account types (ACC-6) in the meantime | Phase 2 |
| Broker APIs, live prices | Daily prices are enough for net worth | Phase 3 |
| Web app, family accounts | Phones come first | Phase 3 |
| Public Play Store and App Store launch | Friends only for now | After the MVP proves retention |

## Build milestones

There are seven milestones, in order. Each one ends with something Deva can use on a real phone before friends see it.

1. **Foundation.** Repo, Expo app shell, Supabase project, sign-in, encrypted local database, and sync of a simple accounts table. *Exit:* sign in on two phones and see the same accounts.
2. **Ledger and capture on Android.** SMS reader, parser for Deva's own banks, double-entry ledger, dedupe, transfers, review inbox. *Exit:* one month of Deva's real SMS produces balances that match the bank.
3. **Categories and budgets.** Two-level default categories, custom account types, rules, learned patterns, merchant dictionary, "why" labels and a rules screen, fields the user set that never get overwritten, budgets, pace alerts, overspend breakdown. *Exit:* after a month of corrections, rules, patterns and the dictionary categorise most new entries.
4. **Recurring payments, IOUs, splits and scan to pay.** Recurring detection, reminders, IOU book, shared IOUs, UPI pay links, auto-settle, personal splits and groups, contact matching, QR scan and pay. *Exit:* a real loan between two testers settles end to end, and a real restaurant bill is split and settled.

Before milestone 3, a one-day test build checks how Google Pay, PhonePe, a bank app and slice handle a payment handed off from another app, for a shop QR and a friend's QR. It decides whether PAY-1 and IOU-3 open the UPI app directly or fall back to its own scanner.
Between milestones 3 and 4, a short design step (about a week) sets the look and navigation before the screen count grows. It adds a design system (colours, type, spacing and core components, light and dark), bottom tabs (Home, Activity, Budgets, Money, with a badge for items to review) and a redesign of the four daily screens: home, review inbox, transaction list and detail, and quick add. Clickable mockups come first, and Deva signs them off before any code. Later milestones build on the design system, and milestone 7, the friends release, adds a polish pass (onboarding, empty states, app icon, accessibility). *Exit:* the UX goals below hold on Deva's phone for the four daily screens.
5. **Net worth, imports and month review.** CAS import, FDs, daily prices, statement import, month review with numbers (no AI yet). *Exit:* net worth matches the user's own sum within 1%.
6. **AI.** A self-hosted open model on Deva's PC (decision 0006): the AI job queue and PC worker, a model chosen by testing candidates on the labelled merchant set, AI categorisation as the last CAT-2 layer, and the AI-written month review. *Exit:* 90% of a month's entries are categorised without edits, and the month review's figures all trace to real transactions.
7. **Android friends release.** Onboarding, consent, export and delete, parser coverage for ICICI, HDFC, HSBC and SBI, APK distribution. *Exit:* 10 friends use it daily for 2 weeks. iOS (Shortcuts capture, TestFlight) follows as its own milestone.

## Free-tier plan

Every MVP service fits in a free tier except phone OTP, so phone sign-in moves to after the MVP. AI runs on Deva's own PC, so it has no usage fees.

| Service | Free option | Limit to watch |
| --- | --- | --- |
| Backend | Supabase Free, Mumbai region | 500 MB database; the project pauses after a week with no activity |
| Email OTP | Supabase Auth with a free SMTP sender (for example Resend or Brevo) | A few hundred emails a day |
| Phone OTP | None: every Indian OTP SMS costs money and needs DLT registration | Moved out of the MVP |
| CAS parsing | Python service on a free tier (for example Google Cloud Run) | Some free tiers need a card on file |
| Prices | AMFI NAV file and exchange closing prices | Free public files |
| Push | Expo push service | Free |
| Builds | EAS Build free tier; GitHub Actions | Limited builds a month |
| Monitoring | Sentry free developer plan | Event quota |
| Android distribution | Share the APK directly | No Play Store fee |
| iOS distribution | Deferred along with iOS | The Apple Developer Program costs about $99 a year when needed |
| AI | Self-hosted open model on Deva's PC (Ollama) | Works only while the PC is on; AI jobs wait in a queue meanwhile |

## Resolved questions

- Banks to support first: ICICI Bank, HDFC Bank, HSBC and SBI (savings accounts and their credit cards).
- Running costs: none in the MVP. Use free tiers only; Deva pays only where a feature can't work without it.
- iOS ships after the Android MVP.
- Order in the "settle with" picker: Google Pay, PhonePe, the user's bank apps (iMobile, HDFC Bank, YONO SBI, HSBC India), then slice, then any other UPI app.
- AI provider: a self-hosted open model on Deva's PC, built in milestone 6 (decided 23 Oct 2026, decision 0006). This replaces the Anthropic API decision of 21 Oct 2026.
