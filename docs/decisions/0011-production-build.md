# 0011: First production build

Decided by Deva on 2026-10-27, from the third app review (https://claude.ai/artifact/WJGmVaQBqVpNCEb7xptrPE). Deva wants a production build on their phone before 30 October and will use it daily while milestones 6 and 7 continue.

| Decision | Choice | Why |
| --- | --- | --- |
| Builds | Three apps side by side: production (`in.moneyplant.app`, update channel `production`), preview (`.preview`, channel `preview`) and the development build (`.dev`). EAS counts up the production version code | Fixes are tried on preview before they reach the app Deva relies on |
| Shipping fixes | JS fixes go to `preview` first, then the same update to `production` once tried. Native changes need a new production build and a higher `version` in app.json, as before | An experiment can't break the daily app |
| Preview data | The preview app signs into a separate test account | Testing never touches the real ledger, and two apps never read the same SMS into one account |
| App lock (ACC-2) | Fingerprint or face, with the phone's own PIN, pattern or password as the fallback (expo-local-authentication). It locks when the app starts and after 60 seconds in the background, not right after signing in. On by default, and changing it in Settings asks to unlock first. No separate app PIN | Nothing extra to remember; a UPI payment or a file pick usually takes under a minute, so it doesn't lock mid-task |
| Consent (ACC-5) | A short screen once after sign-in, before any data shows: SMS text stays on the phone, the ledger syncs, contacts are matched on the phone, PDFs are read and not kept, and AI runs on Deva's PC later. "Not now" signs out. The full onboarding stays in milestone 7 | ACC-5 is a Must and was missing |
| Crashes | A crash shows "Something went wrong" with Try again (Expo Router's ErrorBoundary at the root), and uncaught errors elsewhere are caught too. Each error goes to an `app_errors` table: message and stack with numbers taken out, where it happened, app version, update id and channel. It's queued on the phone first, so a crash that ends the app is sent at the next start | Crashes were invisible. A table in our own Supabase project costs nothing and needs no new service, so it replaces the Sentry plan in the architecture |
| Backup | A weekly PowerShell script on Deva's PC, run by Task Scheduler, dumps the `public` schema and `auth.users` with pg_dump and keeps 12 weeks. The database password stays in a file on the PC | The free plan keeps no restorable backups. Secrets stay out of the repo and GitHub |
| Investment gap noted | A SIP after the CAS date adds money but no units until the next CAS. Estimating units from that day's NAV is a pointer to discuss later, with XIRR, lump sums and stocks | Deva asked to note it |
