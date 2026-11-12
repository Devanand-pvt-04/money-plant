import { describe, expect, it } from 'vitest';
import { paise, type DateKey } from '@money-plant/core';
import { canRepay, forMatching, guessRepayment, iouState, iouView, isOpenIou, isVisibleIou, repaymentDirection, repaymentOptionsFor, type IouRow, type IouView } from './iou-views';

const ASHA = 'user-asha';
const BALA = 'user-bala';

function row(overrides: Partial<IouRow> = {}): IouRow {
  return {
    id: 'iou-1',
    userId: ASHA,
    ownerName: 'Asha',
    ownerEmail: 'asha@example.com',
    ownerVpa: 'asha@okicici',
    personAccountId: 'asha-person-bala',
    direction: 'lent',
    amountPaise: 50_000,
    reason: 'Dinner',
    occurredOn: '2026-11-01',
    dueDate: null,
    transactionId: 'asha-tx',
    counterpartyEmail: null,
    counterpartyPersonAccountId: null,
    counterpartyTransactionId: null,
    counterpartyVpa: null,
    confirmedAt: null,
    declinedAt: null,
    response: null,
    ...overrides,
  };
}

const people: Record<string, { name: string; vpa: string | null }> = {
  'asha-person-bala': { name: 'Bala', vpa: 'bala@okhdfc' },
  'bala-person-asha': { name: 'Asha (my sister)', vpa: null },
};
const personOf = (id: string) => people[id];

describe('iouState', () => {
  it('is personal until the owner shares it', () => {
    expect(iouState(row(), 'owner')).toBe('personal');
    expect(iouState(row({ counterpartyEmail: 'bala@example.com' }), 'owner')).toBe('awaiting_them');
    expect(iouState(row({ counterpartyEmail: 'bala@example.com', confirmedAt: 'x' }), 'owner')).toBe('confirmed');
    expect(iouState(row({ counterpartyEmail: 'bala@example.com', declinedAt: 'x' }), 'owner')).toBe('declined');
  });

  it('waits for the counterparty, and counts their unsynced answer at once', () => {
    expect(iouState(row(), 'counterparty')).toBe('awaiting_me');
    expect(iouState(row({ response: 'accept' }), 'counterparty')).toBe('confirmed');
    expect(iouState(row({ response: 'decline' }), 'counterparty')).toBe('declined');
    expect(iouState(row({ confirmedAt: 'x' }), 'counterparty')).toBe('confirmed');
  });
});

describe('iouView', () => {
  const payments = [{ id: 'p1', iouId: 'iou-1', byMe: true, amount: paise(20_000), paidAt: '2026-11-03T10:00:00Z' }];

  it('shows the owner their side', () => {
    const view = iouView(row({ counterpartyEmail: 'bala@example.com' }), ASHA, personOf, payments);
    expect(view).toMatchObject({
      role: 'owner',
      direction: 'lent',
      personId: 'asha-person-bala',
      transactionId: 'asha-tx',
      otherName: 'Bala',
      otherVpa: 'bala@okhdfc',
      sharedWith: 'bala@example.com',
      outstanding: 30_000,
    });
  });

  it('flips the direction for the counterparty and uses their own person and entry', () => {
    const shared = row({ counterpartyPersonAccountId: 'bala-person-asha', counterpartyTransactionId: 'bala-tx', confirmedAt: 'x' });
    const view = iouView(shared, BALA, personOf, []);
    expect(view).toMatchObject({
      role: 'counterparty',
      state: 'confirmed',
      direction: 'borrowed',
      personId: 'bala-person-asha',
      transactionId: 'bala-tx',
      otherName: 'Asha (my sister)',
      // The owner's own UPI ID wins over anything the counterparty saved.
      otherVpa: 'asha@okicici',
      sharedWith: null,
      outstanding: 50_000,
    });
  });

  it('names the owner from the share before the counterparty links a person', () => {
    expect(iouView(row(), BALA, personOf, []).otherName).toBe('Asha');
    expect(iouView(row({ ownerName: null }), BALA, personOf, []).otherName).toBe('asha@example.com');
    expect(iouView(row({ ownerName: null, ownerEmail: null }), BALA, personOf, []).otherName).toBe('A friend');
  });

  it('hides only IOUs the counterparty declined', () => {
    expect(isVisibleIou(iouView(row({ response: 'decline' }), BALA, personOf, []))).toBe(false);
    expect(isVisibleIou(iouView(row({ counterpartyEmail: 'b@x', declinedAt: 'x' }), ASHA, personOf, []))).toBe(true);
  });
});

