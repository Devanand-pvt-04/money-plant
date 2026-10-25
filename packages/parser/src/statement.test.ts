import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStatementRow, type StatementRowInput } from './statement';
import type { BankId } from './types';

const root = join(import.meta.dirname, '..', 'fixtures');

// CAP-5: one fixture file of anonymised statement rows per bank, in fixtures/<bank>/statement/.
for (const bank of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const dir = join(root, bank.name, 'statement');
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
      bank: BankId;
      cases: { row: StatementRowInput; expect: Record<string, unknown> | null }[];
    };
    describe(`${bank.name}/statement/${file}`, () => {
      it.each(fixture.cases.map((c, i) => [i, c] as const))('case %i', (_i, { row, expect: expected }) => {
        const parsed = parseStatementRow(fixture.bank, row);
        if (expected === null) expect(parsed).toBeNull();
        else expect(parsed).toMatchObject({ bank: fixture.bank, date: row.date, ...expected });
      });
    });
  }
}
