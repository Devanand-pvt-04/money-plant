import type { MonthReviewFacts } from '@money-plant/core';

/** A made-up month, so the check and the model test exercise month reviews without anyone's data. */
export const SAMPLE_FACTS: MonthReviewFacts = {
  month: 'October 2026',
  spent: 58_400,
  budget: 45_000,
  inBudgets: 49_900,
  outside: 8_500,
  income: 95_000,
  kept: 36_600,
  budgetLeft: -4_900,
  overspends: [
    {
      category: 'Food',
      spent: 14_200,
      limit: 10_000,
      over: 4_200,
      usual: 9_600,
      payees: [
        { payee: 'Swiggy', amount: 6_100, count: 14 },
        { payee: 'Meghana Foods', amount: 2_900, count: 2 },
        { payee: 'Zomato', amount: 2_400, count: 6 },
      ],
      largest: [
        { id: '6f1c2b1e-0000-4000-8000-000000000001', payee: 'Meghana Foods', amount: 2_300, date: '2026-10-18' },
        { id: '6f1c2b1e-0000-4000-8000-000000000002', payee: 'Swiggy', amount: 1_150, date: '2026-10-24' },
        { id: '6f1c2b1e-0000-4000-8000-000000000003', payee: 'Swiggy', amount: 890, date: '2026-10-05' },
      ],
    },
    {
      category: 'Shopping',
      spent: 9_700,
      limit: 9_000,
      over: 700,
      usual: 5_200,
      payees: [
        { payee: 'Amazon', amount: 7_200, count: 3 },
        { payee: 'Decathlon', amount: 2_500, count: 1 },
      ],
      largest: [
        { id: '6f1c2b1e-0000-4000-8000-000000000004', payee: 'Amazon', amount: 5_499, date: '2026-10-21' },
        { id: '6f1c2b1e-0000-4000-8000-000000000005', payee: 'Decathlon', amount: 2_500, date: '2026-10-12' },
      ],
    },
  ],
  biggest: [
    { category: 'Rent', spent: 18_000, usual: 18_000 },
    { category: 'Food', spent: 14_200, usual: 9_600 },
    { category: 'Shopping', spent: 9_700, usual: 5_200 },
    { category: 'Transport', spent: 4_100, usual: 4_400 },
    { category: 'Bills', spent: 3_900, usual: 3_700 },
  ],
  uncategorised: { count: 4, amount: 2_100 },
  suggestions: [{ category: 'Food', kind: 'raise', current: 10_000, suggested: 12_000 }],
};
