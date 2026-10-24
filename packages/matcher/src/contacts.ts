/**
 * SPL-4: matching a payee to the phone's contacts. Runs only on the phone;
 * contacts are passed in and never stored or synced.
 */
export interface PhoneContact {
  id: string;
  name: string;
  /** As stored in the address book: "+91 98765 43210", "098765-43210". */
  phones: readonly string[];
}

/** The 10-digit Indian mobile number in a phone number, or null. */
export function mobileDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}

/** "9876543210@ybl" and "9876543210-2@axl" carry the payee's mobile number. */
export function mobileFromVpa(vpa: string | null): string | null {
  const match = vpa ? /^(?:91)?([6-9]\d{9})(?:-\d+)?@/.exec(vpa) : null;
  return match ? match[1]! : null;
}

const tokens = (name: string) => name.toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Finds the contact a payee is: by the mobile number in the UPI ID first,
 * then by name. "RAVI K" matches "Ravi Kumar" (same first name, every other
 * word a prefix), but only when exactly one contact fits.
 */
export function matchContact<T extends PhoneContact>(payee: { vpa: string | null; name: string | null }, contacts: readonly T[]): T | null {
  const mobile = mobileFromVpa(payee.vpa);
  if (mobile) {
    const byPhone = contacts.filter((c) => c.phones.some((p) => mobileDigits(p) === mobile));
    if (byPhone.length === 1) return byPhone[0]!;
  }
  const words = payee.name ? tokens(payee.name) : [];
  if (words.length === 0) return null;
  const fits = contacts.filter((c) => {
    const theirs = tokens(c.name);
    if (theirs.length === 0 || theirs[0] !== words[0]) return false;
    if (words.length === 1) return theirs.length === 1;
    return words.slice(1).every((w) => theirs.slice(1).some((t) => t.startsWith(w)));
  });
  return fits.length === 1 ? fits[0]! : null;
}
