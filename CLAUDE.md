# Money Plant

Money Plant is a personal finance app for Deva and friends. It keeps one accurate, cloud-synced ledger and fills it mostly from bank SMS. The Android MVP comes first; iOS follows later.

- Product requirements: `docs/PRD.md`. Requirement IDs such as CAP-1 and LED-3 are defined there. Cite them in commits and PRs.
- Architecture: `docs/architecture.md`
- Decisions: `docs/decisions/`

## Stack

- pnpm monorepo, TypeScript everywhere except the native modules
- `apps/mobile`: React Native with Expo (development builds, not Expo Go), Expo Router, op-sqlite with SQLCipher, Drizzle, TanStack Query, Zustand
- `apps/mobile/modules/sms-reader`: Kotlin Expo module (SMS receiver, notification listener)
- `packages/core`, `parser`, `matcher`, `categoriser`, `db-schema`: shared logic, no React imports
- `supabase/`: Postgres migrations with row-level security, edge functions (Deno, TypeScript)
- `services/cas-parser`: Python service wrapping casparser
- AI: Anthropic API, called only from edge functions. Use `claude-haiku-5-5` for categorising and `claude-sonnet-5-5` for the month review.

## Rules

- Money is always integer paise. Never use floating point for amounts.
- Every transaction's postings sum to zero (double-entry). Write balances only as sums of postings, never as stored totals.
- Every transaction has at least one source row. No entry exists without a source.
- Raw SMS text never leaves the device. Don't log it, sync it or send it to AI. Only parsed fields leave the parser.
- Secrets (Anthropic, SMTP, MSG91) live only in Supabase edge function secrets. Never put them in the app or the repo.
- Every new table needs `updated_at`, `deleted_at` and a client-generated UUID primary key, plus row-level security policies.
- Free tiers only. Don't add a paid service without asking. The Anthropic API is the one exception, and it runs under a hard monthly cap.
- Support these banks first: ICICI, HDFC, HSBC, SBI. Adding a bank format needs anonymised fixtures in `packages/parser/fixtures/<bank>/`.
- Never add code that moves money. UPI links only hand off to the user's own UPI app.

## Commands

The commands are filled in once milestone 1 scaffolds the repo: install, dev build, test, lint, Supabase local start and migrations.
