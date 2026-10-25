# 0010: Milestone 5 plan: month review, deposits, mutual funds, statements

Decided by Deva on 2026-10-25, from the milestone 5 plan doc (https://claude.ai/artifact/NHdyaHY5kV4qwi15CtFxhx).

| Decision | Choice | Why |
| --- | --- | --- |
| Build order | 1. Month review (BUD-4), 2. FDs and RDs (NW-2), 3. mutual funds from a CAS with daily NAV (NW-3, NW-4), 4. statement import (CAP-5). Each ships as an over-the-air update; none needs a new app build | The review is useful at once and needs no server work; investments then fix net worth; statements fill gaps last |
| Month review | Worked out on the phone from the ledger, with a local notification at 9 am on the 1st. Suggestions accepted or ignored are kept on the phone. No server table until the AI review in milestone 6 | No new server work, and every number traces to an entry |
| FD and RD value | Net worth counts a deposit at its value today: paid in plus interest earned so far, with quarterly compounding. The ledger holds what was paid in; interest is posted as income when the bank pays it. TDS is left out for now | How most people add up their deposits |
| RD and SIP instalments | Debits matched to a deposit's or a fund's payee and amount become transfers into that account, so they are not spending. Deva's SHIVALIK SMALL autopay is an RD | October's spending counted these as expenses |
| CAS and statement PDFs | A Python service (casparser, plus a statement table reader) on Render's free tier in Singapore, reached only through edge functions with a shared secret. Files and passwords are never stored | Free with no card; an import a month makes the cold start acceptable |
| Stocks | Deferred: no demat holdings for now | Deva holds none yet |
| Speed pass | Moved to the friends release (milestone 7), measured on Deva's phone first | Deva wants optimisation at the final stage |
