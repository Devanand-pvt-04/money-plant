import { lookupBuiltin, normaliseMerchant } from './dictionary';

/** One shop or payee, however its name was spelled in each message. */
export interface Place {
  key: string;
  name: string;
}

/**
 * Dictionary names that stand for a kind of place, not one shop ("Fuel" covers
 * every petrol pump). Places are never merged under these.
 */
const GENERIC = new Set([
  'Cafe', 'Cab', 'Metro', 'Fuel', 'Flight', 'Travel booking', 'Hotel', 'Clothing', 'Electronics', 'Home', 'Rent',
  'Broadband', 'DTH', 'Electricity', 'Gas', 'Water', 'Streaming', 'Subscription', 'Movies', 'Pharmacy', 'Doctor',
  'Fitness', 'Insurance', 'Broker', 'SIP', 'EMI', 'Taxes', 'Cash withdrawal', 'Education', 'Salary', 'Interest', 'Refund',
]);

/** Shorter names than this never absorb longer ones ("ab" would swallow too much). */
const MIN_ROOT = 4;

const UNKNOWN: Place = { key: 'unknown', name: 'Unknown' };

/**
 * BUD-3 (decision 0038): groups payee names that are the same shop, so
 * "AMAZON PAY INDI", "AMAZON PAY IN E", "Amazon India" and "AMAZON" count as
 * one "Amazon". A shop the built-in dictionary knows by name takes that name.
 * Otherwise names group when, cleaned and without spaces, one starts with the
 * other (at least 4 letters), and the group takes its most used spelling.
 * There is no guessing at misspellings ("Google Pay" is not "Google Play").
 */
export function groupPlaces(labels: readonly (string | null)[]): (label: string | null) => Place {
  const clean = (label: string | null) => label?.replace(/\s+/g, ' ').trim() || null;
  const keyOf = new Map<string, string>();
  const brands = new Map<string, string>();
  for (const raw of labels) {
    const label = clean(raw);
    if (!label || keyOf.has(label)) continue;
    const found = lookupBuiltin(label, null);
    if (found && !GENERIC.has(found.name)) {
      keyOf.set(label, `brand:${found.name}`);
      brands.set(`brand:${found.name}`, found.name);
    } else {
      keyOf.set(label, normaliseMerchant(label).replace(/[^a-z0-9]/g, '') || label.toLowerCase());
    }
  }

  // The shortest name a longer one starts with becomes the group.
  const roots = [...new Set(keyOf.values())].filter((k) => !brands.has(k)).sort((a, b) => a.length - b.length);
  const rootOf = new Map<string, string>();
  for (const key of roots) {
    const root = roots.find((r) => r.length >= MIN_ROOT && r.length < key.length && key.startsWith(r));
    rootOf.set(key, root ?? key);
  }
  const groupOf = (label: string) => {
    const key = keyOf.get(label)!;
    return rootOf.get(key) ?? key;
  };

  // A group's name: the spelling seen most often, the shorter one on a tie.
  const counts = new Map<string, Map<string, number>>();
  for (const raw of labels) {
    const label = clean(raw);
    if (!label) continue;
    const group = groupOf(label);
    const spellings = counts.get(group) ?? new Map<string, number>();
    spellings.set(label, (spellings.get(label) ?? 0) + 1);
    counts.set(group, spellings);
  }
  const names = new Map<string, string>();
  for (const [group, spellings] of counts) {
    const best = [...spellings].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0];
    names.set(group, brands.get(group) ?? best);
  }

  return (raw) => {
    const label = clean(raw);
    if (!label) return UNKNOWN;
    const key = keyOf.has(label) ? groupOf(label) : normaliseMerchant(label).replace(/[^a-z0-9]/g, '') || label.toLowerCase();
    return { key, name: names.get(key) ?? label };
  };
}
