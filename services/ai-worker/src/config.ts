export interface Config {
  supabaseUrl: string;
  workerToken: string;
  model: string;
  ollamaUrl: string;
  pollSeconds: number;
}

/** Reads the worker's settings from the environment (and .env, loaded by main.ts). */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ['SUPABASE_URL', 'AI_WORKER_TOKEN', 'AI_MODEL'].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Set ${missing.join(', ')} in services/ai-worker/.env (see .env.example)`);
  const pollSeconds = Number(env.POLL_SECONDS ?? 30);
  return {
    supabaseUrl: env.SUPABASE_URL!.replace(/\/$/, ''),
    workerToken: env.AI_WORKER_TOKEN!,
    model: env.AI_MODEL!,
    ollamaUrl: (env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds >= 5 ? pollSeconds : 30,
  };
}
