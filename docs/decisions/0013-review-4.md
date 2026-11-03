# 0013: Review 4, before the AI milestone

Decided by Deva on 2026-11-03, from the fourth app review (https://claude.ai/artifact/PAeP6sxTQeMXtMjQsdmBnj). Production 0.8.0 had been Deva's daily app for a day, with the weekly backup running. Deva chose the recommendation on every pointer.

## Pointers closed

| Pointer | Outcome | Why |
| --- | --- | --- |
| October spending looked too high (C2) | Closed | It was trip spending paid for friends, and PR #17 named the autopay debits |
| Real autopay pre-debit SMS samples | Closed | Recurring payments are also found from history, so a missed notice only loses the early warning. A sample that shows up under messages the app couldn't read gets sent then |
| Pay a typed phone number (PAY-3) | Dropped from the MVP | UPI apps already pay numbers in their own app, and a guessed UPI handle can reach someone else's handle. Typing a UPI ID and scanning stay |
| Per-account auto-confirm (LED-10) | Dropped from the MVP | Rules and patterns already choose "confirms directly" per payee or pattern |
| Lump-sum fund buys after the CAS date | Closed | Rare for Deva; the next CAS brings them in. Reopen if they happen often |
| Returns as XIRR | Closed for now | Plain gain over invested fits a daily glance; XIRR can come with stocks |
| Render's slow first PDF | Closed | Accepted on the free tier; the screen says so |
| Too many entries in Review | Moved to milestone 6 | Its exit target is 90% of a month categorised without edits |
| Speed, other banks, stocks | Waiting | Speed log after about a week; HDFC, HSBC and SBI need friends' anonymised SMS and PDFs; stocks after AI |

## Built before AI (one PR, over the air plus one db push)

| Decision | Choice | Why |
| --- | --- | --- |
| SIP units (NW-3) | A payment into a fund after its CAS date buys units at the NAV for its day, worked out between the CAS NAV and today's AMFI NAV. The fund screen shows these as estimated; the next CAS replaces them. Nothing new is stored | Funds drifted from their real value between statements |
| Refunds (LED-5) | A credit whose SMS says refund, refunded, reversed, reversal or chargeback links to an expense from the same account in the 60 days before, of at least that amount and either to the same payee or for the exact amount (same payee first, then exact amount, then the latest). It takes that expense's category, so it lowers that category's spending, and keeps the expense's id in category_rule_id with the reason `refund`. A confident parse confirms directly; a generic parse still waits in Review with the category filled in. Re-running rules leaves refunds alone | A refund was its own income entry, not tied to the purchase |
| Pull to refresh | Every tab: a pull runs the same SMS catch-up, sync and background passes as Home, shared if two run at once, then reloads the tab | Only Home had it |
| Sub-categories in Budgets | A category card lists every sub-category, not only those with a budget or spending, each with Set budget | Car's sub-categories had neither, so its dropdown was hidden |
| Pace marker | The "where you should be by today" line shows on every category and sub-category budget bar, not only the total | Deva asked for it |
| Category icons (CAT-1) | Material Community Icons replace Feather for categories. An icon the user picks wins; otherwise a word in the name picks one (Car, Petrol, Gym, Rent…); otherwise the standard key; otherwise the parent's. Category Edit has an icon grid with "From the name". Stored in a new nullable `accounts.icon` column, synced | Feather had no car, fuel or gym, so the categories Deva made all looked the same |
| Notes in Activity | An entry with a note shows the note as the row title, and the payee moves to the second line ("Swiggy · Food · 1:14 pm"). Rows without a note are unchanged | Notes were only visible inside the entry |
| Balance set, then an earlier entry | No change. Setting a balance records it at that moment; an entry dated before that only changes history | Deva asked how it works |

## Added on 2026-11-03: restart to update

| Decision | Choice | Why |
| --- | --- | --- |
| Getting an update | The app checks for an update when it opens and when it comes back (at most every 15 minutes), downloads it, and shows "A new version is ready" with Restart and Later above the tabs. Later hides it until the next update, which still applies on the next cold start. Settings → Version shows what is running (version, channel, update date) and checks on tap | By default an update downloads in the background and only runs on the next full start, so a closed-and-reopened app often still showed the old version |

## Added on 2026-11-03: ordering budgets

| Decision | Choice | Why |
| --- | --- | --- |
| Order of categories in Budgets | "Needs attention" by default: over budget, then on pace to go over, then other budgets by share used, then spending with no budget. A menu beside Categories also offers most of budget used, biggest budget, most spent and name; the choice is remembered on the phone. Sub-categories follow the same order, and a category budgeted through its sub-categories counts their budgets added up and their worst status | In daily use the question is where the month is going wrong, so the default answers it without a tap |

## Added on 2026-11-03: more icons and an easier New category

| Decision | Choice | Why |
| --- | --- | --- |
| Icons from the name | After the keyword list, a category's name is matched against every icon in the font the app already ships (Material Design Icons, about 7,400, Apache 2.0) and their other names from MDI's metadata (`icon-aliases.json`, built by `packages/categoriser/scripts/icon-aliases.py`): the whole name, pairs of words, single words, then icons named after a word ("guitar" → guitar-pick). Badminton, cricket, swim and thousands more now get their own icon | No web lookups: icons from the web look inconsistent, need storing, licence checks and a network, and the bundled set already covers almost everything. The AI model in milestone 6 can suggest an icon from this set for names that still miss |
| Icon search | Category Edit has a search over every icon, by name and other names; the common grid stays below it when nothing is typed | Deva wanted more than a fixed set |
| New category | A search field and a New button at the top of Categories; a search with no match offers to add it | The button sat below every category |
