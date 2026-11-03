# 0012: Milestone 6 plan: the self-hosted AI

Decided by Deva on 2026-11-03, from the milestone 6 plan doc (https://claude.ai/artifact/NTAJetwPwBQepuecKSGJCc). Deva took the recommended option on all five questions. Builds on 0006, which chose a self-hosted model on Deva's PC.

## What AI does in the MVP

AI takes over the work left to the user after rules, learned patterns and the dictionary. It names merchants the app has never seen, helps a new friend who has no rules yet (confident answers join the shared dictionary, so each merchant is named once for everyone), writes a short month review on top of the numbers, and suggests a Material Design icon when a new category's name matches none (CAT-1). It never reads SMS, changes amounts or balances, moves money, or overrides a field the user set (LED-8). A bigger role for AI is discussed in a later phase.

## Order of work

| Build | What | To ship it |
| --- | --- | --- |
| 1. Queue and worker | `ai_jobs` table, `ai-worker` edge function, and a Node worker in `services/ai-worker` that runs a test job | `db push`, set `AI_WORKER_TOKEN`, deploy `ai-worker`, install Ollama on the PC |
| 2. Model test | An eval script scores two or three candidate models on Deva's own tagged merchants and writes October's review with each | Run on the PC; Deva picks the model from the scores |
| 3. AI categorising | The categorise function queues misses; the phone applies or suggests the answers; AI switch, consent text and a waiting line in Activity; icon suggestions | Deploy `categorise` and `ai-worker`, OTA |
| 4. AI month review | The phone sends the review facts; the write-up shows above the numbers | `db push`, OTA |

None of them needs a new app build. Migrations for this milestone use timestamps from 20261104000000 to 20261119235959.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Month review facts | The phone sends the facts it already shows (totals, overspends, top payees and largest entries with their transaction IDs, 3-month averages) as an AI job. No SQL copy of the review on the server | The write-up and the numbers can't disagree, and there is one copy of the maths |
| Low-confidence answers | At 0.8 or more the category is applied and shown as "AI" with its confidence (CAT-6), and shared through the merchants table. Below 0.8 it is a one-tap suggestion in Review and is not shared | A wrong guess costs a tap, not a wrong budget |
| AI switch | Each user has an AI switch in the Money tab, on after accepting the consent screen. Off means nothing of theirs is queued; dictionary answers still work | Friends' data goes to Deva's PC, so each friend can say no |
| Worker on Windows | A Node script started by Task Scheduler at login, polling every 30 seconds, claiming up to 5 jobs at a time | Jobs clear whenever the PC is on, with nothing to remember |
| Waiting line | Activity shows "N merchants waiting for AI" while a user's jobs are queued | A PC that is off is visible rather than looking like a bug |
| Checks on answers | The worker asks Ollama for JSON matching a schema, rejects a category key that isn't in the list, and drops any month review cause that names a transaction ID not in the facts. A bad answer is retried once, then marked failed. A job left running for 10 minutes goes back to the queue | The model can't invent categories or figures |
| Limits | A categorise job queued for 30 days is dropped and the phone asks again later. Finished jobs' payloads are cleared after 30 days. The worker logs job IDs and timings only | Keeps the free database small and the PC free of user data |
| Model | Chosen in build 2: share right at parent and sub-category level, how often a confident answer is wrong, and seconds per merchant on the RTX 4060. The PRD exit (90% of a month's entries left unchanged, measured by Settings → Health) is the pass mark; if a model falls short the confidence line moves up | Measured on Deva's data, not guessed |
