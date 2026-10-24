import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts';
import { matchContact, type PhoneContact } from '@money-plant/matcher';

/**
 * SPL-4: the phone's contacts, read only on the phone. They are kept in
 * memory while the app runs and never stored, synced or sent anywhere; a
 * person only remembers which contact they are (person_contacts, local).
 */

let cache: PhoneContact[] | null = null;

export async function contactsAllowed(): Promise<boolean> {
  return (await getPermissionsAsync()).granted;
}

/** Asks for contacts access. Returns whether it was given. */
export async function allowContacts(): Promise<boolean> {
  const current = await getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await requestPermissionsAsync()).granted;
}

const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES] as const;

function toPhoneContact(c: { id: string; fullName?: string | null; phones?: readonly { number?: string | null }[] | null }): PhoneContact | null {
  const name = c.fullName?.trim();
  if (!name) return null;
  return { id: c.id, name, phones: (c.phones ?? []).map((p) => p.number ?? '').filter(Boolean) };
}

/** Every contact with a name, or none when access wasn't given. */
export async function loadContacts(): Promise<PhoneContact[]> {
  if (cache) return cache;
  if (!(await contactsAllowed())) return [];
  const all = await Contact.getAllDetails(FIELDS);
  cache = all.map(toPhoneContact).filter((c): c is PhoneContact => c !== null);
  return cache;
}

/** The phone's own contact picker. Null when the user backs out. */
export async function pickContact(): Promise<PhoneContact | null> {
  if (!(await allowContacts())) throw new Error('Allow contacts in Android settings to pick from them');
  const picked = await Contact.presentPicker();
  if (!picked) return null;
  return toPhoneContact({ ...(await picked.getDetails(FIELDS)), id: picked.id });
}

/** The contact a payee probably is, by the mobile number in their UPI ID or a name only one contact fits. */
export async function suggestContact(payee: { vpa: string | null; name: string | null }): Promise<PhoneContact | null> {
  return matchContact(payee, await loadContacts());
}

export async function contactById(id: string): Promise<PhoneContact | null> {
  return (await loadContacts()).find((c) => c.id === id) ?? null;
}
