import { mobileFromVpa } from './contacts';
import { allVpas, payeeKey } from './ious';

/**
 * Decision 0020: telling when two of the user's people are the same person,
 * and which one a merge keeps.
 */

export interface PersonFacts {
  id: string;
  name: string;
  vpa: string | null;
  email: string | null;
  extraVpas?: readonly string[];
  phone?: string | null;
}

export type DuplicateReason = 'email' | 'vpa' | 'phone' | 'name';

export interface DuplicatePair {
  /** The person a merge keeps: the one linked on Money Plant (has an email), else the first. */
  keep: string;
  /** The person a merge folds in and removes. */
  remove: string;
  reason: DuplicateReason;
}

const lower = (s: string | null) => s?.trim().toLowerCase() || null;

/** The other person who already has this email or one of these UPI IDs, if any. */
export function clashingPerson<T extends PersonFacts>(
  people: readonly T[],
  self: string | null,
  fields: { email: string | null; vpa: string | null; extraVpas?: readonly string[]; phone?: string | null },
): { person: T; field: 'email' | 'vpa' | 'phone'; value: string } | null {
  const email = lower(fields.email);
  const vpas = allVpas(fields);
  for (const p of people) {
    if (p.id === self) continue;
    if (email && lower(p.email) === email) return { person: p, field: 'email', value: email };
  }
  for (const p of people) {
    if (p.id === self) continue;
    const theirs = allVpas(p);
    const shared = vpas.find((v) => theirs.includes(v));
    if (shared) return { person: p, field: 'vpa', value: shared };
  }
  for (const p of people) {
    if (p.id === self) continue;
    if (fields.phone && p.phone === fields.phone) return { person: p, field: 'phone', value: fields.phone };
  }
  return null;
}

/**
 * Which of two people a merge keeps. Two different emails are two different
 * Money Plant members, so they can't be merged (null).
 */
export function mergeDirection<T extends PersonFacts>(a: T, b: T): { keep: T; remove: T } | null {
  const ea = lower(a.email);
  const eb = lower(b.email);
  if (ea && eb && ea !== eb) return null;
  if (eb && !ea) return { keep: b, remove: a };
  return { keep: a, remove: b };
}

/**
 * Pairs of people that are probably one person: the same email, the same UPI
 * ID, or the same name where one of them has no email (a contact added before
 * the friend joined). Pairs in `dismissed` ("a|b" with ids sorted) are left out.
 */
export function findDuplicatePeople(people: readonly PersonFacts[], dismissed: ReadonlySet<string> = new Set()): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i]!;
      const b = people[j]!;
      const key = pairKey(a.id, b.id);
      if (seen.has(key) || dismissed.has(key)) continue;
      const direction = mergeDirection(a, b);
      if (!direction) continue;
      const reason: DuplicateReason | null =
        lower(a.email) && lower(a.email) === lower(b.email)
          ? 'email'
          : allVpas(a).some((v) => allVpas(b).includes(v))
            ? 'vpa'
            : samePhone(a, b)
              ? 'phone'
              : (!lower(a.email) || !lower(b.email)) && payeeKey(a.name) !== '' && payeeKey(a.name) === payeeKey(b.name)
              ? 'name'
              : null;
      if (!reason) continue;
      seen.add(key);
      pairs.push({ keep: direction.keep.id, remove: direction.remove.id, reason });
    }
  }
  return pairs;
}

/** The same mobile number, or one's number inside the other's UPI ID (98xxxxxx10@ybl). */
function samePhone(a: PersonFacts, b: PersonFacts): boolean {
  const phones = (p: PersonFacts) => new Set([p.phone, ...allVpas(p).map(mobileFromVpa)].filter((v): v is string => Boolean(v)));
  const pa = phones(a);
  return [...phones(b)].some((v) => pa.has(v)) && Boolean(a.phone || b.phone);
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
