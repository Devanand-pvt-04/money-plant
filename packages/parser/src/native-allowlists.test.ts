import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANK_SENDER_TOKENS, UPI_APP_PACKAGES } from './senders';

// The Android receiver filters messages before JavaScript runs, with its own copy of these lists.
const kotlin = readFileSync(
  join(import.meta.dirname, '../../../apps/mobile/modules/sms-reader/android/src/main/java/com/moneyplant/smsreader/Allowlists.kt'),
  'utf8',
);
const quoted = (block: string) => [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

describe('native allowlists', () => {
  it('match the bank sender tokens', () => {
    const block = /bankSenderTokens = listOf\(([^)]*)\)/.exec(kotlin)![1]!;
    expect(quoted(block)).toEqual([...BANK_SENDER_TOKENS]);
  });

  it('match the UPI app packages', () => {
    const block = /upiAppPackages = setOf\(([^)]*)\)/s.exec(kotlin)![1]!;
    expect(quoted(block).sort()).toEqual(Object.keys(UPI_APP_PACKAGES).sort());
  });
});
