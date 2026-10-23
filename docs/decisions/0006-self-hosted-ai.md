# 0006: Self-hosted AI, built in milestone 6

Date: 2026-10-23. Decided by Deva in the "Self-hosted AI model" thread. Replaces the AI provider choice in 0001 and the AI cost row in 0004.

| Decision | Choice | Why |
| --- | --- | --- |
| AI provider | A self-hosted open-weights model on Deva's PC (16 GB RAM, RTX 4060 with 8 GB VRAM), served by Ollama. A 7 to 8B model at 4-bit fits in VRAM | Deva doesn't want to prepay API credits and wants to own the model. At our scale the API would cost about $1 to $2 a month, so the reason is ownership, not savings |
| When | AI becomes its own milestone 6, just before the friends release (now milestone 7). Milestones 3 to 5 run without AI | Deva wants AI done right. By milestone 6 there will be months of Deva's own tagged merchants to test models against |
| Until then | Categorising uses rules, learned patterns, the built-in dictionary and the shared merchants table. Unknown merchants wait in the review inbox and are checked again after 30 days. The categorise function no longer calls a model; it answers from the merchants table and shares categories users confirm. The month review shows numbers without an AI write-up | The app stays fully usable, and each tag the user gives teaches the dictionary |
| How jobs reach the PC | Edge functions add jobs to an `ai_jobs` table. A worker on the PC polls over HTTPS, runs jobs on the local model and writes results back through an edge function, with a worker token | Outgoing connections only, so nothing on the PC is exposed and no tunnel is needed |
| When the PC is off | Jobs wait in the queue. Entries stay in review, and the month review's write-up arrives later | Fine for a friends release |
| Model choice | Made in milestone 6 by testing two or three open models (for example Qwen or Llama class) on the labelled merchant set and on real month reviews | Small models know big brands but guess on local shops and cryptic UPI names, so measure before choosing |
| Privacy | AI jobs carry the same limited fields as before (merchant label, business UPI handle, amount band, time of day; month review facts). They are processed on Deva's PC, and the consent screen (ACC-5) says so | Friends' data reaches a personal machine rather than an AI provider |
| Spend caps | `ai_usage`, `AI_MONTHLY_CAP_USD` and `AI_USER_MONTHLY_CAP_USD` are no longer used. The table stays in the schema for now | There is no per-call cost to cap |
