# 0003: User control, category tree, learned patterns, splits and scan to pay

Date: 2026-10-22. Agreed with Deva in the "Product pointers and feasibility" thread. Feasibility notes: https://claude.ai/artifact/BwNnbQUCAo2BN8PMBN1izN

| Decision | Choice | Why |
| --- | --- | --- |
| User control | Every field of an entry is editable, user-set fields are never overwritten by automation, and every entry shows why it got its category (LED-8 to LED-10, CAT-6, CAT-7) | Automation is only trusted if it can be seen and corrected |
| Category depth | Two levels (Food > Lunch). Postings may sit on a parent; reports and budgets roll up (CAT-5) | Deeper trees make the picker slow on a phone for every entry |
| Shared merchant dictionary | Stores a standard category key; each user's categories map to keys | Users' trees differ, but the dictionary is shared |
| Custom account types | User-named types on a fixed class (asset or liability), with a net worth toggle; behave as plain manual accounts (ACC-6) | Balance signs and net worth depend on the class, not the name |
| Learned patterns | Computed on the phone from corrections (time window, weekday, amount band, account, payee kind), proposed to the user, matched as suggestions first (CAT-8). Run before the payments-to-people check | Free, instant and explainable; the AI sees one payment at a time and has no memory of the user's history |
| Splits | Personal splits and groups in milestone 4 (SPL-1 to SPL-3); shared groups between app users after the friends release | Friends don't need the app; shared groups need multi-user rows and confirmation flows |
| Contacts | Matched on the phone only, by phone number in the UPI ID or payee name (SPL-4); never uploaded | Privacy; hashed phone numbers are easy to reverse |
| Finding friends on the app | Email invite | Sign-in is email only, so app users have no verified phone yet |
| Scan and pay | Scan a UPI QR, hand off to the user's UPI app, log the entry with an `app_payment` source (PAY-1, PAY-2). Milestone 4 | Keeps the rule that the app never moves money; no payments licence needed |
| UPI hand-off test | A test build before milestone 3 checks Google Pay, PhonePe, a bank app and slice with a shop QR and a friend's QR | Some UPI apps decline payments started by another app; this decides the PAY-1 and IOU-3 design |
