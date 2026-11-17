/**
 * Whole percentages of `values` that always add up to 100 (largest
 * remainder): each value gets its rounded-down share, then the points left
 * over go to the values with the biggest remainders. Zero and negative values
 * get 0 and don't count towards the total. All zeros gives all zeros.
 */
export function wholePercents(values: readonly number[]): number[] {
  const parts = values.map((v) => (v > 0 ? v : 0));
  const total = parts.reduce((s, v) => s + v, 0);
  if (total <= 0) return parts.map(() => 0);
  const shares = parts.map((v, i) => {
    const exact = (v * 100) / total;
    const whole = Math.floor(exact);
    return { i, whole, rest: exact - whole };
  });
  let left = 100 - shares.reduce((s, p) => s + p.whole, 0);
  for (const p of [...shares].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (left <= 0) break;
    if (p.rest > 0) {
      p.whole += 1;
      left -= 1;
    }
  }
  return shares.map((p) => p.whole);
}

/** "15%", or "<1%" for a share too small to round up to one point. */
export const percentLabel = (value: number, percent: number): string => (value > 0 && percent === 0 ? '<1%' : `${percent}%`);
