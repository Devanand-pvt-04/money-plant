# Money Plant PRD

21 Oct 2026, updated 8 Nov 2026 · Deva. Source of truth: the Claude Doc at https://claude.ai/artifact/2SAvEZkhZP9eW3s2xw4V8G. Keep this file in sync with it.

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

The MVP has 73 requirements across 11 areas. "Must" items block the first release to friends. "Should" items can follow within weeks.

### Accounts and sign-in

| ID | Requirement | Priority |
| --- | --- | --- |
| ACC-1 | Sign up and sign in with an email OTP (phone OTP after the MVP, since SMS OTPs cost money) | Must |
| ACC-2 | App lock with a fingerprint or face, falling back to the phone's own PIN, pattern or password. It locks on start and after a minute in the background, and can be turned off in Settings after unlocking | Must |
| ACC-3 | Data syncs across a user's devices and works offline | Must |
| ACC-4 | Export all data as CSV, and delete the account along with all its data. Deleting asks for a typed confirmation and offers the export first | Must |
| ACC-7 | Clear all my data but keep the account: every entry, account, category, rule and IOU is removed on the phone and the server, and the app starts again from first run. Typed confirmation, export offered first | Must |
| ACC-5 | Onboarding consent screen that explains SMS reading, cloud sync, contacts and AI use. It says AI runs on Deva's PC, not with an AI company, and that AI can be switched off in Settings (decision 0012). It also says plainly that Deva runs the server and could technically see a user's entries, doesn't look, and keeps backups encrypted (decision 0016) | Must |
| ACC-8 | Sign-up by invite only: an account can be created only for an email on the invite list. Each member can invite up to 5 people and Deva any number; an unused invite can be withdrawn. An invite opens the phone's share sheet with a message holding the install link, the email to sign in with and short install steps. No email is sent (decision 0016) | Must |
| ACC-9 | Friend links: accepting an invite links the two people, and a member can send a friend request to an email from a person page. Once both sides accept, each side's person account fills in the other's name, email and UPI ID, and IOUs with that person are shared by default. Either side can unlink (decision 0016) | Must |
| ACC-10 | First run is a short wizard (welcome, consent, name and UPI ID, SMS permission and import range), then a "Finish setting up" card on Home for the rest (UPI notifications, contacts, CAS import, first budget, invite a friend) that goes away once done or dismissed. Every tab has an empty state that says what fills it (decision 0016) | Must |
| ACC-11 | Home currency: picked in the first-run wizard (INR by default) and changeable in Settings. Every total (Home, Activity, budgets, net worth, month review) shows in it (decision 0017) | Must |
| ACC-12 | Each account has its own currency, chosen when it is added (the home currency by default) and changeable only while the account has no entries. Its balance, entries and balance checks are in that currency, with the home value beside a foreign balance (decision 0017) | Must |
| ACC-6 | Custom account types: the user names a type (for example Chit fund, PF, Gold) and picks its class (asset or liability) and whether it counts toward net worth. Custom types behave as plain manual accounts | Must |

### Capture

