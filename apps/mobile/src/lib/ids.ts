import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error('Not signed in');
  return userId;
}

/**
 * A UUID derived from the user id and a name. Rows that every device of the
 * same user may create on its own (system and default categories, budgets)
 * use one, so two phones write the same row instead of duplicates.
 */
export async function derivedId(name: string): Promise<string> {
  const userId = await currentUserId();
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${userId}:${name}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
