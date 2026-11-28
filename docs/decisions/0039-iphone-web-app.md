# 0039: Money Plant on iPhones as a home screen web app

Asked for by Deva on 2026-11-28, in the thread "Bring the app to iPhones as a web app". Feasibility doc: https://claude.ai/artifact/PmWUNHnffgLv9NPXHnMtPu. Deva chose the recommended options.

## The problem

Friends with iPhones can't use Money Plant. A native iOS build needs the Apple Developer Program ($99 a year), which Deva set aside on 2026-11-10. Sideloading with a free Apple ID expires every 7 days and needs a computer per friend.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Route | The same Expo app built for the web (`expo export --platform web`), opened in Safari and added to the home screen | Free, no Mac, nothing expires; one codebase |
| Local database | expo-sqlite's web version (SQLite in WebAssembly, in the site's private file storage), same Drizzle schema and local migrations | The app stays local-first: the ledger, sync and offline queue work as on the phone |
| Encryption | The web database is not encrypted. Android keeps SQLCipher and still refuses to open without it in release builds | SQLCipher has no browser version. The site's storage is readable only by the site, the iPhone encrypts its storage when locked, and a browser has no keychain to keep a key apart from the data, so encrypting again would add little |
| Small secure values | `lib/secure-store.web.ts` keeps them (theme, restart note, lock timer) in the site's localStorage | expo-secure-store has no browser version |
| Storage eviction | The web app asks the browser to keep its storage (`navigator.storage.persist`) | Safari can clear site data when the phone is short of space; synced rows come back on sign-in, unsynced changes would not |
| Waiting on the database | `patches/expo-sqlite.patch` lets a synchronous query wait up to 30 s for the database worker instead of about 56 ms | Drizzle's expo-sqlite driver is synchronous; the stock limit failed ordinary queries |
| Hosting | Cloudflare Pages (free), from the Deploy workflow (later PR) | It can send the two headers (`public/_headers`) the database needs; GitHub Pages can't |
| Not on the web | SMS and notification capture, widgets, contacts, scan and pay, UPI app links, Face ID lock | iOS or browsers don't allow them; each already hides itself off Android or is handled in a later PR |
| Notifications | None at first; server-sent web push for budget alerts and reminders is a later phase | iPhones allow only push sent from a server (iOS 16.4+, home screen apps) |

## Keeping Android safe

Web-only code lives in `.web.ts` files that the Android bundle never loads: `lib/db-connection.web.ts`, `lib/secure-store.web.ts`, `lib/notifications.web.ts`, `lib/notification-response.web.ts` and `web/setup.web.ts`. The Android versions keep the code they had. The new packages (react-native-web, react-dom, @expo/metro-runtime) are JavaScript only and the patch touches only expo-sqlite's web file, so Android needs no new build.

## Code

- `apps/mobile/index.ts`: imports `src/web/setup` first; registers the headless capture and widget tasks off the web only.
- `apps/mobile/src/web/setup.web.ts`: `Alert.alert` with the browser's dialogs (React Native's web version does nothing), and a no-op `Appearance.setColorScheme`.
- `apps/mobile/src/lib/db.ts`: opens through `openConnection` (`db-connection.ts` with SQLCipher, `db-connection.web.ts` without).
- `apps/mobile/metro.config.js`: accepts `.wasm` files.
- `apps/mobile/public/`: page template (iPhone notch, home screen meta), `manifest.json`, icons and `_headers`.

## Part 2: core screens on the web

| Part | Choice | Why |
| --- | --- | --- |
| Dates and times | `components/date-picker.web.ts` opens the browser's own picker (the wheel sheet on an iPhone) for the same `DateField` and `DateTimeField` | The Android picker did nothing elsewhere, so no entry's date could change |
| Statement and CAS import | `lib/pick-pdf.web.ts`: the browser's file picker (Files, iCloud Drive, Downloads), read as base64 for the same parser functions | expo-file-system's picker has no browser version |
| Edge functions | `supabase/functions/_shared/cors.ts` answers the browser's OPTIONS request and adds CORS headers to `categorise`, `delete-account`, `fx-rates`, `nav-history`, `nav-prices`, `parse-cas`, `parse-statement` and `stock-prices`. Any origin: the functions are guarded by the caller's sign-in token, and no cookies are used | A browser refuses a response without them |
| Export | `lib/save-csv.web.ts`: the same CSV files in one zip, downloaded to Downloads | Android's folder picker has no browser version, and Safari asks before each of several downloads |
| Opening with no signal | `public/sw.js`, a service worker that stores every built file on install (listed by `scripts/web-precache.mjs`) and serves the page from the store when offline. Supabase calls are never stored | The ledger already works offline; the app's own files didn't |
| UPI | Copy the UPI ID, as on Android. PhonePe and Paytm open by their links; Google Pay and BHIM say to open the app by hand | iPhone UPI apps don't take Android's app launch |
| App lock | Not offered on the web | No Face ID or passcode prompt in a browser |

Build with `pnpm --filter @money-plant/mobile web:build` (export, then the precache list).

## Later PRs

1. Hosting: Cloudflare Pages and a web step in Deploy.
2. Web push for budget alerts and reminders.
