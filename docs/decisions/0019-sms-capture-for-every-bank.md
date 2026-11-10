# 0019: SMS capture treats every bank alike, and reads no other apps

Decided by Deva on 2026-11-10, in the thread "Simplify SMS capture for any bank". After the friends release, Review and Settings → Bank SMS filled up with questions about apps such as Messages, Gmail, Snapchat and WhatsApp, and the screens named a short list of banks as "tuned" while every other bank looked second class.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Other apps' notifications (CAP-12) | Dropped. Only the built-in UPI and bank apps (CAP-3) are read, for payee names. Review no longer asks "Read payments from …?", and Settings has no "Other apps" list. Old answers and messages that waited under those apps are cleared on the next inbox scan | Bank money messages arrive by SMS; app notifications were mostly copies (Google Messages repeats every SMS) and cluttered Review |
| UPI app notifications | Kept, as before | They add the real payee to UPI payments, and never ask the user anything |
| Banks in the app | No screen names a list of supported banks. Settings → Bank SMS lists every sender alphabetically, alike. The home card, consent screen, statement import and "Test a message" (now a sender box, not bank chips) say "any bank" | Deva: the app must fit any bank; support grows from samples by trial and error, without ranking banks |
| Finding the account | Same order for every sender: the user's link for that sender; the bank's own rules where the app has learnt them; account digits in the message matching exactly one of the user's bank accounts or cards. Only when all three fail does the message wait in Review for the user to pick the account | A bank without learnt rules no longer always has to ask: most messages name the account's last digits |
| Waiting messages | Read again before every inbox scan, so they post once the app can place them (new rules, or a new account with those digits) | Generalises the PNB catch-up |

Per-bank parser rules (`packages/parser`) still exist; they are an internal detail, not something the app shows.

## Shipping

The app changes are JavaScript only and ship over the air; they also work on 0.11.x builds, which still send other apps' names and get them dropped. The listener change in `PaymentNotificationListener.kt` (built-in apps only) takes effect with the next APK build; it adds no native code the JavaScript needs, so `version` stays as it is.
