import { mobileFromVpa } from './contacts';

/** Finding the person a payment was to or from by its payee (decisions 0021, 0025). */

export interface PersonRef {
  id: string;
  name: string;
  /** The UPI ID to pay them. */
  vpa: string | null;
  /** Their other UPI IDs, only for recognising payments (decision 0021). */
  extraVpas?: readonly string[];
  /** Their 10-digit mobile number: a UPI ID made from it (98xxxxxx10@ybl) is theirs (decision 0021). */
  phone?: string | null;
}

/** Every UPI ID a person is known by, lower case: the main one first. */
export const allVpas = (p: Pick<PersonRef, 'vpa' | 'extraVpas'>): string[] =>
  [...new Set([p.vpa, ...(p.extraVpas ?? [])].filter((v): v is string => Boolean(v)).map((v) => v.trim().toLowerCase()))];

/** A payee or person name in one form: lower case letters and single spaces. */
export const payeeKey = (name: string) => name.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const normaliseName = payeeKey;

/**
 * The user's person account a payment was to or from: one of their UPI IDs, the mobile number in the UPI ID, a name
 * the user linked to them before (`aliases`, payeeKey to person id), or the
 * same name.
 */
export function findPerson<T extends PersonRef>(
  people: readonly T[],
  payee: { vpa: string | null; name: string | null },
  aliases: ReadonlyMap<string, string> = new Map(),
): T | null {
  if (payee.vpa) {
    const vpa = payee.vpa.toLowerCase();
    const byVpa = people.find((p) => allVpas(p).includes(vpa));
    if (byVpa) return byVpa;
    const mobile = mobileFromVpa(vpa);
    const byPhone = mobile ? people.filter((p) => p.phone === mobile) : [];
    if (byPhone.length === 1) return byPhone[0]!;
  }
  if (!payee.name) return null;
  const name = normaliseName(payee.name);
  if (!name) return null;
  const aliased = aliases.get(name);
  const byAlias = aliased ? people.find((p) => p.id === aliased) : undefined;
  if (byAlias) return byAlias;
  const byName = people.filter((p) => normaliseName(p.name) === name);
  return byName.length === 1 ? byName[0]! : null;
}
