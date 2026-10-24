import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePreDebit } from './predebit';
import { parseSms } from './sms';

interface FixtureCase {
  sender: string;
  body: string;
  expect: Record<string, unknown>;
}

/** Fixtures are dated around this day. */
const FIXTURE_NOW = new Date(2026, 9, 23, 10, 0);

const root = join(import.meta.dirname, '..', 'fixtures');

for (const bank of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  for (const file of readdirSync(join(root, bank.name)).filter((name) => name.endsWith('.json'))) {
    const { cases } = JSON.parse(readFileSync(join(root, bank.name, file), 'utf8')) as { cases: FixtureCase[] };
    describe(`${bank.name}/${file}`, () => {
      it.each(cases.map((c, i) => [i, c] as const))('case %i', (_i, fixture) => {
        const result = parseSms({ sender: fixture.sender, body: fixture.body });
        const { status = 'parsed', preDebit, ...fields } = fixture.expect;
        expect(result.status).toBe(status);
        if (result.status === 'parsed') expect(result.transaction).toMatchObject(fields);
        // REC-1: pre-debit notices are not transactions, but they name an upcoming autopay.
        const notice = parsePreDebit({ sender: fixture.sender, body: fixture.body }, FIXTURE_NOW);
        if (preDebit) expect(notice).toMatchObject(preDebit as object);
        else expect(notice).toBeNull();
      });
    });
  }
}
