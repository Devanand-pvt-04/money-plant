# Backups

The free Supabase plan keeps no backups you can restore. Since the friends release (decision 0016), a GitHub Actions job makes them in the cloud, encrypted, so they no longer depend on your PC being on or hold friends' data in plain files on it.

## Cloud backup (current)

Every Sunday at 11:00 India time, `.github/workflows/backup.yml` dumps the ledger (`public` schema) and the sign-ins (`auth.users`), encrypts both with [age](https://github.com/FiloSottile/age) on the way out of pg_dump, and keeps them as a build artifact for 90 days (about 12 weeks). GitHub only ever holds the encrypted files. You can also run it any time from **Actions → Weekly backup → Run workflow**.

### Setup (once, about 10 minutes)

1. **Install age on your PC:** `winget install --id FiloSottile.age` in PowerShell, then close PowerShell and open a new window so `age-keygen` is found.
2. **Make your key pair outside the repo folder:** `age-keygen -o "$HOME\Documents\money-plant-backup-key.txt"`. It prints `Public key: age1...`. The file is the private key: **only it can open the backups, and losing it means losing them.** Keep it offline, for example on a USB stick and in your password manager, never in the repo, Drive or GitHub.
3. **Add two repository secrets** in GitHub → the repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL`: the **Session pooler** URI from the Supabase dashboard's **Connect** button, with `[YOUR-PASSWORD]` replaced by the database password (reset it under Settings → Database if needed).
   - `BACKUP_AGE_RECIPIENT`: the `age1...` public key from step 2.
4. **Run it once:** Actions → Weekly backup → Run workflow. When it finishes green, the run page lists an artifact `money-plant-backup-<date>`.
5. **Test a restore** (below) into a throwaway database, or at least decrypt it and run `pg_restore --list` on the result. Only then remove the PC backup.

### Restoring from the cloud

1. Download the artifact zip from the Actions run and unzip it.
2. Decrypt both files:
   ```
   age -d -i money-plant-backup-key.txt -o money-plant-<date>.dump money-plant-<date>.dump.age
   age -d -i money-plant-backup-key.txt -o money-plant-<date>-users.dump money-plant-<date>-users.dump.age
   ```
3. Restore as in "Restoring" below. Delete the decrypted `.dump` files afterwards.

### Removing the old PC backup

Once a cloud backup has been restored or listed successfully, in PowerShell:

1. `Unregister-ScheduledTask -TaskName 'Money Plant backup' -Confirm:$false`
2. Delete `%USERPROFILE%\.money-plant\db-url.txt` (it holds the database password).
3. Delete the `Documents\Money Plant backups` folder.
4. Reset the database password in Supabase (Settings → Database) and put the new one in the `SUPABASE_DB_URL` secret.
5. Optionally uninstall the PostgreSQL command line tools, unless you want them for restores.

## Weekly backup to your PC (before decision 0016)

The free Supabase plan keeps no backups you can restore, so this script copies the cloud database to your PC once a week (decision 0011). Task Scheduler runs it on Sundays at 11:00, or at the next start if the PC was off then. Each run saves two files and keeps the newest 12 weeks:

- `money-plant-<date>.dump`: the whole ledger (the `public` schema with its tables, policies and data)
- `money-plant-<date>-users.dump`: the sign-ins the ledger belongs to (`auth.users`)

They hold your financial data unencrypted. Keep the folder on this PC, not in a shared or cloud-synced folder, and turn on BitLocker if the PC has it.

### Setup on the PC

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
