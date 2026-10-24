# 0008: App review round 1 (design step 2)

Date: 2026-10-24. Agreed with Deva in the "Review the app end to end" thread, after Deva used milestones 1 to 4 on a phone. The pointers and the discussion are in the review doc: https://claude.ai/artifact/Jk2zDTxHjKSxKew9na8d6K. Deva signed off the mockups on 2026-10-24: https://claude.ai/artifact/AbkxFzkkJkjACbQ74V7Jbn

| Decision | Choice | Why |
| --- | --- | --- |
| Order of work | Quick fixes first as an over-the-air update (PR #10), then this design step (mockups signed off before code, as in decision 0005), then the build in small PRs, then milestone 5 | October's numbers looked wrong; a redesign doesn't help while the main number is off |
| Tabs (NAV-1) | Home, Activity, Budgets, Accounts, People. Settings sit behind a profile avatar on Home. Recurring payments are a row in Accounts and dots on Home's 7-day strip, not a tab | The Money tab mixed accounts, settings and appearance. Five tabs is the practical limit |
| Home (HOME-1) | Greeting and avatar, the month's in, out and left against budget, a 7-day strip of what's due, latest entries, review and owed lines. The Net worth and Accounts tiles go | The tiles only linked to another tab; Home should change every day |
| Activity (HOME-2) | A month at a time with In, Out and Net, each day's in and out, category icons and colours, and a filter sheet | Taken from Money Manager's month frame |
| Pickers (NAV-2) | One searchable picker sheet replaces the chip rows, with recent choices and "New" at the end. @react-native-community/datetimepicker for every date and time | Chip rows fail past about six options and can't search |
| Motion | react-native-reanimated and react-native-gesture-handler for swipe to accept in review, progress bars and count-ups | The PRD asks for one swipe per entry |
| Native build | The date-time picker and the motion packages ship together as app 0.5.0 with a new preview build. Everything else is JavaScript only | One new build instead of several |
| Quick add (CAP-7) | Spent, Received and Transfer modes, with From and To accounts for a transfer, and a date and time row | Transfers could only come from SMS |
| Categories (CAT-1) | About 11 spending parents and 2 income categories, each with an icon and colour, and no preset children. Existing users keep their categories; only new sign-ups get the smaller set | Deva found 62 categories too many, with uneven children (Lunch but no Breakfast) |
| Budgets (BUD-1) | Categories are managed in the Budgets tab, each with a progress bar. A default budget per category applies to every month (month is null); a one-month override sits on top and can be reset | Changing one month used to change every month after it |
| Not spending (BUD-1) | Investments, cash withdrawals and own-account transfers leave the spending totals and are listed apart | They were inflating October's spending |
| People (SPL-1, SPL-3) | One "expense with people" sheet replaces the four entry screens. Shares are renamed Units. Group expenses are tagged with split_group_id and the group page shows balances within the group | Four screens for the same thing was confusing; groups had no entries of their own |
| Scan and pay (PAY-1) | Pay first, details after: square viewfinder with torch and gallery, a GPay-style amount screen with a note, Android's own chooser instead of app chips, and a "Paid" sheet for the category and split | Paying through Money Plant should be as quick as opening the UPI app |
| Phone numbers (PAY-3) | Only after a one-day test of a typed number as a UPI ID on Deva's phone. Contacts with a saved UPI ID work today | Only UPI apps can call NPCI's number mapper |
| SMS import range (CAP-2) | Presets of 1, 3, 6 or 12 months or custom dates, on first run and from settings. Re-import is safe through dedupe | A fixed 6 months didn't suit everyone |
| Clear data and delete account (ACC-7, ACC-4) | Two separate settings, each with typed confirmation and the export offered first. Clearing uses a `clear_my_data` database function; deleting uses a `delete-account` edge function with the built-in service role. No new secrets | Deva wants to start over without losing the sign-in, and also a full delete for DPDP |