function view(overrides: Partial<IouView>): IouView {
  return {
    id: 'v',
    currency: 'INR',
    personId: 'p-bala',
    direction: 'lent',
    amount: paise(50_000),
    reason: null,
    occurredOn: '2026-11-01' as DateKey,
    dueDate: null,
    role: 'owner',
    state: 'personal',
    transactionId: 'loan-tx',
    otherName: 'Bala',
    otherVpa: null,
    sharedWith: null,
    outstanding: paise(50_000),
    unrecorded: paise(50_000),
    payments: [],
    ...overrides,
  };
}

describe('isOpenIou', () => {
  it('needs money still owed, a person, and no pending or declined answer', () => {
    expect(isOpenIou(view({}))).toBe(true);
    expect(isOpenIou(view({ outstanding: paise(0) }))).toBe(false);
    expect(isOpenIou(view({ personId: null }))).toBe(false);
    expect(isOpenIou(view({ state: 'declined' }))).toBe(false);
    expect(isOpenIou(view({ state: 'awaiting_me' }))).toBe(false);
    expect(isOpenIou(view({ state: 'awaiting_them' }))).toBe(true);
  });
});

describe('repayments', () => {
  const on = '2026-11-05' as DateKey;

  it('money in repays a loan, money out repays a debt', () => {
    expect(repaymentDirection(100)).toBe('lent');
    expect(repaymentDirection(-100)).toBe('borrowed');
  });

  it('never repays a loan with the entry that made it, or before it was made', () => {
    expect(canRepay(view({}), on, 'other-tx')).toBe(true);
    expect(canRepay(view({}), on, 'loan-tx')).toBe(false);
    expect(canRepay(view({ occurredOn: '2026-11-06' as DateKey }), on, 'other-tx')).toBe(false);
    expect(canRepay(view({ occurredOn: on }), on, 'other-tx')).toBe(true);
  });

  it('offers each person whose open IOUs cover the amount, the likely one first', () => {
    const views = [
      view({ id: 'a', personId: 'p-bala', otherName: 'Bala', outstanding: paise(30_000) }),
      view({ id: 'b', personId: 'p-bala', otherName: 'Bala', outstanding: paise(30_000) }),
      view({ id: 'c', personId: 'p-chitra', otherName: 'Chitra', outstanding: paise(60_000) }),
      view({ id: 'd', personId: 'p-dev', otherName: 'Dev', outstanding: paise(10_000) }),
      view({ id: 'e', personId: 'p-esha', otherName: 'Esha', outstanding: paise(90_000), direction: 'borrowed' }),
    ];
    const entry = { transactionId: 'repay-tx', on, amount: paise(50_000), direction: 'lent' as const };
    expect(repaymentOptionsFor(views, entry, 'p-chitra')).toEqual([
      { personId: 'p-chitra', name: 'Chitra', outstanding: 60_000, likely: true },
      { personId: 'p-bala', name: 'Bala', outstanding: 60_000, likely: false },
    ]);
    expect(repaymentOptionsFor(views, entry, null).map((o) => o.name)).toEqual(['Bala', 'Chitra']);
  });

  it('leaves out the loan entry itself and loans made after the payment', () => {
    const views = [view({ transactionId: 'repay-tx' }), view({ id: 'later', occurredOn: '2026-11-09' as DateKey })];
    expect(repaymentOptionsFor(views, { transactionId: 'repay-tx', on, amount: paise(50_000), direction: 'lent' }, null)).toEqual([]);
  });

  it('guesses only when exactly one person has an IOU of exactly that amount', () => {
    const one = [view({ personId: 'p-bala' }), view({ id: 'x', personId: 'p-chitra', outstanding: paise(20_000) })];
    expect(guessRepayment(one, { transactionId: 't', on, ownAmount: 50_000 })).toEqual({ personId: 'p-bala', name: 'Bala' });
    expect(guessRepayment(one, { transactionId: 't', on, ownAmount: -50_000 })).toBeNull();
    const two = [view({ personId: 'p-bala' }), view({ id: 'y', personId: 'p-chitra', otherName: 'Chitra' })];
    expect(guessRepayment(two, { transactionId: 't', on, ownAmount: 50_000 })).toBeNull();
    const samePerson = [view({}), view({ id: 'z' })];
    expect(guessRepayment(samePerson, { transactionId: 't', on, ownAmount: 50_000 })).toEqual({ personId: 'p-bala', name: 'Bala' });
  });
});

describe('a repayment the other side recorded first (decision 0022)', () => {
  const theirs = [{ id: 'p1', iouId: 'iou-1', byMe: false, amount: paise(50_000), paidAt: '2026-11-03T10:00:00Z' }];

  it('shows settled, but leaves the amount open for matching this user\'s own payment', () => {
    const v = iouView(row({ counterpartyEmail: 'bala@example.com', amountPaise: 50_000 }), ASHA, personOf, theirs);
    expect(v.outstanding).toBe(0);
    expect(v.unrecorded).toBe(50_000);
    expect(isOpenIou(v)).toBe(false);
    expect(isOpenIou(forMatching([v])[0]!)).toBe(true);
  });
});
