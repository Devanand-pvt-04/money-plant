import { describe, expect, it } from 'vitest';
import type { Model } from '../ollama';
import { categorisePrompt, checkAnswer, parsePayload, runCategorise } from './categorise';

const payload = {
  items: [
    { merchant: 'swiggy', label: 'SWIGGY', vpa: 'swiggy@icici', amountBand: '₹100 to ₹500', timeOfDay: 'evening', direction: 'debit' as const },
    { merchant: 'shree ganesh enterpri', label: 'SHREE GANESH ENTERPRI', vpa: null, amountBand: 'under ₹100', timeOfDay: 'morning', direction: 'debit' as const },
  ],
  categories: [
    { key: 'food', name: 'Food' },
    { key: 'groceries', name: 'Groceries' },
  ],
};

const fakeModel = (answer: unknown): Model & { asked: { messages: unknown; schema: unknown }[] } => {
  const asked: { messages: unknown; schema: unknown }[] = [];
  return {
    asked,
    json: async (messages, schema) => {
      asked.push({ messages, schema });
      return answer;
    },
    installed: async () => ['qwen:latest'],
  };
};

describe('categorise job', () => {
  it('limits the schema to the listed keys plus unknown', () => {
    const { schema, messages } = categorisePrompt(parsePayload(payload));
    expect(JSON.stringify(schema)).toContain('"enum":["food","groceries","unknown"]');
    expect(messages[1]!.content).toContain('food: Food');
    expect(messages[1]!.content).toContain('swiggy@icici');
  });

  it('keeps valid answers and turns the rest into unknown', async () => {
    const model = fakeModel({
      results: [
        { merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 0.95 },
        { merchant: 'swiggy', key: 'groceries', name: 'Swiggy', confidence: 0.4 },
        { merchant: 'shree ganesh enterpri', key: 'rent', name: 'Shree Ganesh 9876543210', confidence: 3 },
        { merchant: 'not asked', key: 'food', name: 'X', confidence: 1 },
      ],
    });
    const result = await runCategorise(model, payload);
    expect(result.results).toEqual([
      { merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 0.95 },
      { merchant: 'shree ganesh enterpri', key: null, name: 'Shree Ganesh', confidence: 0 },
    ]);
  });

  it('answers unknown for a merchant the model skipped and clamps confidence', () => {
    const result = checkAnswer(parsePayload(payload), { results: [{ merchant: 'swiggy', key: 'food', name: ' Swiggy ', confidence: 1.4 }] });
    expect(result.results).toEqual([
      { merchant: 'swiggy', key: 'food', name: 'Swiggy', confidence: 1 },
      { merchant: 'shree ganesh enterpri', key: null, name: null, confidence: 0 },
    ]);
  });

  it('rejects an answer that names none of the merchants, so the job is retried', () => {
    expect(() => checkAnswer(parsePayload(payload), { results: [{ merchant: 'zomato', key: 'food', name: 'Zomato', confidence: 1 }] })).toThrow();
    expect(() => checkAnswer(parsePayload(payload), { nope: true })).toThrow();
  });

  it('rejects a payload without items or categories', () => {
    expect(() => parsePayload(null)).toThrow('bad payload');
    expect(() => parsePayload({ items: [], categories: payload.categories })).toThrow('bad payload');
  });
});
