import { parentKey } from '@money-plant/categoriser';
import type { CategoriseAnswer } from '../jobs/categorise';
import type { LabelledMerchant } from './dataset';

/** Confidence at or above which the app applies an AI answer without asking (decision 0012). */
export const APPLY_AT = 0.8;

export interface Score {
  model: string;
  merchants: number;
  /** Share of merchants where the key matched exactly. */
  exact: number;
  /** Share where the parent category matched (Food for Food > Lunch). */
  parent: number;
  /** Share answered with confidence ≥ APPLY_AT, which the app would apply. */
  applied: number;
  /** Of those applied, the share in the wrong parent category: the costly mistake. */
  appliedWrong: number;
  /** Share of all entries (not merchants) the model would apply correctly at APPLY_AT. */
  entriesRight: number;
  secondsPerMerchant: number;
}

export interface Miss {
  merchant: string;
  expected: string;
  answer: string;
  confidence: number;
}

const top = (key: string) => parentKey(key) ?? key;

export function score(model: string, set: readonly LabelledMerchant[], answers: readonly CategoriseAnswer[], seconds: number): { score: Score; misses: Miss[] } {
  const byMerchant = new Map(answers.map((a) => [a.merchant, a]));
  let exact = 0;
  let parent = 0;
  let applied = 0;
  let appliedWrong = 0;
  let entriesRight = 0;
  let entries = 0;
  const misses: Miss[] = [];
  for (const labelled of set) {
    const answer = byMerchant.get(labelled.item.merchant);
    const key = answer?.key ?? null;
    const confidence = answer?.confidence ?? 0;
    const parentRight = key !== null && top(key) === top(labelled.expected);
    entries += labelled.entries;
    if (key === labelled.expected) exact++;
    if (parentRight) parent++;
    if (key && confidence >= APPLY_AT) {
      applied++;
      if (!parentRight) appliedWrong++;
      else entriesRight += labelled.entries;
    }
    if (!parentRight) misses.push({ merchant: labelled.item.merchant, expected: labelled.expected, answer: key ?? 'unknown', confidence });
  }
  const n = set.length || 1;
  return {
    score: {
      model,
      merchants: set.length,
      exact: exact / n,
      parent: parent / n,
      applied: applied / n,
      appliedWrong: applied === 0 ? 0 : appliedWrong / applied,
      entriesRight: entries === 0 ? 0 : entriesRight / entries,
      secondsPerMerchant: set.length === 0 ? 0 : seconds / set.length,
    },
    misses: misses.sort((a, b) => b.confidence - a.confidence),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A Markdown table with no merchant names, safe to paste into a chat or PR. */
export function summaryTable(title: string, scores: readonly Score[]): string {
  const rows = scores.map(
    (s) =>
      `| ${s.model} | ${s.merchants} | ${pct(s.parent)} | ${pct(s.exact)} | ${pct(s.applied)} | ${pct(s.appliedWrong)} | ${pct(s.entriesRight)} | ${s.secondsPerMerchant.toFixed(1)} s |`,
  );
  return [
    `### ${title}`,
    '',
    `| Model | Merchants | Parent right | Exact | Applied (≥ ${APPLY_AT}) | Applied but wrong | Entries applied right | Time per merchant |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}
