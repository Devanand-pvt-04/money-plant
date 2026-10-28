/**
 * The speed log (decision 0011, speed pass): how long each screen's data
 * takes to load on this phone, kept in memory since the app started. Only
 * labels and milliseconds, never data.
 */

export interface Timing {
  label: string;
  ms: number;
}

const MAX = 500;
const timings: Timing[] = [];
/** When the app's JavaScript started, to time Home's first data. */
const startedAt = Date.now();
let firstLoadMs: number | null = null;

export function record(label: string, ms: number): void {
  timings.push({ label, ms });
  if (timings.length > MAX) timings.shift();
}

/** Runs `work` and records how long it took under `label`. */
export async function timed<T>(label: string, work: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await work();
  } finally {
    const end = Date.now();
    record(label, end - start);
    if (label === 'home') firstLoadMs ??= end - startedAt;
  }
}

export interface TimingSummary {
  label: string;
  count: number;
  median: number;
  slowest: number;
}

/** Per label, slowest first. */
export function speedLog(): { firstLoadMs: number | null; rows: TimingSummary[] } {
  const byLabel = new Map<string, number[]>();
  for (const t of timings) {
    const list = byLabel.get(t.label) ?? [];
    list.push(t.ms);
    byLabel.set(t.label, list);
  }
  const rows = [...byLabel].map(([label, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    return { label, count: sorted.length, median: sorted[Math.floor(sorted.length / 2)]!, slowest: sorted[sorted.length - 1]! };
  });
  return { firstLoadMs, rows: rows.sort((a, b) => b.median - a.median) };
}
