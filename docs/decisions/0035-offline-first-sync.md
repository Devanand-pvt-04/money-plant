# 0035: Working offline and catching up when back online

Asked for by Deva on 2026-11-19, in the thread "Make the app work offline" (ACC-3).

## The problem

Deva wants Money Plant to work without an internet connection and to send what changed once the phone is back online. The app was already built this way: every change is written to the phone's database first and marked `dirty`, sync pushes the dirty rows and then pulls, and a pull never overwrites a row still waiting to go up. Answers to a friend's shared item wait the same way (`my_answer`). Four gaps were left:

1. Nothing noticed the connection coming back. Sync ran only when Home opened (at most every 2 minutes), when the app came back to the front, or after a local change, so waiting changes could sit for a long time.
2. Being offline looked like a failure: each tab showed "Sync failed: Network request failed".
3. Work done on the phone after a sync (recurring payments marked paid, RD/FD/SIP transfers, demat transfers, the month review reminder) was skipped when the sync failed, so it never ran offline.
4. Actions that need the server (friend invites and links, the profile, imports read on the server) showed raw network errors.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| The queue | Keep the dirty rows as the queue of waiting changes; no separate outbox table | Each row already holds its latest version and a `rev`, so a push clears only what it sent. A second queue would duplicate that and could disagree with it |
| Noticing the connection | While the last sync failed for being offline and the app is open, sync is tried again after 30 s, then 1, 2, 5 and every 10 minutes. Coming back to the front while offline tries at once and starts the back-off again. The timer stops in the background | No new native package (a network listener would need a new APK); a failed try costs one small request |
| Offline with an expired sign-in token | Counts as offline, not as signed out: the app opens with the saved session (as before) and sync tries again later | Otherwise sync would quietly do nothing and never retry |
| What the user sees | Each tab shows a quiet line under its main card: "Offline. 3 changes will sync when you're back online." (or "Everything is saved on this phone." when nothing waits). No "Sync failed" for being offline; other failures still show | Offline is a normal state on a phone, not an error |
| Work on the phone | `refreshAll` runs its passes whether or not the sync succeeded, then reports the sync's error | Those passes only read and write the phone's database; ones that fetch prices or call AI fail quietly offline and run next time |
| Online-only actions | Errors from calls that couldn't reach the server read "This needs the internet. Try again once you're online." (`errorText` in `lib/errors.ts`). Statement and CAS imports get their own offline message | Plain words instead of "Network request failed" |
| Friends | Unchanged: shared items, answers and item links queue like everything else and reach the friend after both phones sync. Friend invites, link answers, profile, home currency and "doubtful" switches still need the internet | They change another person's view or the user's sign-in metadata, so they shouldn't wait silently |

## Conflicts

- One user on two phones editing the same row while offline: the phone that syncs last wins, even if its edit is older (`push_transactions` and the upserts replace the row). Rare for this app's users. Fixing it needs the server to compare edit times, so it is left for later.
- Shared items: only the creator edits an item (enforced on the server), an answer to an item that was removed or moved is undone on the answering phone, and `dropHiddenItems` clears items the server no longer shows. Being offline longer only delays these; it doesn't add new cases.
- Clear my data on another phone still wipes this phone's unsent changes when it reconnects. That is intended (ACC-7).

## Code

JS only; ships as an over-the-air update, no db push and no new APK.

- `apps/mobile/src/lib/sync.ts`: offline state (`useSyncOffline`, `isSyncOffline`), retry with back-off, `countWaiting`; an offline sign-in refresh counts as offline.
- `apps/mobile/src/lib/refresh.ts`: passes run after a failed sync; pull to refresh shows no error for offline.
- `apps/mobile/src/lib/errors.ts`: `isOffline` exported, `errorText`.
- `apps/mobile/src/lib/pdf-service.ts`: `offline` error code for imports.
- `apps/mobile/src/components/offline-note.tsx`: the offline line on each tab.
- Screens and sheets use `errorText` for errors shown to the user.
