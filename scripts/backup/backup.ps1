# Weekly backup of the Money Plant cloud database to this PC (decision 0011).
#
# Dumps the public schema (the ledger: tables, policies and data) and the
# auth.users rows the ledger belongs to with pg_dump, two files per day, and
# keeps the newest $Keep days. The ledger is dumped whole, not data only,
# because accounts refer to accounts (categories have parents), which a
# data-only dump can't restore in order. The connection string, which holds the
# database password, is read from a file on this PC and never goes in the
# repo. See README.md in this folder for the setup.

param(
  [string]$Folder = (Join-Path $HOME 'Documents\Money Plant backups'),
  [string]$UrlFile = (Join-Path $HOME '.money-plant\db-url.txt'),
  [int]$Keep = 12
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $UrlFile)) {
  throw "No connection string at $UrlFile. Copy the Session pooler URI from the Supabase dashboard into it (see README.md)."
}
$url = (Get-Content -Raw $UrlFile).Trim()

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  $found = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $found) { throw 'pg_dump not found. Install the PostgreSQL 17 command line tools (see README.md).' }
  $pgDump = $found.FullName
}

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$day = Get-Date -Format 'yyyy-MM-dd'
$file = Join-Path $Folder "money-plant-$day.dump"
$users = Join-Path $Folder "money-plant-$day-users.dump"
$log = Join-Path $Folder 'backup.log'

function Invoke-Dump([string[]]$arguments) {
  & $pgDump --dbname=$url --format=custom --no-owner --no-privileges @arguments
  if ($LASTEXITCODE -ne 0) {
    Add-Content $log ("{0} FAILED (pg_dump exit {1})" -f (Get-Date -Format s), $LASTEXITCODE)
    throw "pg_dump failed with exit code $LASTEXITCODE"
  }
}

Invoke-Dump @('--schema=public', "--file=$file")
Invoke-Dump @('--data-only', '--table=auth.users', "--file=$users")

$size = [math]::Round((Get-Item $file).Length / 1KB)
Add-Content $log ("{0} OK {1} ({2} KB)" -f (Get-Date -Format s), (Split-Path $file -Leaf), $size)

Get-ChildItem $Folder -Filter 'money-plant-*.dump' | Where-Object Name -NotLike '*-users.dump' | Sort-Object Name -Descending | Select-Object -Skip $Keep | ForEach-Object {
  Remove-Item $_.FullName
  Remove-Item ($_.FullName -replace '\.dump$', '-users.dump') -ErrorAction SilentlyContinue
}
Write-Output "Saved $file ($size KB)"
