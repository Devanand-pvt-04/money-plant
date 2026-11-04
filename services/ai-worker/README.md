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

## Model test (build 2)

Before the app starts sending jobs, pick the model by testing two or three candidates on merchants
you categorised by hand (decision 0012). Pull each one first, then run from the repo root:

```
ollama pull qwen2.5:7b
ollama pull qwen3:8b
ollama pull llama3.1:8b
pnpm --filter @money-plant/ai-worker eval -- --models qwen2.5:7b,qwen3:8b,llama3.1:8b
```

Swap in newer models of about 8B if https://ollama.com/library has them; anything over about
5 GB on disk won't fit fully in the 4060's 8 GB.

- Add `--review` to have each model write the month review for a made-up month instead, through
  the same checks as a real job, and compare the write-ups by eye.
- Add `--sample` to test on a built-in set of about 60 made-up Indian shops the dictionary doesn't
  know (local stores, payment-gateway names, business UPI IDs), with no sign-in. The test also falls
  back to it on its own when none of your tagged merchants would reach the AI, because the
  dictionary already places them or they are payments to people.
- The first run asks for your Money Plant email and the code it sends, like the app, and reads your
  own entries through row-level security. It saves the labelled set to `eval-data/dataset.json`, so
  later runs skip the sign-in (`--refresh` downloads it again). `eval-data/` is git-ignored.
- Each model categorises every merchant with the same fields a real job sends, in batches of 25.
- The summary has no merchant names, so it's safe to paste into the chat. The full report, with
  each wrong answer, stays in `eval-data/`.

How to read the summary:

| Column | Meaning |
| --- | --- |
| Parent right | Share of merchants put in the right top-level category (Food for Food > Lunch) |
| Exact | Share with exactly your category |
| Applied (≥ 0.8) | Share the app would apply without asking |
| Applied but wrong | Of those, the share in the wrong top-level category: the mistake that costs you |
| Entries applied right | Share of your entries (not merchants) the app would get right with no tap |
| Time per merchant | Seconds on your GPU, after the model is loaded |

The first table covers only merchants the built-in dictionary doesn't know, which is what the AI
sees in the app. The second covers everything you tagged.

## Jobs

| Kind | From | Answer | Build |
| --- | --- | --- | --- |
| categorise | The categorise function, one job per merchant the dictionary doesn't know (shared across users) | A category key from the user's list (or unknown), a display name and a confidence. Answers at 0.8 or more join the shared merchants table | 3 |
| icon | The phone, for a new category whose name matches no icon | Up to 5 English words, which the phone matches against icon names | 3 |
| month_review | The phone, once a month has ended, with the facts its review already shows | A 2 to 3 sentence summary and one cause per overspent budget, linked to its largest entries. A summary quoting a figure not in the facts fails the job; a cause with an unknown figure, category or transaction ID is dropped | 4 |

The worker claims up to 20 jobs at a time and sends categorise jobs that share a category list to the model in one call. It claims only the kinds it has a handler for, so an older worker never takes a newer kind.
A bad answer is retried once and then marked failed; a job left running for 10 minutes (the PC
slept) goes back to the queue. Tests run against a fake Ollama, so CI needs no GPU.
