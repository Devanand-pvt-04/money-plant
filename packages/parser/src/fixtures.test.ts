import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSms } from './sms';

interface FixtureCase {
  sender: string;
  body: string;
  expect: Record<string, unknown>;
}

const root = join(import.meta.dirname, '..', 'fixtures');

for (const bank of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  for (const file of readdirSync(join(root, bank.name)).filter((name) => name.endsWith('.json'))) {
    const { cases } = JSON.parse(readFileSync(join(root, bank.name, file), 'utf8')) as { cases: FixtureCase[] };
    describe(`${bank.name}/${file}`, () => {
      it.each(cases.map((c, i) => [i, c] as const))('case %i', (_i, fixture) => {
        const result = parseSms({ sender: fixture.sender, body: fixture.body });
        const { status = 'parsed', ...fields } = fixture.expect;
        expect(result.status).toBe(status);
        if (result.status === 'parsed') expect(result.transaction).toMatchObject(fields);
      });
    });
  }
}
