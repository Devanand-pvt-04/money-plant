# 0030: The With someone screen

Decided by Deva on 2026-11-15, in the thread "Redesign the add-with-someone screen". The old `item/new` screen asked everything with chips: a wall of every person, six "What happened" chips, and every account (mutual funds and the RD included) plus "Link later". It worked but was long and hard to read. [Mockups](https://claude.ai/artifact/EL4oGGXGeQs4mMs7rV6iMi) (row "With someone"): three directions (A gave or got, B a sentence, C a keypad) and a shared account sheet (D). Deva picked A and C merged, with D. The palette and design language of decisions 0015 and 0028 stay.

## Choices

| Part | Choice | Why |
| --- | --- | --- |
| Who | A row of round avatars: Search first, then up to eight people, the most recent first (by their latest item). Search opens the people sheet of the split screen (decision 0027), where new people and contacts are added. An entry's payee who isn't a person yet shows first, marked New, and is only created on Save (IOU-1) | No more wall of names; the usual people are one tap away |
| What happened | Four round actions: I lent, I borrowed, Paid back, Paid for me. One line under them says what the choice means. Paid back asks one more thing, They paid me or I paid them, starting from whoever owes. "Split a bill you paid" is a quiet link to the split screen. From an entry, only the actions its direction allows show (money out: I lent, Paid back; money in: I borrowed, Paid back) | Two small questions instead of six long chips |
| Amount | Big, typed on the same keypad as quick add (`components/keypad.tsx`), so the phone keyboard and scrolling are not needed. From an entry the amount is the whole entry and the keypad hides. For Paid back, an "All of it" chip fills in what is outstanding | Same feel as quick add (CAP-7) |
| Details | Small chips above the keypad: What for (opens a text field), the date, and where the money went. For Paid for me the last chip is the category, since the share is spending (SPL-2) | One line instead of three form fields |
| Where the money went (sheet D) | "It'll come by SMS" first (the default), then entries already in the ledger that fit, then only banks, cards, wallets and cash with their balances. Funds, deposits and stocks are not offered | Money with a person never moves through investments; the SMS choice avoids counting a payment twice |
| Save | The button says where the two of you stand afterwards ("Save: you'll owe Harinisree ₹350", "Save: you're all square"), from the person's balance in the item's currency; a line under it says what the balance was before | No surprise after saving |

Nothing about how items are stored changes (decision 0026): the screen builds the same `createItem` call.

## Code

JS only, no new build, no migration.

- `app/item/new.tsx`: the new screen.
- `components/keypad.tsx`: the keypad, `toMinor`, `fromMinor` and `keypadDisplay`, moved out of `app/quick-add.tsx`, which now uses it.
- `components/money-side-sheet.tsx`: sheet D.
- `components/date-fields.tsx`: `pickDate` opens the date picker without a field.
