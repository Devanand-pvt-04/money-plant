## What and why

<!-- What changed, in plain words, and the requirement IDs it serves (for example CAP-2, LED-3). -->

## How it ships

- [ ] JS only: OTA with `npx eas-cli@latest update --channel preview`, then `production` once tried
- [ ] Native change: `version` bumped in `apps/mobile/app.json` and a new build is needed (CI checks this)
- [ ] Database: new migration in `supabase/migrations`, apply with `npx supabase db push`
- [ ] Edge function: deploy with `npx supabase functions deploy <name>`

## Checks

- [ ] `pnpm typecheck` and `pnpm test` pass
- [ ] Amounts stay integer paise; every entry's postings sum to zero and it has a source
- [ ] No raw SMS text is logged, synced or sent to AI
- [ ] A new table has `updated_at`, `deleted_at`, a client UUID, row-level security and a case in `rls.test.sql`

## Security

<!-- How this change was checked for security (docs/security.md): who can reach the new code or data, and what stops anyone else. -->
