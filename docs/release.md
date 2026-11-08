# Friends release checklist

What Deva does to let friends in (decision 0016). The code is in place; these steps are settings, files and messages.

## Once, before the first invite

- [ ] `npx supabase db push` (invites, friend links, the AI cap, the security pass, rule notes and currencies).
- [ ] `npx supabase functions deploy fx-rates` (exchange rates for accounts in other currencies).
- [ ] Make yourself an admin in the Supabase SQL editor, then sign out and in on your phone:
      `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = '<your email>';`
- [ ] Do "Deva's one-time setup" in `docs/security.md` (two-factor sign-in, Dependabot alerts, OTP expiry).
- [ ] Set up the cloud backup and remove the PC one (`scripts/backup/README.md`).
- [ ] Build the production APK (0.11.0, with multi-currency): `cd apps/mobile && npx eas-cli@latest build --profile production --platform android`.
- [ ] Put the APK in a Google Drive folder shared as "Anyone with the link can view". Name it `Money Plant.apk`. Put the folder link in `EXPO_PUBLIC_INSTALL_URL` in `apps/mobile/.env` and ship an update (the invite message reads it).
- [ ] Register a free "limited distribution" Android developer account (up to 20 devices). Not needed yet in India, but Google requires verified developers for sideloading from 2027.

## Inviting the first friends

Start with 2 or 3 friends, ideally one with ICICI and one each with HDFC, HSBC or SBI.

1. Settings → Invite friends → their email → Invite. The share sheet opens with the message; send it on WhatsApp.
2. The message tells them how to install around Play Protect (below) and which email to sign in with.
3. After they sign up, you are linked as friends and IOUs with them are shared both ways.

## Install steps friends follow

1. Open the Drive link and download `Money Plant.apk`.
2. Play Protect blocks apps that read SMS when they're installed outside the Play Store. Open the Play Store, tap your profile picture, then **Play Protect**, then the gear, and turn off **Scan apps with Play Protect**.
3. Open the downloaded file and install. If Android asks, allow installs from Drive or Files for this once.
4. Turn **Scan apps with Play Protect** back on.
5. Open Money Plant and sign in with the email you were invited with.

Updates after this arrive inside the app (the update banner), so this is needed only once, and again only when a native build changes the app version.

## The first two weeks

- Watch Settings → Health and the `app_errors` table every couple of days.
- Ask HDFC, HSBC and SBI friends to share any message from Bank SMS → "Messages the app couldn't read"; send them to Claude in the project to add as fixtures and templates.
- The PRD's exit: 10 friends using it daily for 2 weeks.
