# Weekly backup to your PC

The free Supabase plan keeps no backups you can restore, so this script copies the cloud database to your PC once a week (decision 0011). Task Scheduler runs it on Sundays at 11:00, or at the next start if the PC was off then. Each run saves two files and keeps the newest 12 weeks:

- `money-plant-<date>.dump`: the whole ledger (the `public` schema with its tables, policies and data)
- `money-plant-<date>-users.dump`: the sign-ins the ledger belongs to (`auth.users`)

They hold your financial data unencrypted. Keep the folder on this PC, not in a shared or cloud-synced folder, and turn on BitLocker if the PC has it.

## Setup (once, about 10 minutes)

1. **Install pg_dump.** Download the PostgreSQL 17 installer for Windows from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/). In the installer, tick only **Command Line Tools**. pg_dump must be the same major version as the Supabase database or newer. The dashboard shows the version under Settings → Infrastructure.
2. **Save the connection string.** In the [Supabase dashboard](https://supabase.com/dashboard/project/dywcmxixmzeqhzifuhwm), click **Connect** at the top and copy the **Session pooler** URI (the direct connection needs IPv6). Replace `[YOUR-PASSWORD]` with the database password. If you've lost it, reset it under Settings → Database; the app doesn't use it. Save the URI as the only line of `%USERPROFILE%\.money-plant\db-url.txt`. This file is the only place the password lives; it never goes in the repo.
3. **Try it once.** From this folder:
   ```
   powershell -ExecutionPolicy Bypass -File .\backup.ps1
   ```
   It prints `Saved ...\Documents\Money Plant backups\money-plant-<date>.dump`. `backup.log` in that folder records every run.
4. **Schedule it.**
   ```
   powershell -ExecutionPolicy Bypass -File .\register-backup.ps1
   ```
   The task shows up as **Money Plant backup** in Task Scheduler.

Options: `-Folder` for another folder, `-Keep` for a different number of weeks, `-UrlFile` for another place for the connection string.

## Restoring

A restore goes into an empty Supabase project, or into this one after something went wrong. Ask Claude in the project to walk you through it. The outline:

1. Restore the users file: `pg_restore --dbname=<uri> money-plant-<date>-users.dump`
2. Restore the ledger: `pg_restore --dbname=<uri> --no-owner --clean --if-exists money-plant-<date>.dump`. An error that schema `public` already exists is expected and harmless.
3. Sign out and back in on the phone, so it pulls the restored ledger.
