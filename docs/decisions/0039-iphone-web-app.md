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

## Later PRs

1. Core screens on the web: date and time inputs, PDF picker for statement and CAS import, CORS on the edge functions the app calls, CSV export as downloads, a service worker so the app opens with no signal.
2. Hosting: Cloudflare Pages and a web step in Deploy.
3. Web push for budget alerts and reminders.
