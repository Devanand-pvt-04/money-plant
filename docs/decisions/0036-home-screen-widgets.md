# 0036: Home screen widgets

Asked for by Deva on 2026-11-26, in the thread "Add home screen widgets" (HOME-4). Options were compared on a mockup canvas (seven widgets side by side); Deva went with the recommended three.

## The problem

Seeing whether the month is on track, what is due, or adding a cash spend means opening the app and getting past the app lock. Android home screen widgets can answer the first two at a glance and make the third one tap.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Which widgets | **This month** (4×2): left to spend against the month's total budget, the pace marker, money in and days left, or the month's spend when no budgets are set. **Quick add** (4×1): Spent, Got, Scan & pay, and Review with its count. **Coming up** (4×2): the next bills, EMIs and card bills due in 7 days, the same list as Home's "Coming up" | The three answer "am I on track", "what's due" and "add one now". Budgets near the limit, net worth and a small today widget were offered and left for later |
| Look | The charcoal money card (`hero` colours) with sage accents, the same in light and dark, like Home's month card | Reads as Money Plant on any wallpaper; one design to keep right |
| Library | `react-native-android-widget` (0.26), configured through its Expo config plugin in `app.json`. Widgets are JSX in `src/widgets/` rendered by a headless JS task | Mature and Android-only. Expo's own `expo-widgets` gained Android support only recently; iOS is deprioritised, so its iOS side buys nothing yet |
| Where the numbers come from | The widget task reads the phone's encrypted database directly, the way the SMS capture task does, using the same functions as Home (`monthOverview`, `incomeThisMonth`, `countPending`, `weekAhead`). Nothing is stored for the widgets and nothing leaves the phone | No second copy of balances to drift or leak; the widget always matches Home |
| When they refresh | After every ledger change while the app is open (a capture, a review action, a sync; at most once every 2 s), when the app goes to the background, after an SMS is captured in the background, and every 30 minutes by Android | Fresh after anything the user does; 30 minutes is Android's shortest timer |
| Amounts | Shown by default. Settings → App → "Show amounts on widgets" turns them off: This month shows the percentage of the budget used and the pace, Coming up shows names and days only, Quick add is unchanged | The app lock can't cover a widget, so a user who shows the phone around can hide money without losing the widget. Deva's own choice was amounts shown |
| Taps | Every tap opens the app behind the app lock. This month opens Budgets; Quick add opens quick add as a spend or as money in, Scan and pay, or Review; a Coming up row opens that payment or card, its title opens Recurring | A widget never shows more than the home screen already does, and never acts without the lock |
| Links | Widgets open `moneyplant://widget?open=<path>`. `app/+native-intent.tsx` sends the app to Home and keeps the path; once the app is ready (signed in, consented, database open) the root layout pushes it, the same way a tapped notification does. Only paths on a fixed list are opened | Back from a widget's screen lands on Home instead of closing the app, and a cold start through the guards never lands on a blank route. The list stops other apps from deep-linking anywhere through the widget link |
| Signed out, or the database can't open | Each widget shows "Open Money Plant" and opens the app | Never stale numbers from someone else, never an error box |
| Rounding and currency | Totals follow "Round off totals" and the home currency; each Coming up row shows its own currency (decision 0017) | Same rules as Home |
| Release | Native code: `version` in `app.json` goes to 0.12.0 and a new production APK is needed. Over-the-air updates never reach 0.11.0 builds with this code (`runtimeVersion` policy `appVersion`) | CLAUDE.md rule for native changes |
| Building the APK | Deploy now starts the production build on EAS after any merge that moves `app.json`'s version (also by hand: Actions → Deploy, "Build a production APK"), with `--no-wait`, and links the build page in the run's summary. Installing it and the Drive upload for friends stay by hand | Asked for by Deva on 2026-11-26. Not waiting keeps Actions minutes free and doesn't hold later deploys behind EAS's free build queue; a Drive upload would need a Google credential in GitHub |

## Not done

- Previews in the widget picker use the app icon. Picture previews can be added later as `previewImage` files.
- Lock screen widgets (Android 16 QPR2 and some tablets) are not designed for: the widgets declare only the home screen (`widgetCategory` `home_screen`), since the lock screen is visible to anyone holding the phone. Someone who places one there anyway can turn amounts off.
- iOS widgets wait for iOS itself (CAP-4).
