import { mobileDigits, mobileFromVpa } from './contacts';

/**
 * Decision 0025: who a person is. A person is one record with any number of
 * identifiers; every payment is matched to a person through them.
 *
 * - Strong identifiers (UPI ID, mobile number, a bank account with its bank)
 *   belong to at most one person, so a match on one is certain.
 * - Weak identifiers (a payee name, a bank account known only by its last
 *   digits) only suggest, unless exactly one person has learned that name.
 */

export type IdentifierKind = 'upi' | 'phone' | 'bank_account' | 'payee_name';

/** Where an identifier came from: typed by the user, learned from a tagged payment, a friend's own profile, or a phone contact. */
export type IdentifierSource = 'typed' | 'learned' | 'friend' | 'contact';

export interface Identifier {
  kind: IdentifierKind;
  /** Normalised: lower-case UPI ID, 10-digit mobile, account digits, or a payeeKey name. */
  value: string;
  /** For a bank account, the bank in lower case ("hdfc"); otherwise a display note. */
  label?: string | null;
  source?: IdentifierSource;
}

export interface IdentifiedPerson {
  id: string;
  name: string;
  identifiers: readonly Identifier[];
}

/** What a payment says about the other side. */
export interface Payee {
  vpa: string | null;
  name: string | null;
  /** The other side's bank account, when the message or statement prints it. */
  account?: { digits: string; bank?: string | null } | null;
}

const VPA = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/;

/** A payee or person name in one form: lower case letters and single spaces. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The bank part of a label in one form ("HDFC Bank" -> "hdfc"). */
export const bankKey = (bank: string | null | undefined): string | null => {
  const key = (bank ?? '').toLowerCase().replace(/\bbank\b/g, '').replace(/[^a-z]+/g, '');
  return key.length >= 2 ? key.slice(0, 20) : null;
};

/** An identifier in its stored form, or null when the value isn't one of that kind. */
export function normaliseIdentifier(kind: IdentifierKind, raw: string, label?: string | null): Identifier | null {
  const text = raw.trim();
  switch (kind) {
    case 'upi': {
      const v = text.toLowerCase();
      return VPA.test(v) && v.length <= 323 ? { kind, value: v } : null;
    }
    case 'phone': {
      const v = mobileDigits(text);
      return v ? { kind, value: v } : null;
    }
    case 'bank_account': {
      const v = text.replace(/[\s-]/g, '').replace(/^[xX*]+/, '');
      return /^\d{3,18}$/.test(v) ? { kind, value: v, label: bankKey(label) } : null;
    }
    case 'payee_name': {
      const v = nameKey(text);
      return v.length >= 2 && v.length <= 80 ? { kind, value: v } : null;
    }
  }
}

/** A bank account is strong only with its bank and at least 4 digits; last digits alone are shared by many accounts. */
export function isStrong(id: Identifier): boolean {
  if (id.kind === 'upi' || id.kind === 'phone') return true;
  if (id.kind === 'bank_account') return Boolean(id.label) && id.value.length >= 4;
  return false;
}

/** Two account numbers are the same when one ends with the other (statements print the last 4, profiles may hold more). */
const sameDigits = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a.endsWith(b) || b.endsWith(a));

/**
 * Whether two identifiers name the same thing. A mobile number also matches
 * a UPI ID made from it (98xxxxxx10@ybl). Bank accounts match on digits and,
 * when both know it, the same bank.
 */
export function sameIdentifier(a: Identifier, b: Identifier): boolean {
  if (a.kind === 'phone' && b.kind === 'upi') return mobileFromVpa(b.value) === a.value;
  if (a.kind === 'upi' && b.kind === 'phone') return mobileFromVpa(a.value) === b.value;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'bank_account') return sameDigits(a.value, b.value) && (!a.label || !b.label || a.label === b.label);
  return a.value === b.value;
}

/** Whether a match on these two is certain: both strong, and for bank accounts the same bank on both. */
function certain(a: Identifier, b: Identifier): boolean {
  if (a.kind === 'bank_account' || b.kind === 'bank_account') return isStrong(a) && isStrong(b) && a.label === b.label;
  return isStrong(a) && isStrong(b);
}

