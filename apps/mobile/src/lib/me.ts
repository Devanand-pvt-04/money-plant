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
}

export async function getMe(): Promise<Me> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new Error('Not signed in');
  const meta = (user.user_metadata ?? {}) as { name?: unknown; vpa?: unknown };
  return {
    id: user.id,
    email: user.email?.toLowerCase() ?? null,
    name: typeof meta.name === 'string' && meta.name ? meta.name : null,
    vpa: typeof meta.vpa === 'string' && meta.vpa ? meta.vpa : null,
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

/** Needs the network: the metadata lives on the server. */
export async function updateMe(changes: { name: string | null; vpa: string | null }): Promise<void> {
  const vpa = changes.vpa?.trim().toLowerCase() || null;
  if (vpa && !isVpa(vpa)) throw new Error('Enter a UPI ID like name@okaxis');
  const { error } = await supabase.auth.updateUser({ data: { name: changes.name?.trim() || null, vpa } });
  if (error) throw error;
}
