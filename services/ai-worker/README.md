# ai-worker

The AI worker for milestone 6 (decisions 0006 and 0012). It runs on Deva's PC, next to
[Ollama](https://ollama.com), and is the only thing that talks to a model.

Every 30 seconds it asks the `ai-worker` edge function for queued jobs from the `ai_jobs` table.
It runs each job on the local model, checks the answer and posts it back. The PC only makes
outgoing calls, so nothing on it is exposed to the internet. When the PC is off, jobs wait in the
queue. The worker logs job IDs and timings only, never merchant names or answers.

## Set up (once, on Windows)

1. Install Ollama from https://ollama.com/download (it starts itself at login), then pull a model.
   Until the model test in build 2 picks one, any candidate will do:
   `ollama pull qwen2.5:7b`
2. Make a worker token and give it to Supabase. From the repo root:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   npx supabase secrets set AI_WORKER_TOKEN=<the printed string>
   npx supabase db push
   npx supabase functions deploy ai-worker
   ```
3. Copy `services/ai-worker/.env.example` to `services/ai-worker/.env` and fill in the same token
   and the model name (`AI_MODEL=qwen2.5:7b`). `.env` is git-ignored.
4. Check that everything connects: `pnpm --filter @money-plant/ai-worker check`. It shows Ollama
   running, the model's answers for three well-known merchants, and the queue.
5. Start it at every login, with no window. Open PowerShell in the repo folder and run:
   ```
   $script = (Resolve-Path services\ai-worker\start-worker.ps1).Path
   schtasks /Create /TN "Money Plant AI worker" /SC ONLOGON /RL LIMITED /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
   schtasks /Run /TN "Money Plant AI worker"
   ```
   The log is `services/ai-worker/worker.log`. To stop it: `schtasks /End /TN "Money Plant AI worker"`.
   To remove it: `schtasks /Delete /TN "Money Plant AI worker" /F`.

To run it in a terminal instead, use `pnpm --filter @money-plant/ai-worker start` and stop it with Ctrl+C.

If the token ever leaks, set a new one with `npx supabase secrets set` and in `.env`; the old
one stops working at once.

## Jobs

| Kind | From | Answer | Build |
| --- | --- | --- | --- |
| categorise | The categorise function, for merchants the dictionary doesn't know | A category key from the user's list (or unknown), a display name and a confidence | 1 (worker side); queued from build 3 |
| icon | The phone, for a new category whose name matches no icon | An icon name from a shortlist | 3 |
| month_review | The phone, on the 1st | A headline and 2 to 4 causes, each linked to transaction IDs | 4 |

The worker claims only the kinds it has a handler for, so an older worker never takes a newer kind.
A bad answer is retried once and then marked failed; a job left running for 10 minutes (the PC
slept) goes back to the queue. Tests run against a fake Ollama, so CI needs no GPU.
