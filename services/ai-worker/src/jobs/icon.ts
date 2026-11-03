import type { ChatMessage, Model } from '../ollama';

export interface IconPayload {
  /** The name the user gave a new category, such as "Badminton" or "Kid's tuition". */
  name: string;
}

export interface IconResult {
  /** Plain English words, best first. The phone matches them against Material Design Icons' names (CAT-1). */
  words: string[];
}

const MAX_WORDS = 5;

const SYSTEM = `You help pick an icon for a spending category in a personal finance app.
Icons come from Material Design Icons, whose names are plain English words such as "food", "car", "school", "shield", "baby-carriage", "dumbbell" or "flower".
Given a category name, which may be in Hinglish or use Indian terms, give up to ${MAX_WORDS} single English words for objects that would make a good icon, best first.
Use common nouns, not brand names.`;

export function parseIconPayload(payload: unknown): IconPayload {
  const name = (payload as Partial<IconPayload> | null)?.name;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 60) throw new Error('bad payload');
  return { name: name.trim() };
}

export function iconPrompt(payload: IconPayload): { messages: ChatMessage[]; schema: object } {
  return {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Category: ${payload.name}` },
    ],
    schema: {
      type: 'object',
      properties: { words: { type: 'array', items: { type: 'string' }, maxItems: MAX_WORDS } },
      required: ['words'],
    },
  };
}

/** Keeps lower-case single words of letters only, so the phone can match them against icon names safely. */
export function checkIconAnswer(answer: unknown): IconResult {
  const raw = (answer as { words?: unknown } | null)?.words;
  if (!Array.isArray(raw)) throw new Error('The model answer had no words');
  const words = [
    ...new Set(
      raw
        .filter((w): w is string => typeof w === 'string')
        .map((w) => w.trim().toLowerCase())
        .filter((w) => /^[a-z]{3,20}$/.test(w)),
    ),
  ].slice(0, MAX_WORDS);
  if (words.length === 0) throw new Error('The model answer had no usable words');
  return { words };
}

export async function runIcon(model: Model, payload: unknown): Promise<IconResult> {
  const { messages, schema } = iconPrompt(parseIconPayload(payload));
  return checkIconAnswer(await model.json(messages, schema));
}
