import { describe, expect, it } from 'vitest';
import type { Model } from '../ollama';
import { checkReview, quotedFigures, runMonthReview } from './month-review';
import { SAMPLE_FACTS } from './month-review-sample';

const good = {
  summary: 'You spent ₹58,400 against ₹95,000 coming in, so you kept ₹36,600. Budgets went ₹4,900 over, mostly on Food.',
  causes: [
    { category: 'Food', text: 'Swiggy took ₹6,100 over 14 orders, and one Meghana Foods bill was ₹2,300.', transactionIds: ['6f1c2b1e-0000-4000-8000-000000000001'] },
    { category: 'Shopping', text: 'An Amazon order of ₹5,499.', transactionIds: ['6f1c2b1e-0000-4000-8000-000000000004'] },
  ],
};

describe('quotedFigures', () => {
  it('reads ₹ and Rs figures, with k and lakh', () => {
    expect(quotedFigures('₹12,500 and Rs. 300, about ₹1.2 lakh or ₹14k')).toEqual([12_500, 300, 120_000, 14_000]);
  });
});

describe('checkReview', () => {
  it('keeps an answer that quotes only the facts, rounding allowed', () => {
    expect(checkReview(good, SAMPLE_FACTS)).toEqual(good);
    expect(checkReview({ summary: 'About ₹58k went out.', causes: [] }, SAMPLE_FACTS).summary).toBe('About ₹58k went out.');
  });

  it('fails a summary with a made-up figure, so the job is retried', () => {
    expect(() => checkReview({ ...good, summary: 'You saved ₹40,000.' }, SAMPLE_FACTS)).toThrow('figure not in the facts');
    expect(() => checkReview({ causes: [] }, SAMPLE_FACTS)).toThrow('no summary');
  });

  it('drops causes with an unknown transaction, category or figure', () => {
    const result = checkReview(
      {
        summary: good.summary,
        causes: [
          { category: 'Food', text: 'Swiggy.', transactionIds: ['6f1c2b1e-0000-4000-8000-000000000099'] },
          { category: 'Travel', text: 'Trips.', transactionIds: [] },
          // An ID from another category's entries is not this cause's evidence.
          { category: 'Shopping', text: 'Amazon.', transactionIds: ['6f1c2b1e-0000-4000-8000-000000000001'] },
          { category: 'Shopping', text: 'Amazon took ₹7,777.', transactionIds: [] },
        ],
      },
      SAMPLE_FACTS,
    );
    expect(result.causes).toEqual([]);
  });

  it('runs on the model with the facts as JSON', async () => {
    let sent = '';
    const model: Model = {
      json: async (messages) => {
        sent = messages[1]!.content;
        return good;
      },
      installed: async () => [],
    };
    expect(await runMonthReview(model, SAMPLE_FACTS)).toEqual(good);
    expect(JSON.parse(sent).month).toBe('October 2026');
    await expect(runMonthReview(model, { month: 3 })).rejects.toThrow('bad payload');
  });
});