| ID | Requirement | Priority |
| --- | --- | --- |
| CAP-1 | Android: read new bank and card SMS from known senders and create entries | Must |
| CAP-2 | Android: import past bank SMS from a date range the user picks (1, 3, 6 or 12 months, or custom dates; 6 months by default), on first run and later from settings. Importing a range again never creates duplicates | Must |
| CAP-3 | Android: read UPI app notifications to add payee names to entries | Should |
| CAP-4 | iOS (after the Android MVP): accept bank SMS text from a Shortcuts automation, with a guided setup | Must |
| CAP-5 | Import bank and card statements (CSV, XLS, PDF, including password-protected PDFs) | Should |
| CAP-6 | Import CAS PDFs from NSDL, CDSL, CAMS and KFintech | Must |
| CAP-7 | Quick add in 3 taps, with smart defaults, in three modes: Spent, Received and Transfer (From and To accounts, for moving money between banks, paying a card bill or withdrawing cash). The date and time default to now and open the phone's pickers | Must |
| CAP-8 | Show parse failures per bank so broken formats are noticed | Should |
| CAP-10 | Foreign-currency spends in Indian bank SMS ("USD 25.00 spent on HDFC card") create an entry on the rupee card or account at that day's rate, marked "estimated rate" until the statement or a later SMS gives the rupee amount, which replaces it (decision 0017) | Must |
| CAP-11 | Any bank, card or wallet, in India or abroad: the phone checks SMS from any business sender (never a phone number) for an amount and a money word, and reads the ones that match. Every sender is treated alike, and no screen names a list of supported banks. The account comes from the user's link for that sender, from the bank's own rules where the app has learnt them, or from account digits that match exactly one of the user's accounts; otherwise the message waits in Review until the user picks the account once, or ignores the sender. Settings → Bank SMS lists every sender alphabetically, with counts of messages read and missed. Rules for more banks are learnt over time from shared samples (decisions 0017, 0019) | Must |
| CAP-12 | ~~Notifications from any app the user approves~~ Dropped (decision 0019): only the built-in UPI and bank apps of CAP-3 are read; no other app is read or asked about | Won't |
| CAP-9 | Share an anonymised sample of a message the app couldn't read: the phone replaces digits, names, UPI IDs and references, shows the result, and opens the share sheet only when the user taps Share. Nothing is sent automatically (decision 0016) | Must |

### Ledger and accuracy

| ID | Requirement | Priority |
| --- | --- | --- |
| LED-1 | Double-entry ledger: every entry moves money between two accounts | Must |
| LED-2 | Every entry stores its sources and a confidence score, and the user can see them | Must |
| LED-3 | Merge duplicates of the same payment from different sources | Must |
| LED-4 | Detect transfers between the user's own accounts and card bill payments | Must |
| LED-5 | Match refunds and reversals to the original debit: a credit whose SMS says refund, refunded, reversed or chargeback links to an expense from the same account in the 60 days before, of at least that amount and to the same payee or for the exact amount, and takes its category (decision 0013) | Should |
| LED-6 | Review inbox for low-confidence entries, new merchants and payments to people. Entries can be reviewed a payee at a time ("category for all", "all look right"), entries older than 30 days confirmed together, and a single entry accepted with a swipe right or removed with a swipe left (after a confirm) | Must |
| LED-7 | Compare the ledger balance with balances in SMS and statements, and flag gaps | Must |
| LED-12 | Credit cards know what they really owe: from the credit limit (entered once) minus the available limit in each card SMS, from the total due in statement SMS, or from a balance the user sets. A gap becomes a Review item that adds the missing entries, records one "unrecorded card spending" entry or only adjusts the balance; the user chooses each time. A bill payment that would take a card above zero asks the same question (decision 0024) | Must |
| LED-8 | The user can edit every field of an entry. A field the user changed is never overwritten by re-parsing, dedupe, sync or AI; the parsed values stay visible in the source. Entry detail edits one field at a time, in a sheet that stays above the keyboard (decision 0015) | Must |
| LED-9 | Mark an entry as not a real transaction, or ignore a sender; ignored entries stay ignored on re-import | Must |
| LED-11 | Entries in any currency: each posting keeps its own currency and a transaction's postings sum to zero in each one. A transfer between accounts in different currencies records both amounts actually moved, and shows the rate it implies and its cost against that day's market rate (decision 0017) | Must |

### Categories

