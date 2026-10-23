# Setting up Money Plant

This guide takes a fresh Windows or Mac machine to the app running on an Android phone. The fastest route doesn't need Android Studio: EAS builds the app in the cloud, and your laptop only runs the JavaScript dev server.

## How we work

- **Code is written in the Claude project threads.** Claude pushes a branch, opens a PR, and CI checks it.
- **You test on your phone and merge.** Pull the branch, run the dev server, try the change, review the PR.
- **Use Claude Code locally only when the phone is involved.** That covers things like a native build error, a crash you can only reproduce on the device, or reading `adb logcat`. The cloud session can't see your phone or run an emulator. Claude Code in VS Code (extension) or in a terminal (`claude`) works on the same repo.

## 1. Install the tools (once)

| Tool | Why | Windows | Mac |
| --- | --- | --- | --- |
| Git | Clone and pull the repo | [git-scm.com](https://git-scm.com/download/win) | `xcode-select --install` or [git-scm.com](https://git-scm.com/download/mac) |
| Node.js 22 LTS | Runs the tooling | [nodejs.org](https://nodejs.org) installer | [nodejs.org](https://nodejs.org) installer, or `brew install node@22` |
| pnpm | The repo's package manager | `corepack enable` (in an admin terminal) | `corepack enable` |
| VS Code (optional) | Editor, plus the Claude Code extension | [code.visualstudio.com](https://code.visualstudio.com) | Same |
| Expo account (free) | EAS cloud builds | [expo.dev/signup](https://expo.dev/signup) | Same |

Check them:

```
git --version
node --version     # v22.x
pnpm --version     # 10.x
```

Android Studio is **only** needed for an emulator or for local native builds (section 6).

## 2. Clone and install

```
git clone https://github.com/Devanand-pvt-04/money-plant.git
cd money-plant
pnpm install
pnpm typecheck
pnpm test
```

On Windows, clone to a short path such as `C:\dev\money-plant`, because Android builds can hit the Windows path length limit.

## 3. Environment variables

`apps/mobile/.env` is already in the repo. It holds the Supabase URL and anon key, which are public by design; row-level security protects the data. Nothing secret goes in the app. Server secrets (such as the AI worker token in milestone 6) go in Supabase edge function secrets.

## 4. Supabase (once per project)

In the [Supabase dashboard](https://supabase.com/dashboard/project/dywcmxixmzeqhzifuhwm):

1. **SQL Editor** → New query → paste `supabase/migrations/20261021000000_accounts.sql` → Run. Do this again for each new migration file a PR adds. Or, from the repo root: `npx supabase login`, `npx supabase link --project-ref dywcmxixmzeqhzifuhwm`, `npx supabase db push`.
2. **Authentication → Sign In / Providers → Email**: make sure Email is enabled.
3. **Set up a free SMTP sender.** Supabase only lets you edit email templates once custom SMTP is on, and its built-in sender allows just a few emails an hour. Gmail is free and needs no domain:
   1. Turn on 2-Step Verification for the Google account at [myaccount.google.com/security](https://myaccount.google.com/security).
   2. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), named "Money Plant Supabase". Copy the 16-character password and keep it private.
   3. In Supabase, open **Authentication → Emails → SMTP Settings** and turn on **Enable custom SMTP**:
      - Sender email: your Gmail address. Sender name: `Money Plant`
      - Host: `smtp.gmail.com`. Port: `587`
      - Username: your Gmail address. Password: the app password
   4. Optionally, in **Authentication → Rate Limits**, raise "emails sent per hour" (for example to 30).

   Gmail allows about 500 emails a day, which is plenty for friends. Brevo's free plan (300 a day) also works, but mail sent through it "from" a Gmail address often lands in spam.
4. **Authentication → Emails → Templates**: set **Magic Link** and **Confirm signup** to the HTML in `supabase/templates/`, so the email contains a 6-digit code instead of a link. The subject can be "Your Money Plant sign-in code".

## 5. Get the app on your phone (recommended: EAS cloud build)

The app needs a **development build**, not Expo Go, because Expo Go doesn't include SQLCipher for the encrypted database.

```
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init          # first time only; adds an EAS project ID to app.json, so commit that change
npx eas-cli@latest build --profile development --platform android
```

The free build queue can take 10 to 30 minutes. When it finishes, open the link or QR code on your Android phone, download the APK and install it (allow "install unknown apps" for your browser when asked).

You only need a new build when native code changes: a new Expo or native package, or a change to `app.json` plugins. Claude flags this in each PR. JavaScript changes just reload.

## 6. Run the app

From `apps/mobile`:

```
npx expo start
```

Open the Money Plant dev app on your phone and scan the QR code (phone and laptop on the same Wi-Fi). If the networks don't see each other, use `npx expo start --tunnel`.

Try it: sign in with your email, enter the code, add an account, then sign in on a second device or the emulator and pull to refresh. The account should appear there too.

## 7. Optional: emulator and local builds (Android Studio)

1. Install [Android Studio](https://developer.android.com/studio). In **SDK Manager**, install the latest Android SDK Platform and SDK Platform-Tools.
2. Set environment variables. Android Studio ships its own JDK (JBR), so you don't need a separate one.
   - Mac (`~/.zshrc`):
     ```
     export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
     export ANDROID_HOME="$HOME/Library/Android/sdk"
     export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
     ```
   - Windows (System Properties → Environment Variables):
     `JAVA_HOME = C:\Program Files\Android\Android Studio\jbr`,
     `ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk`, and add `%ANDROID_HOME%\platform-tools` to `Path`.
3. Create an emulator in **Device Manager**, or plug in your phone with USB debugging on (Settings → About phone → tap Build number 7 times → Developer options → USB debugging).
4. From `apps/mobile`: `npx expo run:android`. This builds and installs the dev app locally, with no EAS queue.

The emulator can't receive real bank SMS. For SMS features (milestone 2), test on your real phone. The emulator's Extended controls → Phone can send fake SMS for quick checks.

## 8. Bank SMS capture (milestone 2)

Milestone 2 adds native Android code (the SMS reader in `apps/mobile/modules/sms-reader`), so the development build from step 5 must be rebuilt once. Apply the new migration first.

1. Supabase: run `supabase/migrations/20261022000000_ledger.sql` in the SQL Editor (or `npx supabase db push`).
2. Rebuild and reinstall the dev app: `npx eas-cli@latest build --profile development --platform android`, then install the new APK over the old one.
3. `npx expo start`, open the app and sign in.
4. Tap **Bank SMS** → **Allow reading SMS**, then **Import last 6 months**. Accounts and cards appear on the home screen with balances.
5. Optional: **Turn on in Android settings** under UPI app notifications, and enable Money Plant there.
6. Send yourself a small UPI payment (₹1 to a friend, or between your own accounts). The entry should appear within a few seconds, also with the app closed.

What to check against your bank app:

- Each account's balance. A yellow "Off from the bank by ₹X" line means the ledger and the last balance in an SMS disagree. Open **Review** to see the window where an entry is probably missing.
- **Review** lists entries the app wasn't sure about: payments to people, possible transfers between your accounts, and messages it read with low confidence.
- **Bank SMS → How each bank is read** counts messages per sender. Anything under "Messages the app couldn't read" is a format the parser doesn't know yet. Copy it, anonymise it (see `packages/parser/fixtures/README.md`) and add it to the fixtures.

If Android shows **Restricted setting** when you allow SMS or notification access (Android 13 and later do this for apps installed from a browser): open Settings → Apps → Money Plant, tap the ⋮ menu → **Allow restricted settings**, then try again.

## 9. Categories and budgets (milestone 3)

Milestone 3 adds `expo-notifications` (budget alerts), so the development build must be rebuilt once.

1. Supabase: `npx supabase db push` (or run `supabase/migrations/20261023000000_categories_budgets.sql` in the SQL Editor).
2. Shared merchant dictionary: `npx supabase functions deploy categorise`. It needs no secrets. AI categorising comes in milestone 6, on a self-hosted model (decision 0006).
3. Rebuild and reinstall the dev app: `npx eas-cli@latest build --profile development --platform android`.

## 10. Preview build for multi-day tests

A preview build carries the app's code inside the APK, so it runs for days without `npx expo start`. It installs as a separate app, **Money Plant (preview)**, next to the development build.

1. Once: `cd apps/mobile && npx eas-cli@latest build --profile preview --platform android`, then install the APK and sign in. Your data syncs down.
2. Give SMS and notification access to the preview app, and turn both off for the development build (Settings → Apps → Money Plant → Permissions). If both apps read the same SMS, the second one's sync is rejected as a duplicate.
3. To ship a JavaScript fix to the phone without rebuilding: `cd apps/mobile && npx eas-cli@latest update --channel preview --message "<what changed>"`. The app downloads it on the next launch and uses it from the launch after that, so close and reopen the app twice.

Updates only reach builds with the same `version` in `app.json`. A PR that changes native code (a new native package or config plugin) bumps that version, and then you need a new preview build.

## 11. Day to day

```
git fetch
git checkout <branch-from-the-PR>
git pull
pnpm install
cd apps/mobile && npx expo start
```

If the app behaves strangely after switching branches, run `npx expo start --clear`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Warning "SQLCipher is not available" | You're in Expo Go. Use the development build from step 5 |
| No email arrives | Check spam, then the SMTP settings (step 4.3) and the hourly rate limit |
| "Error sending confirmation email", and Logs → Auth shows `535 5.7.8 Username and Password not accepted` | Gmail rejected the SMTP login. Make a new app password for the same Gmail account, paste it without spaces, and set Username and Sender email to that full Gmail address (step 4.3) |
| The email has a link but no code | The templates weren't updated (step 4.4) |
| "Sync failed: Could not find the table public.accounts" | The migration wasn't applied (step 4.1) |
| "Sync failed: Could not find the function public.push_transactions" | The milestone 2 migration wasn't applied (step 8.1) |
| Bank SMS screen says it needs the development build | The installed dev app predates milestone 2. Rebuild it (step 8.2) |
| `SDK location not found` | `ANDROID_HOME` isn't set (step 7.2); reopen the terminal |
| Phone can't reach the dev server | Use `npx expo start --tunnel` |
