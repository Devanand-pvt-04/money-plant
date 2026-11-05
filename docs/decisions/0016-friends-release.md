# 0016: Friends release (milestone 7)

Decided by Deva on 2026-11-05, from the friends release plan (https://claude.ai/artifact/8kBJv5BEBSTNDJZm6no2Bb). Deva took every recommended option, then asked about Play Protect, security and backups, which added the last four rows.

Most of what friends need already exists: consent (ACC-5), export, clear and delete (ACC-4, ACC-7), app lock, crash reports, and IOUs shared by email (IOU-2). This release adds a door, a guided start, a way for friends to link up, and a path to real samples for HDFC, HSBC and SBI.

| Decision | Choice | Why |
| --- | --- | --- |
| Who can sign up (ACC-8) | Invite list. Only an invited email can create an account. Each member invites up to 5 people, Deva any number; unused invites can be withdrawn. Checked on the server when an account is created | Today anyone with the APK can sign up, which would let strangers onto the free database and Deva's PC |
| How an invite travels (ACC-8) | The phone's share sheet, with the install link, the email to sign in with and install steps. No email is sent | Free and needs no new secret, as in decision 0007 |
| Finding each other (ACC-9) | Friend links. An accepted invite links both people; a friend request can also be sent from a person page. On accept, person accounts fill in the other side's name, email and UPI ID, and IOUs share by default | Typing emails by hand is easy to get wrong, and shared groups build on links |
| Shared groups (SPL-3 between app users) | A second wave, after two or three friends use the app | Friends start sooner; a share with a linked friend is already a shared IOU |
| First run (ACC-10) | A short wizard for the must-haves (welcome, consent, name and UPI ID, SMS permission and range), then a "Finish setting up" card on Home for the rest, and empty states on every tab. The speed pass from the PRD joins this step | In the app in under a minute, with nothing important skipped |
| Banks other than ICICI (CAP-9) | Everyone can join. A message the app couldn't read can be shared as an anonymised sample: the phone replaces digits, names, UPI IDs and references, shows the result, and shares only when the user taps Share | The only way to get real HDFC, HSBC and SBI formats. Deva approved this as the one exception to "raw SMS never leaves the phone" |
| AI for friends | 300 AI jobs a day per user; extra jobs wait for the next day. The AI switch stays on after consent | A friend's first import can't keep Deva's GPU busy all evening, and the shared dictionary means each merchant is asked once |
| What Deva can see (ACC-5) | The consent screen says Deva runs the server and could technically see entries, doesn't look, and keeps backups encrypted | Honest, and free; end-to-end encryption stays before any public launch |
| Install route | The production APK in a shared Google Drive folder. The install guide asks the friend to turn off "Scan apps with Play Protect" in the Play Store while installing, then turn it back on. Deva also registers a free "limited distribution" Android developer account (up to 20 devices) | Play Protect in India blocks sideloaded apps that read SMS or notifications. Play internal testing avoids this but costs a one-time $25, and Deva chose to stay free. Google requires verified developers for sideloading from 2027 |
| Backups | A weekly GitHub Actions job in the private repo dumps the database, encrypts it with an age public key and keeps it as an artifact for 90 days. The database URL is a GitHub Actions secret; only Deva holds the private key, offline. The PC backup is removed after one cloud backup is restored as a test, and the database password is then reset | Friends' data shouldn't sit unencrypted on one PC, and the backup shouldn't depend on the PC being on |
| Security pass | Before any invite: CI tests that one user can't read or change another's rows (IOUs included) and that every table has row-level security; Supabase Security Advisor clean; edge functions check sign-in, validate inputs and hide internal errors; Android data backup off (`allowBackup` false, which needs a native build and a version bump); Dependabot, `pnpm audit` and gitleaks in CI; two-factor sign-in on GitHub, Supabase, Expo and the OTP Gmail account. Monthly checks after launch, and an incident plan (turn off sign-ups, rotate keys, tell friends within a day) | More people means more at stake; no app is free of bugs, so checking continues |

## Build order

1. Docs (this record and the PRD).
2. Security pass.
3. Invites and friend links (`db push` once).
4. First run, empty states and the speed pass.
5. Bank sample sharing and the AI cap.
6. Release kit: install guide, encrypted cloud backup, first three invites.
7. Second wave: shared groups.
