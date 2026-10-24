import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { displayName, getMe, type Me } from '@/lib/me';
import { supabase } from '@/lib/supabase';
import { colors } from './ui';

/** The user's initial on a round tile, for the Home header and settings. */
export function Avatar({ me, size = 40 }: { me: Me | null; size?: number }) {
  const letter = me ? displayName(me).trim().charAt(0).toUpperCase() : '';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {letter ? <Text style={[styles.text, { fontSize: size * 0.4 }]}>{letter}</Text> : <Feather name="user" size={size * 0.45} color={colors.primary} />}
    </View>
  );
}

/**
 * The signed-in user. Read again whenever the session changes, including
 * right after the name or UPI ID is saved, so screens that stay open (Home
 * behind the profile screen) show the new name at once.
 */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    const load = () => void getMe().then(setMe, () => setMe(null));
    load();
    // Deferred: supabase-js can deadlock when its own methods are called inside this callback.
    const { data } = supabase.auth.onAuthStateChange(() => void setTimeout(load, 0));
    return () => data.subscription.unsubscribe();
  }, []);
  return me;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700', color: colors.primary },
});
