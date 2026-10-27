import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { LOCK_AFTER_MS, lockAvailable, lockEnabled, unlock } from '@/lib/lock';
import { Button, colors } from './ui';

/** Whether the lock applies right now: switched on, and the phone has something to unlock with. */
async function shouldLock(): Promise<boolean> {
  return (await lockEnabled()) && (await lockAvailable());
}

/**
 * ACC-2: covers the whole app until the user unlocks it, when it opens and
 * when it comes back after a minute in the background. It sits over the
 * screens instead of replacing them, so where the user was is kept.
 */
export function AppLock({ active }: { active: boolean }) {
  // null while checking: the cover stays up, so no amount shows before the check.
  const [locked, setLocked] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const prompting = useRef(false);
  const backgroundAt = useRef<number | null>(null);

  const ask = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setMessage(null);
    const result = await unlock();
    prompting.current = false;
    if (result === 'unlocked' || result === 'unavailable') setLocked(false);
    else if (result === 'failed') setMessage("That didn't work. Try again.");
  }, []);

  const lockIfNeeded = useCallback(async () => {
    if (!(await shouldLock())) {
      setLocked(false);
      return;
    }
    setLocked(true);
    void ask();
  }, [ask]);

  // Locks when the app starts signed in. Signing in just now proved who it is, so that doesn't lock.
  const startedActive = useRef(active);
  useEffect(() => {
    if (!active) return;
    if (startedActive.current) void lockIfNeeded();
    else setLocked(false);
  }, [active, lockIfNeeded]);

  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundAt.current ??= Date.now();
      } else if (state === 'active') {
        const since = backgroundAt.current;
        backgroundAt.current = null;
        if (since !== null && Date.now() - since >= LOCK_AFTER_MS && !prompting.current) void lockIfNeeded();
      }
    });
    return () => subscription.remove();
  }, [active, lockIfNeeded]);

  // Back on the lock screen leaves the app instead of moving the screens behind it.
  const covering = active && locked !== false;
  useEffect(() => {
    if (!covering) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, [covering]);

  if (!covering) return null;
  return (
    <View style={styles.cover} accessibilityViewIsModal>
      <Feather name="lock" size={32} color={colors.muted} />
      <Text style={styles.title}>Money Plant is locked</Text>
      <Text style={styles.hint}>Use your fingerprint or your phone's screen lock.</Text>
      {message && <Text style={styles.hint}>{message}</Text>}
      {locked && (
        <View style={styles.action}>
          <Button title="Unlock" onPress={ask} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
    backgroundColor: colors.background,
    zIndex: 100,
    elevation: 100,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 8 },
  hint: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  action: { alignSelf: 'stretch', marginTop: 20 },
});
