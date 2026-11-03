import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/components/ui';
import { fetchLatestUpdate, restartToUpdate, updatesOn } from '@/lib/updates';

/** Clears the tab bar, so the banner never covers the tabs. */
const TAB_BAR = 64;

/**
 * Checks for an update when the app opens or comes back, downloads it, and
 * offers a restart, instead of the update waiting for the next cold start.
 * "Later" hides it until another update arrives; the update still applies on
 * the next start.
 */
export function UpdateBanner() {
  const { isUpdatePending, downloadedUpdate, isRestarting } = Updates.useUpdates();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!updatesOn) return;
    void fetchLatestUpdate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchLatestUpdate();
    });
    return () => sub.remove();
  }, []);

  const id = downloadedUpdate?.updateId ?? 'pending';
  if (!updatesOn || !isUpdatePending || dismissed === id) return null;

  async function restart() {
    setRestarting(true);
    try {
      await restartToUpdate();
    } catch {
      setRestarting(false);
    }
  }

  return (
    <View style={[styles.banner, { bottom: insets.bottom + TAB_BAR }]} accessibilityLiveRegion="polite">
      <Text style={styles.text} numberOfLines={2}>
        A new version is ready
      </Text>
      <Pressable accessibilityRole="button" onPress={() => setDismissed(id)} hitSlop={8} style={styles.later}>
        <Text style={styles.laterText}>Later</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={restart}
        disabled={restarting || isRestarting}
        style={({ pressed }) => [styles.restart, pressed && styles.pressed]}
      >
        <Text style={styles.restartText}>{restarting || isRestarting ? 'Restarting…' : 'Restart'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    elevation: 6,
  },
  text: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: colors.onInk },
  later: { paddingHorizontal: 4, paddingVertical: 8 },
  laterText: { fontSize: 14, fontWeight: '500', color: colors.onInk, opacity: 0.7 },
  restart: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primary, justifyContent: 'center' },
  restartText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  pressed: { opacity: 0.8 },
});