| ID | Requirement | Priority |
| --- | --- | --- |
| CAT-1 | A small editable default set with an icon and colour each (a category the user makes gets an icon from a word in its name, such as Car, Gym or Badminton, matched against all of Material Design Icons' names and other names; any icon can be changed in Edit, with a search over the whole set; decision 0013): Food, Groceries, Transport, Shopping, Bills, Rent, Health, Entertainment, Travel, Family and gifts, and Other, plus Salary and Other income. No preset sub-categories; the user adds their own (Food > Breakfast). A dictionary or rule match for a sub-category the user doesn't have lands on its parent | Must |
| CAT-2 | Categorise in this order: user rules, learned patterns, merchant dictionary, AI model | Must |
| CAT-3 | Let a correction become a rule ("always do this for this merchant") | Must |
| CAT-4 | For payments to people, ask once and remember per person; offer to create an IOU. Learned patterns run first, so a matched payment to a person (a bus conductor's UPI ID) is not asked about | Must |
| CAT-5 | Categories have two levels (Food > Lunch). An entry can sit on a parent; reports and budgets roll children up into the parent. Moving, renaming or merging a category keeps its history | Must |
| CAT-6 | Each entry shows why it got its category: a rule, a learned pattern, the merchant dictionary, or AI with its confidence | Must |
| CAT-7 | One screen lists all rules and learned patterns, each of which can be edited, paused or deleted. A rule or pattern can carry a default note, added to entries it categorises that have no note of their own | Must |
| CAT-8 | Learn patterns from corrections: when 3 or more corrections in 30 days agree on time of day, weekday, amount band, account and payee kind, propose a pattern the user accepts or edits. Matches start as suggestions and can auto-confirm once the user allows it | Must |

### Budgets and month review

| ID | Requirement | Priority |
| --- | --- | --- |
| BUD-1 | Monthly budgets on the categories the user picks: a default that applies to every month, and an override for one month only that can be reset. A branch has either one budget on the parent, covering the parent and its sub-categories, or budgets on its sub-categories, never both. The month's total budget is the sum of the category budgets; there is no separate overall budget. Only spending in budgeted categories counts against the total; the rest is shown as spending outside budgets. Investments, cash withdrawals and transfers between the user's own accounts are not spending, and are listed apart | Must |
| BUD-2 | Mid-month pace alerts when a budgeted category, or the month's total budget, is on track to overspend. Every budget bar, the total's and each category's and sub-category's, shows a pace marker. A category budgeted through its sub-categories gets a bar and pace for their budgets added up for how far through the month it is. The total and each category under budget also show a daily allowance: what is left divided by the days left, today included (decision 0015). Categories list over budget first, then on pace to go over, then by share used; a menu also orders them by share used, budget, spent or name (decision 0013) | Must |
| BUD-3 | Overspend breakdown by category, merchant and largest transactions, versus budget and the last 3 months | Must |
| BUD-4 | Month review on the 1st at 9 am, also open any time for past months under Budgets: spent against the total budget, what went over and why (top payees and largest entries against the 3-month average), uncategorised entries to review, and suggested budget changes the user can accept, edit or ignore in one tap. Every number opens the entries behind it. It starts as a numbers review worked out on the phone; in milestone 6 the phone sends the same facts for an AI-written headline and 2 to 4 causes, each linked to its entries, shown above the numbers (decision 0012) | Must |

### Net worth and investments

| ID | Requirement | Priority |
| --- | --- | --- |
| NW-1 | Net worth across bank accounts, cash, cards, FDs/RDs, mutual funds, shares, long-term savings (PPF, EPF, NPS, NSC, KVP, Sukanya Samriddhi) and money owed. Money lent to people counts as an asset and money borrowed as a liability, from person balances, on their own "Lent and borrowed" line; a person's debt to the user can be left out when the user doubts it will come back (decision 0018). FDs and RDs count at their value today: what was paid in plus interest earned so far, an estimate until the bank pays it | Must |
| NW-2 | Manual entry for FDs and RDs, with interest and maturity computed (quarterly compounding) and a reminder 7 days before maturity. Paying into a deposit is a transfer from the paying account, so RD instalments matched from SMS are not spending | Must |
| NW-3 | Daily mutual fund values from AMFI's public NAV file, with holdings from a CAS import. SIP debits to a fund's payee become transfers into that fund. A SIP after the CAS date adds units estimated from the NAV around its date until the next CAS replaces them (decision 0013). | Must |
| NW-4 | Net worth history chart by month. Accounts shows net worth split by where it sits (funds, bank, stocks, deposits, the rest) and one row per group, and each group, fund and bank account opens its own page. A fund's page charts its value against money put in over 12 months, from month-end NAVs in AMFI's NAV history (decision 0015) | Should |
| NW-5 | Import an NSDL or CDSL statement (CAS): each demat account becomes a Stocks account holding its shares, ETFs, gold bonds and bonds, valued daily from the NSE closing-price file (BSE as a fallback). The statement has no purchase cost for shares, so cost is unknown until the user adds what they paid; gain shows only once it is known. Money to or from a known broker is a transfer into or out of the demat account, not spending (decision 0014) | Must |
| NW-6 | Long-term savings: PPF, EPF, NSC, KVP and Sukanya Samriddhi as deposits with the current government rate pre-filled and editable, interest estimated on each scheme's rules on top of the balance, which the user updates from the passbook, and payments matched by payee becoming transfers in. EPF's balance is set from the passbook. NPS holds units per scheme, from the NSDL statement or typed in, valued with the NPS Trust daily NAV (decision 0014) | Must |
| NW-7 | Totals in the home currency: amounts in other currencies convert at the rate for their date in budgets, Activity and the month review, and at today's rate in balances and net worth; net worth history uses each month's last rate. Rates come from free daily reference rates, at most a day old (decision 0017) | Must |

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
| IOU-1 | Record money lent or borrowed: person, amount, reason, date and time (now by default), optional due date. A repayment recorded by hand also takes a time. From a bank entry, the payee is offered as the person but is only added as one if the user keeps them, since a loan is often paid to a shop on a friend's behalf. A person nothing refers to can be removed | Must |
| IOU-2 | If the other person uses the app, they see the same IOU and can confirm it | Must |
| IOU-3 | Settle with a UPI pay link that opens the user's chosen UPI app | Must |
| IOU-4 | Mark an IOU settled automatically when the matching payment SMS arrives; partial payments reduce the balance. A payment is matched by UPI ID, the exact name, or a bank name the user linked to the person before ("GOBAL NAIR" is Gobal). When it isn't matched, the user can say "Paid me back" (or "I paid back") on the entry: it settles their open IOUs with that bank entry, adds no new entry, and remembers the payee's name and UPI ID for next time. Review asks "Is this Gobal paying you back?" when exactly one person has an open IOU of exactly that amount | Must |
| IOU-5 | Reminders before the due date, and a shareable reminder message for people not on the app | Should |

### Splits

Splits are personal in the MVP: they live in the payer's ledger, so friends don't need the app. A share with a linked friend (ACC-9) becomes a shared IOU they confirm. Shared groups between app users are a second wave of the friends release, built once two or three friends use the app (decision 0016).

| ID | Requirement | Priority |
| --- | --- | --- |
| SPL-1 | One "add an expense with people" flow covers loans, splits and someone else paying: amount, paid by, a searchable checklist of people, and how to split (equally, amounts, percent or units). Any existing entry can be converted into a split; it keeps its sources | Must |
| SPL-2 | Record a split that someone else paid, as money the user owes | Must |
| SPL-3 | Groups (a trip, flatmates) with their own expenses, added from inside the group, and each member's balance within the group; settle through IOU-3 and IOU-4 | Should |
| SPL-4 | Match payees to the phone's contacts by the phone number in a UPI ID or by payee name. Contacts are matched on the phone and never uploaded | Should |

### Scan and pay

The app never moves money. It hands the payment to the user's own UPI app and logs it.

| ID | Requirement | Priority |
| --- | --- | --- |
| PAY-1 | Pay first, details after: scan a UPI QR in a square viewfinder (with torch and scan from gallery) or type a UPI ID, enter the amount and an optional note on one screen, then open the UPI app through Android's own app chooser. After the payment, a sheet suggests the category and offers a split; skipping leaves the entry in Review | Should |
| PAY-2 | Log the hand-off as an entry with an app payment source. Confirm it from the UPI app's response, or ask the user when there is none. A later bank SMS merges into it | Should |

### Home, navigation and activity

| ID | Requirement | Priority |
| --- | --- | --- |
| HOME-1 | Home answers "is this month on track?": a greeting and profile avatar, the month's money in, money out and what's left against budget, shortcuts to scan and pay, review (with its count) and split (adding an entry is the floating + on every tab), the bills, EMIs and IOUs due in the next 7 days, the latest entries, and owed lines when not zero (decision 0015) | Must |
| HOME-2 | Activity shows a month at a time with In, Out and Net, each day's money in and out, transfers as "From → To", category icons and colours, search, and a filter sheet (dates, accounts, categories, type, amount, source, needs review). An entry with a note shows the note as its title, with the payee on the second line. Every tab refreshes on pull (sync and SMS catch-up) | Must |
| HOME-3 | Settings → Health measures the success metrics on the phone over the last 30 days: share of entries captured automatically, share of automatic categories left unchanged, average time a day in Review, and the gap between each bank account's ledger balance and the balance in its latest SMS, each beside its target (decision 0014) | Must |
| NAV-1 | Five bottom tabs: Home, Activity, Budgets (with categories), Accounts (net worth, cash and cards, investments, recurring payments) and People (people, IOUs, groups). Settings sit behind the profile avatar | Must |
| NAV-2 | One searchable picker for categories, accounts and people everywhere, with recent choices first and "New" at the end to create one without leaving the screen. Every date and time uses the phone's date and time pickers | Must |

## Key user flows

Six flows carry the MVP. Each should feel finished before anything else gets polished.

### First run (target: under 5 minutes)

1. Open the invite a friend shared, install the app and sign in with the invited email (ACC-8).
2. Read the consent screen (SMS, sync, AI, what Deva can see) and accept, then add a name and UPI ID.
3. Android: grant SMS access and pick how far back to read (6 months by default). The app scans that range of bank SMS and lists the accounts and cards it found. iOS (later): follow the guided Shortcuts setup, then add accounts by hand.
4. Confirm or rename the detected accounts, and enter any opening balances the app couldn't find.
5. Optionally import a CAS PDF and add FDs.
6. Pick budgets: the app suggests one per category based on the past 3 months; accept or edit each.
7. Land on the home screen with real numbers and a "Finish setting up" card for the optional steps (ACC-10).

### Daily review (target: under 2 minutes)

1. A notification says "4 to review".
2. The review inbox shows each item with its suggested category and source.
3. Swipe to accept, or tap to change the category, split the entry among people, or mark it as an IOU. Each item says why it got its category.
4. After a change, the app offers "always do this for this merchant". After several similar changes, it proposes a pattern ("₹15 to ₹25 on weekday mornings is Transport > Bus").

### Splitting a restaurant bill

1. The bank SMS creates a ₹1,200 entry at the restaurant.
2. The user taps Split, ticks three friends in the people checklist, and splits equally.
3. The entry now counts ₹300 as Food > Eating out and ₹300 owed by each friend.
4. Each friend's share settles like an IOU, through a UPI link and the incoming SMS.

### Scan and pay

1. The user taps Scan, points the camera at a shop's UPI QR, and enters ₹80 with an optional note.
2. Android's chooser opens, and the user picks Google Pay (just once, or always).
3. Google Pay opens with the payee, amount and note filled in; the user enters their UPI PIN there.
4. Back in Money Plant, a "Paid ₹80" sheet suggests a category and offers a split. When the bank SMS arrives, it merges into the same entry.

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
| Accuracy | No entry is created without a source. Amounts are stored as whole numbers in the smallest unit of their currency (paise for rupees), never floating point |
| Accuracy | The parser test suite of anonymised real SMS for each supported bank must pass before every release |
| Privacy | Raw SMS text never leaves the phone; only parsed fields sync. The one exception is CAP-9: an anonymised sample the user has seen and chooses to share |
| Security | Before invites go out and monthly after: tests prove one user can't read or change another's rows, Supabase's Security Advisor shows no warnings, every edge function checks the sign-in and its inputs, CI scans dependencies and secrets, and Deva's admin accounts use two-factor sign-in (decision 0016) |
| Fair use | AI jobs are capped at 300 a day per user; more wait for the next day (decision 0016) |
| Privacy | AI calls send only what the task needs. No account numbers, phone numbers or other people's names beyond the payee label |
| Privacy | Contacts are read and matched only on the phone; the contact list is never uploaded |
| Security | Row-level security, so each user reads only their own rows and the IOUs they are part of. Encryption at rest, and an encrypted local database |
| Security | Secrets (AI keys, SMS provider keys) live only on the backend, never in the app |
| Offline | Capture, review and all screens work offline; sync catches up when the phone is back online |
| UX | Home answers "is this month on track?" within 3 seconds of opening (HOME-1) |
| UX | A daily review takes under 2 minutes, with one tap or swipe per entry. Quick add takes 3 taps (CAP-7) |
| UX | Every automatic entry shows its source and why it got its category. Rupees use Indian grouping (₹1,25,000) and other currencies their own symbol, decimals and groups of three ($1,250.00), with one consistent colour for money in and one for money out |
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
| Splitwise import | Personal splits and shared groups cover the need | If friends ask for it |
| Finding friends on the app by phone number | Sign-in is email only, and hashed phone numbers are easy to reverse; friends are invited by email | With phone sign-in |
| Ask-anything AI chat and a bigger role for AI | The month review and categorising deliver the main AI value first; Deva wants to shape AI's wider role later (decision 0012) | Phase 2 |
| Live prices for foreign shares, UPI in other currencies | A foreign broker is a manual account in its currency; UPI is rupee-only (decision 0017) | When a tester needs it |
| Crypto, digital gold in apps, P2P lending, foreign shares, property, loan amortisation | These can be added as custom account types (ACC-6) in the meantime (decision 0014) | When a tester needs it |
| Broker APIs, live prices | Daily prices are enough for net worth | Phase 3 |
| Web app, family accounts | Phones come first | Phase 3 |
| Paying a typed phone number (was PAY-3) | Guessing a UPI handle from a number can reach the wrong person; UPI apps already pay numbers themselves (decision 0013) | Dropped |
| Per-account auto-confirm (was LED-10) | Rules and patterns already choose "confirms directly" per payee (decision 0013) | If friends ask for it |
| Public Play Store and App Store launch | Friends only for now | After the MVP proves retention |

## Build milestones

There are seven milestones, in order. Each one ends with something Deva can use on a real phone before friends see it.

1. **Foundation.** Repo, Expo app shell, Supabase project, sign-in, encrypted local database, and sync of a simple accounts table. *Exit:* sign in on two phones and see the same accounts.
2. **Ledger and capture on Android.** SMS reader, parser for Deva's own banks, double-entry ledger, dedupe, transfers, review inbox. *Exit:* one month of Deva's real SMS produces balances that match the bank.
3. **Categories and budgets.** Two-level default categories, custom account types, rules, learned patterns, merchant dictionary, "why" labels and a rules screen, fields the user set that never get overwritten, budgets, pace alerts, overspend breakdown. *Exit:* after a month of corrections, rules, patterns and the dictionary categorise most new entries.
4. **Recurring payments, IOUs, splits and scan to pay.** Recurring detection, reminders, IOU book, shared IOUs, UPI pay links, auto-settle, personal splits and groups, contact matching, QR scan and pay. *Exit:* a real loan between two testers settles end to end, and a real restaurant bill is split and settled.

Before milestone 3, a one-day test build checks how Google Pay, PhonePe, a bank app and slice handle a payment handed off from another app, for a shop QR and a friend's QR. It decides whether PAY-1 and IOU-3 open the UPI app directly or fall back to its own scanner.
Between milestones 3 and 4, a short design step (about a week) sets the look and navigation before the screen count grows. It adds a design system (colours, type, spacing and core components, light and dark), bottom tabs (Home, Activity, Budgets, Money, with a badge for items to review) and a redesign of the four daily screens: home, review inbox, transaction list and detail, and quick add. Clickable mockups come first, and Deva signs them off before any code. Later milestones build on the design system, and milestone 7, the friends release, adds a polish pass (onboarding, empty states, app icon, accessibility). *Exit:* the UX goals below hold on Deva's phone for the four daily screens.
After milestone 4, a second design step (decision 0008) follows Deva's end-to-end review: five tabs, settings behind a profile avatar, livelier Home and Activity, Budgets that hold categories, a grouped Accounts tab, one expense flow for people and groups, pay first in scan and pay, and shared pickers. Mockups were signed off on 24 Oct 2026, and the build ships in small PRs before milestone 5.
5. **Net worth, imports and month review.** Four builds in order (decision 0010): month review with numbers (no AI yet), FDs and RDs, mutual funds from a CAS import with daily NAV, then statement import. *Exit:* net worth matches the user's own sum within 1%.
After milestone 5, an investments step (decision 0014) adds Settings → Health (HOME-3), the demat statement import (NW-5) and long-term savings (NW-6), in that order, while milestone 6 waits on its open choices. Collecting friends' HDFC, HSBC and SBI samples for milestone 7 starts at the same time.
6. **AI.** A self-hosted open model on Deva's PC (decisions 0006 and 0012), in four builds: the AI job queue and PC worker, a model chosen by testing candidates on Deva's tagged merchants, AI categorisation as the last CAT-2 layer (with a per-user AI switch and icon suggestions for new categories), and the AI-written month review. *Exit:* 90% of a month's entries are categorised without edits, and the month review's figures all trace to real transactions.
After milestone 6's code, a UI revamp (decision 0015) gives the app a charcoal and sage look and reworks Home, Activity, Budgets, Accounts and entry detail, from mockups Deva signed off on 5 Nov 2026. It ships in three PRs.
7. **Android friends release** (decision 0016). In order: a security pass, invites and friend links, first run and empty states (the speed pass was measured on Deva's phone on 6 Nov 2026: Home opens in 176 ms and every screen loads in under 200 ms, so no changes were needed), bank sample sharing and the AI cap, then a release kit (APK on Drive with install steps, encrypted cloud backup, a friend install guide). Invites wait for multiple currencies and capture from any bank (decision 0017), so friends abroad and friends with other banks can join; the release APK becomes 0.11.0. A second wave adds shared groups between app users. Parser coverage for HDFC, HSBC and SBI grows from friends' shared samples. *Exit:* 10 friends use it daily for 2 weeks. iOS (Shortcuts capture, TestFlight) follows as its own milestone.

## Free-tier plan

Every MVP service fits in a free tier except phone OTP, so phone sign-in moves to after the MVP. AI runs on Deva's own PC, so it has no usage fees.

| Service | Free option | Limit to watch |
| --- | --- | --- |
| Backend | Supabase Free, Mumbai region | 500 MB database; the project pauses after a week with no activity |
| Email OTP | Supabase Auth with a free SMTP sender (for example Resend or Brevo) | A few hundred emails a day |
| Phone OTP | None: every Indian OTP SMS costs money and needs DLT registration | Moved out of the MVP |
| CAS and statement PDFs | Python service on Render's free tier, Singapore region (decision 0010) | Sleeps after 15 minutes idle, so the first import after a break waits about a minute; 750 free hours a month |
| Prices | AMFI NAV file, NSE and BSE closing-price files, NPS Trust NAV file | Free public files |
| Push | Expo push service | Free |
| Builds | EAS Build free tier; GitHub Actions | Limited builds a month |
| Monitoring | Sentry free developer plan | Event quota |
| Android distribution | The APK from a shared Google Drive folder; the friend turns Play Protect scanning off while installing, then back on (decision 0016) | Play Protect in India blocks sideloaded apps that read SMS; Play internal testing would avoid this for a one-time $25 |
| Backup | Weekly GitHub Actions job in the private repo, encrypted with age; artifacts kept 90 days (decision 0016) | Artifact storage on the free plan |
| iOS distribution | Deferred along with iOS | The Apple Developer Program costs about $99 a year when needed |
| Exchange rates | Frankfurter (European Central Bank reference rates), with the fawazahmed0 currency API on jsDelivr for currencies the ECB doesn't publish (decision 0017) | Free, no key; rates are daily, not live |
| AI | Self-hosted open model on Deva's PC (Ollama) | Works only while the PC is on; AI jobs wait in a queue meanwhile |

## Resolved questions

- Banks to support first: ICICI Bank, HDFC Bank, HSBC and SBI (savings accounts and their credit cards).
- Running costs: none in the MVP. Use free tiers only; Deva pays only where a feature can't work without it.
- iOS ships after the Android MVP.
- Order in the "settle with" picker: Google Pay, PhonePe, the user's bank apps (iMobile, HDFC Bank, YONO SBI, HSBC India), then slice, then any other UPI app.
- Tabs and app review (24 Oct 2026, decision 0008): Home, Activity, Budgets, Accounts and People, with settings behind the profile avatar. Recurring payments live in Accounts and on Home's 7-day strip rather than in a tab of their own.
- AI provider: a self-hosted open model on Deva's PC, built in milestone 6 (decided 23 Oct 2026, decision 0006). This replaces the Anthropic API decision of 21 Oct 2026.
