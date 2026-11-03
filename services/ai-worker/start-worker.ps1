# Started by Task Scheduler at login (see README.md). Runs the worker with no
# window and appends its log (job IDs and timings only) to worker.log here.
Set-Location $PSScriptRoot
pnpm start *>> worker.log
