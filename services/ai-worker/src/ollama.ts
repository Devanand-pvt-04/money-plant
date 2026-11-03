import type { Config } from './config';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** The local model, served by Ollama on the same PC. */
export interface Model {
  /** Asks for JSON matching `schema` and returns it parsed. Throws when the reply isn't JSON. */
  json(messages: readonly ChatMessage[], schema: object): Promise<unknown>;
  /** Names of the models pulled into Ollama. */
  installed(): Promise<string[]>;
}

export function ollama(config: Pick<Config, 'ollamaUrl' | 'model'>, fetchImpl: typeof fetch = fetch): Model {
  return {
    async json(messages, schema) {
      let response: Response;
      try {
        response = await fetchImpl(`${config.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            messages,
            format: schema,
            stream: false,
            // Same input, same answer: categorising should be repeatable.
            options: { temperature: 0 },
          }),
          signal: AbortSignal.timeout(5 * 60_000),
        });
      } catch (error) {
        throw new Error(`Ollama unreachable at ${config.ollamaUrl} (${(error as Error).name})`);
      }
      if (!response.ok) throw new Error(`Ollama: HTTP ${response.status}`);
      const body = (await response.json()) as { message?: { content?: string } };
      try {
        return JSON.parse(body.message?.content ?? '');
      } catch {
        throw new Error('The model did not answer in JSON');
      }
    },
    async installed() {
      const response = await fetchImpl(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Ollama: HTTP ${response.status}`);
      const body = (await response.json()) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name);
    },
  };
}
