import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { displayName, getMe, type Me } from '@/lib/me';
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

/** The signed-in user, read from the local session once per mount. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    getMe().then(setMe, () => setMe(null));
  }, []);
  return me;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700', color: colors.primary },
});
