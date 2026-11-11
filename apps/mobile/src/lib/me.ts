import { mobileDigits } from '@money-plant/matcher';
import { supabase } from './supabase';

/**
 * The signed-in user as friends see them on shared IOUs (IOU-2) and in pay
 * links (IOU-3): a display name and their own UPI ID. Kept in the Supabase
 * user's metadata, so every device of the user has it.
 */
export interface Me {
  id: string;
  email: string | null;
  name: string | null;
  vpa: string | null;
  /** The user's other UPI IDs, so friends recognise payments from them too (decision 0021). */
  extraVpas: string[];
  /** The user's 10-digit mobile number, shared with friends for the same reason. */
  phone: string | null;
}

export async function getMe(): Promise<Me> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error('Not signed in');
  const meta = (user.user_metadata ?? {}) as { name?: unknown; vpa?: unknown; extra_vpas?: unknown; phone?: unknown };
  return {
    id: user.id,
    email: user.email?.toLowerCase() ?? null,
    name: typeof meta.name === 'string' && meta.name ? meta.name : null,
    vpa: typeof meta.vpa === 'string' && meta.vpa ? meta.vpa : null,
    extraVpas: Array.isArray(meta.extra_vpas) ? meta.extra_vpas.filter((v): v is string => typeof v === 'string') : [],
    phone: typeof meta.phone === 'string' && /^[6-9]\d{9}$/.test(meta.phone) ? meta.phone : null,
  };
}

/** A name for the user on a friend's phone: their name, or the part of their email before @. */
export function displayName(me: Me): string {
  return me.name ?? me.email?.split('@')[0] ?? 'A friend';
}

const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

export function isVpa(text: string): boolean {
  return VPA.test(text.trim());
}

/** UPI IDs typed into one field, separated by commas, spaces or new lines (decision 0021). */
export function splitVpas(text: string): string[] {
  return text.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
}

/** Needs the network: the metadata lives on the server. */
export async function updateMe(changes: { name: string | null; vpa: string | null; extraVpas?: readonly string[]; phone?: string | null }): Promise<void> {
  const vpa = changes.vpa?.trim().toLowerCase() || null;
  if (vpa && !isVpa(vpa)) throw new Error('Enter a UPI ID like name@okaxis');
  const extras: string[] = [];
  for (const raw of changes.extraVpas ?? []) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (!isVpa(v)) throw new Error(`${raw.trim()} isn't a UPI ID like name@okaxis`);
    if (v !== vpa && !extras.includes(v)) extras.push(v);
  }
  if (extras.length > 10) throw new Error('You can add up to 10 other UPI IDs');
  let phone: string | null | undefined;
  if (changes.phone !== undefined) {
    phone = changes.phone?.trim() ? mobileDigits(changes.phone) : null;
    if (changes.phone?.trim() && !phone) throw new Error('Enter a 10-digit mobile number');
  }
  const data = {
    name: changes.name?.trim() || null,
    vpa,
    ...(changes.extraVpas !== undefined ? { extra_vpas: extras } : {}),
    ...(phone !== undefined ? { phone } : {}),
  };
  const { error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
}
