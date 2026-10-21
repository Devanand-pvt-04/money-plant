import { describe, expect, it } from 'vitest';
import { fromRemoteAccount, nextCursor, toRemoteAccount, type RemoteAccount } from './remote';

const remote: RemoteAccount = {
  id: '6f1c2a3e-0000-4000-8000-000000000001',
  user_id: 'user-1',
  type: 'bank',
  name: 'HDFC savings',
  institution: 'HDFC Bank',
  last4: '1234',
  currency: 'INR',
  opening_balance_paise: 1250000,
  created_at: '2026-10-21T10:00:00.000Z',
  updated_at: '2026-10-21T10:05:00.000Z',
  deleted_at: null,
};

describe('account mapping', () => {
  it('round-trips through the local shape without server-owned fields', () => {
    const local = fromRemoteAccount(remote);
    expect(local.dirty).toBe(0);
    expect(local.openingBalancePaise).toBe(1250000);
    const write = toRemoteAccount(local);
    expect(write).not.toHaveProperty('user_id');
    expect(write).not.toHaveProperty('updated_at');
    expect(write.name).toBe('HDFC savings');
  });

  it('accepts bigint columns returned as strings', () => {
    const local = fromRemoteAccount({
      ...remote,
      opening_balance_paise: '900' as unknown as number,
    });
    expect(local.openingBalancePaise).toBe(900);
  });
});

describe('nextCursor', () => {
  it('keeps the latest timestamp', () => {
    const rows = [
      { ...remote, updated_at: '2026-10-21T10:05:00.000Z' },
      { ...remote, updated_at: '2026-10-21T11:00:00+00:00' },
      { ...remote, updated_at: '2026-10-21T09:00:00.000Z' },
    ];
    expect(nextCursor(rows, '2026-10-20T00:00:00.000Z')).toBe('2026-10-21T11:00:00+00:00');
  });

  it('keeps the previous cursor when nothing is newer', () => {
    expect(nextCursor([], '2026-10-20T00:00:00.000Z')).toBe('2026-10-20T00:00:00.000Z');
    expect(nextCursor([], null)).toBeNull();
  });
});