/** The identifiers a payment carries, ready to learn when the user says who it was. */
export function payeeIdentifiers(payee: Payee): Identifier[] {
  const out: Identifier[] = [];
  const push = (id: Identifier | null) => {
    if (id && !out.some((o) => o.kind === id.kind && o.value === id.value)) out.push({ ...id, source: 'learned' });
  };
  if (payee.vpa) {
    push(normaliseIdentifier('upi', payee.vpa));
    const mobile = mobileFromVpa(payee.vpa.toLowerCase());
    if (mobile) push(normaliseIdentifier('phone', mobile));
  }
  if (payee.account) push(normaliseIdentifier('bank_account', payee.account.digits, payee.account.bank));
  if (payee.name) push(normaliseIdentifier('payee_name', payee.name));
  return out;
}

export type MatchStrength =
  /** A strong identifier: certain. */
  | 'strong'
  /** The one person who has learned this exact payee name: safe to use. */
  | 'learned'
  /** A weak hint (the person's own name, or account digits without a bank): ask the user. */
  | 'suggested';

export interface PayeeMatch<T> {
  person: T;
  strength: MatchStrength;
  via: IdentifierKind | 'name';
}

/**
 * Decision 0025 matching: a strong identifier first (exactly one person), then
 * a payee name exactly one person has learned, then weak hints. Never picks
 * between two people silently: two candidates at the same level are no match.
 */
export function matchPayee<T extends IdentifiedPerson>(people: readonly T[], payee: Payee): PayeeMatch<T> | null {
  const ids = payeeIdentifiers(payee);
  const strongIds = ids.filter((i) => i.kind !== 'payee_name');

  const certainHits = unique(people.filter((p) => strongIds.some((i) => p.identifiers.some((own) => sameIdentifier(own, i) && certain(own, i)))));
  if (certainHits.length === 1) {
    const person = certainHits[0]!;
    const via = strongIds.find((i) => person.identifiers.some((own) => sameIdentifier(own, i) && certain(own, i)))!.kind;
    return { person, strength: 'strong', via };
  }
  if (certainHits.length > 1) return null;

  const name = ids.find((i) => i.kind === 'payee_name');
  if (name) {
    const learned = people.filter((p) => p.identifiers.some((own) => own.kind === 'payee_name' && own.value === name.value));
    if (learned.length === 1) return { person: learned[0]!, strength: 'learned', via: 'payee_name' };
    if (learned.length > 1) return null;
  }

  const weakAccount = strongIds.filter((i) => i.kind === 'bank_account');
  const accountHits = unique(people.filter((p) => weakAccount.some((i) => p.identifiers.some((own) => sameIdentifier(own, i)))));
  if (accountHits.length === 1) return { person: accountHits[0]!, strength: 'suggested', via: 'bank_account' };

  if (name) {
    const byName = people.filter((p) => nameKey(p.name) === name.value);
    if (byName.length === 1) return { person: byName[0]!, strength: 'suggested', via: 'name' };
  }
  return null;
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/**
 * The other people who already have one of these strong identifiers. Saving
 * or learning one of them never makes a second person: the app asks to merge.
 */
export function identifierClashes<T extends IdentifiedPerson>(
  people: readonly T[],
  self: string | null,
  ids: readonly Identifier[],
): { person: T; identifier: Identifier }[] {
  const out: { person: T; identifier: Identifier }[] = [];
  for (const id of ids) {
    if (!isStrong(id)) continue;
    for (const p of people) {
      if (p.id === self) continue;
      if (p.identifiers.some((own) => sameIdentifier(own, id) && certain(own, id)) && !out.some((o) => o.person.id === p.id)) {
        out.push({ person: p, identifier: id });
      }
    }
  }
  return out;
}

/** Whether a payment is to or from the user themselves: one of their own strong identifiers. */
export function isSelfPayee(mine: readonly Identifier[], payee: Payee): boolean {
  const ids = payeeIdentifiers(payee).filter((i) => i.kind !== 'payee_name');
  return ids.some((i) => mine.some((own) => sameIdentifier(own, i) && certain(own, i)));
}

/** Adds identifiers to a list, skipping ones it already has. */
export function mergeIdentifiers(into: readonly Identifier[], add: readonly Identifier[]): Identifier[] {
  const out = [...into];
  for (const id of add) if (!out.some((o) => o.kind === id.kind && o.value === id.value && (o.label ?? null) === (id.label ?? null))) out.push(id);
  return out;
}
