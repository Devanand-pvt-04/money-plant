# 0015: App-wide UI revamp

Decided by Deva on 2026-11-05, from clickable mockups on a design canvas (https://claude.ai/artifact/DMWeKpwFDqcPonHnyx9pzr). It came after two fixes that apply to every screen (PRs #37 and #38). First, the theme switch no longer asks for the fingerprint again. Second, every text field stays above the keyboard: form screens use `FormScroll`, and full-window screens and sheets use `KeyboardGap`, from `components/keyboard.tsx`. Every new screen with a text field follows the same rule.

Deva wanted a moderate revamp, not a new app. A few screens become more interesting, more appealing to look at and easier to read. Navigation stays as it is (NAV-1).

## Look

| Decision | Choice | Why |
| --- | --- | --- |
| Palette | "Charcoal and sage", picked over a tidied version of today's look and a deep-green hero. Light: ground `#F3F4F2`, cards white, ink `#1D1F1E`, sage accent `#2C7656`. Dark: ground `#121413`, cards `#1D1F1E`, sage `#8FD1AE`. Each tab's main number sits on a charcoal "money card" (`#1D1F1E` light, `#232826` dark) with sage for money in and on track | It matches the app icon (a sage leaf on charcoal) and looks classy without being loud, in both themes |
| Category colours | Every category icon sits on its own soft tint: food orange, transport blue, shopping pink, bills purple, home teal, income green, investments olive, with darker tints in dark mode. A category the user makes picks a tint from its name or its parent | Rows are easier to scan when the icon carries the colour |
| Tab bar | The active tab gets a sage pill behind its icon. The labels and the five tabs stay the same | A clearer "you are here" mark, with no change to navigation |
| Type | The system font (Roboto), tabular figures for every amount. Main numbers are bold and large, 32 to 44 | No font download, so start-up speed stays the same |

## Screens

| Screen | Choice |
| --- | --- |
| Home (HOME-1) | Greeting and avatar. A money card with "Left to spend in November", the budget, a bar with the pace marker, and spent, money in and days left. Four shortcuts: Scan & pay, Add, Review (with its count) and Split. "Coming up" as small cards you scroll sideways, then the latest three entries. Quick add stays as the floating button |
| Activity (HOME-2) | Search and filter buttons, the month switcher, two cards for spent (with a daily average) and money in, and filter chips: All, Spends, Money in, and To review with its count. Each day's entries sit in one card under a header with that day's totals. An entry still waiting for a category shows "Pick a category" in amber |
| Budgets (BUD-1, BUD-2) | Close to today's screen: the month, the sort menu, every bar with its pace marker, and sub-categories under their parent. Two changes. The total moves onto the money card and ends with "≈ ₹710 a day": what is left divided by the days left, including today. Each budgeted category's line ends with its own daily figure while it is under budget. An over-budget line says "Over by ₹1,200", and one going too fast says "On pace for ₹10,400" |
| Accounts (NW-1, NW-4) | The money card shows net worth, this month's change, and one bar split by where the money sits (mutual funds, bank, stocks, deposits, the rest) with a legend. Then "You own" and "You owe", then one row per group with its total and a status line (gain, a bank balance that's off, the next card bill). Opening a group lists its accounts. The 6-month net worth bars stay, below the rows |
| Mutual funds (NW-3) | Value, invested, gain and return on the money card, the next SIP date, then each fund with its gain and a bar for its share of the total, and the CAS date and NAV time at the bottom |
| One fund (NW-3) | Value and gain, a 12-month chart of value against what was put in, then units, today's NAV, invested and average cost, the SIP, and its history of purchases with units and NAV |
| One bank account (LED-7) | Balance and whether it matches the bank's latest SMS, money in and out this month, Set balance and Import statement, the recurring payments it pays, then its entries by day |
| Entry detail (LED-2, LED-8, CAT-6) | A mix of the two options shown. A money card on top with the category icon, payee, account, the source ("Bank SMS") and the amount. Then lines for Category (with why it has it), When, Note and Amount, each with a pencil. Then Split, Recurring and I lent it, then a short history: where the entry came from, how its category was set, and the user's own changes |
| Editing an entry (LED-8) | One field at a time. Tapping a line opens a sheet for that field with Save at the top, so the keyboard never covers it. The note sheet offers recent notes as chips. Category and account open their existing pickers. The full Edit entry screen goes away |

## Fund charts (NW-3)

| Decision | Choice | Why |
| --- | --- | --- |
| Past NAVs | A new `nav-history` edge function returns each held scheme's NAV on the last working day of each of the past 12 months, from AMFI's public NAV history report (free, no key). The phone keeps them in a local `nav_history` table that is never synced, since past NAVs don't change, and asks only for months it doesn't have | Today only the latest NAV is fetched, and a chart needs past values |
| What the chart shows | Two lines over 12 months: the fund's value at each month end (units held then × that month's NAV), and the money put in up to then. Units held at a month end are the CAS units, less the units of payments into the fund after that month end and before the CAS, plus the estimated units of SIPs after the CAS (decision 0013). Each payment's units use the NAV for its day. A month when no units were held yet shows nothing | Deva wants to see growth against what went in |

## Build

Three PRs, each JS only (OTA). PR 2 also needs `npx supabase functions deploy nav-history`.

1. The palette and category tints in `components/ui.tsx` and `category-style.ts`, the tab bar, Home and Activity.
2. Budgets, Accounts with its group pages, the fund page with charts, and the bank account page.
3. Entry detail and the one-field edit sheets.
