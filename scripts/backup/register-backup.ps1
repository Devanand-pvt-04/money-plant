# Registers backup.ps1 as a weekly Task Scheduler task (Sundays at 11:00).
# If the PC is off then, it runs at the next start. Run once, from this folder:
#   powershell -ExecutionPolicy Bypass -File .\register-backup.ps1

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'backup.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 11am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName 'Money Plant backup' -Action $action -Trigger $trigger -Settings $settings -Description 'Weekly backup of the Money Plant database' -Force | Out-Null
Write-Output "Registered 'Money Plant backup': Sundays at 11:00, or at the next start if the PC was off."
