# 0029: Paying people when UPI apps block payment links

Decided by Deva on 2026-11-13, in the thread "Make paying friends work with UPI apps". Pay by UPI on a person (IOU-3) opened a `upi://pay` link with the friend's UPI ID and amount. Paytm now stops these with a "Payment Alert" ("may fail as per UPI Risk Policy … pay via mobile number or scanning their QR"), and Google Pay and PhonePe block or warn too. The check runs inside the UPI apps: person-to-person payments started from another app's link are treated as risky, while merchant links still work. No code in Money Plant can get a friend's link past it. Deva asked to keep the existing link and build the fallback beside it.

## Choices

| Decision | Choice | Why |
| --- | --- | --- |
| Where | Pay by UPI on a person opens a **Pay** screen (`person/pay`) instead of the link. It shows when the user owes them in rupees and they have a UPI ID or a phone number | One place for every way to pay a person |
| Copy and open | Their main UPI ID, mobile number (decision 0021) and other UPI IDs are rows; tapping one copies it and makes it the one to use. Buttons for Google Pay, PhonePe, Paytm and BHIM copy it and open that app's home screen, where the user picks "Pay UPI ID or number", pastes and types the amount ("Copy amount" is on the money card) | Paying a pasted ID or number inside the UPI app is the flow the apps trust, and the one Paytm itself suggests |
| Opening the app | `IntentLauncher.openApplication(package)` first; if Android hides the package (no `<queries>` in the manifest), the app's own home link (`phonepe://`, `paytmmp://`); else a message to open it by hand. The text is already copied either way | JS only, so it ships by OTA on 0.11.0. A later native build can add `<queries>` for these packages to make opening certain |
| Their QR | A QR of their UPI link (with the amount when something is owed), drawn with plain views from `qrcode-generator`, so another phone can scan it | Scanning is the other flow the apps trust. No native module needed |
| The old link | Stays, as a secondary "Open with the UPI link" button | Some apps or banks still allow it |
| After paying | Unchanged: once the bank SMS is in, Settle up links that payment (an "I've paid: settle up" button goes there) | No new matching |

Nothing here moves money: the UPI app asks for the PIN and does the payment.

## Code

- `apps/mobile/src/app/person/pay.tsx`: the Pay screen.
- `apps/mobile/src/components/qr-code.tsx`: `QrCode`, a QR drawn with views (dark runs merged per row).
- `apps/mobile/src/lib/upi.ts`: `UPI_APPS`, `copyText` (React Native's built-in clipboard module, already in the build), `openUpiApp`.
- `apps/mobile/src/app/person/[id].tsx`: the Pay by UPI shortcut opens the Pay screen.

## Later

Scan & pay (PAY-1) of a friend's QR hands the same kind of link to the UPI app and may meet the same warning. If it does, it can offer the same copy and open step for QRs without a merchant code.
