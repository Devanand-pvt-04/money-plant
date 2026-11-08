# Security

How Money Plant keeps each person's money data private, what CI checks on every PR, and what Deva checks by hand (decision 0016). No app is free of bugs, so these checks keep running after the friends release.

## What protects the data

| Layer | Protection |
| --- | --- |
| Server rows | Row-level security on every table: a user reads and writes only their own rows, plus the IOUs they're part of. Signed-out callers have no table access at all. Signed-in users can't truncate tables (truncate skips row-level security) |
| Server functions | Every edge function checks the caller's sign-in, except `ai-worker`, which checks the worker token in constant time. Each validates its input and returns short error codes, never internal messages. Security definer database functions pin their `search_path` and aren't callable when signed out |
| Secrets | The service role key, worker token, CAS token and SMTP password live only in Supabase. The anon key in `apps/mobile/.env` is public by design |
| Phone | SQLCipher-encrypted database, app lock, window hidden in recent apps, raw SMS never leaves the phone, Android's cloud backup of app data turned off (`allowBackup: false`) |
| Sign-in | Email OTP that expires in 10 minutes, at most one code a minute per address. From the friends release, sign-up only for invited emails (ACC-8) |

## Checked on every PR (CI)

- `supabase test db` runs `supabase/tests/database/rls.test.sql`. It makes three users and proves none can read, change or delete another's rows in any table: accounts, entries, postings, sources, balance anchors, account types, rules, budgets, recurring payments, groups, deposits, holdings, AI jobs, AI usage, IOUs, repayments and crash reports. It also fails if any table lacks row-level security or a policy, if signed-out callers have any grant, or if a security definer function is open to them. **Every new table needs a case here.**
- `supabase db advisors --fail-on warn`: Supabase's Security and Performance Advisor on the migrated database.
- `pnpm audit --prod --audit-level high`: fails on high or critical advisories.
- gitleaks scans the whole git history for keys, tokens and passwords. `.gitleaksignore` lists the one known public value.
- Dependabot raises security updates as advisories appear, and grouped version bumps monthly.

Every PR description also says how its change was checked for security.

## Deva's one-time setup

1. **Two-factor sign-in** on GitHub, Supabase, Expo and the Gmail account that sends OTPs. Use an authenticator app, not SMS.
2. **GitHub → repo Settings → Code security:** turn on Dependabot alerts and Dependabot security updates.
3. **Supabase → Authentication → Sign In / Providers → Email:** set the email OTP expiry to 600 seconds. Under **Rate Limits**, keep emails sent per hour low (30 is plenty for friends).
4. **Supabase → Advisors → Security Advisor:** fix anything it lists for the hosted project. Some settings only exist there, not in migrations.
5. **Supabase → Settings → API:** never copy the `service_role` key anywhere except Supabase's own secrets.

## Monthly (first Sunday, about 10 minutes)

- [ ] Supabase Security Advisor shows no warnings.
- [ ] GitHub's Dependabot alerts list is empty, or each alert has a PR.
- [ ] Supabase → Authentication → Users holds only people you invited.
- [ ] Settings → Health and the `app_errors` table show nothing unusual.
- [ ] The latest weekly backup exists and opens (decision 0016).

## If something goes wrong

Do these the same day, in order:

1. **Stop new damage.** Supabase → Authentication → Sign In / Providers: turn off "Allow new users to sign up". If a key leaked, rotate it: Settings → API for the JWT secret and keys, and Edge Functions → Secrets for the others. Rotating the JWT secret signs everyone out.
2. **Find out what happened.** Check Supabase logs (API, Auth, Edge Functions) and `app_errors`. Ask Claude in the project for help.
3. **Tell friends within a day.** Say what happened, what data was affected, and what you changed. Offer each of them export and delete (ACC-4).
4. **Fix and record.** Fix it in a PR with a test that would have caught it, and add a decision record.
