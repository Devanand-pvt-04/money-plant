import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from 'expo-router';
import { makeStyles, useColors } from '@/components/ui';
import { onLedgerChange } from '@/lib/events';
import { countWaiting, useSyncOffline } from '@/lib/sync';

/** What a waiting count reads as, for the offline line. */
export function waitingText(waiting: number): string {
  if (waiting === 0) return 'Offline. Everything is saved on this phone.';
  return `Offline. ${waiting} ${waiting === 1 ? 'change' : 'changes'} will sync when you're back online.`;
}

/**
 * Decision 0035: offline, a tab says so quietly instead of "Sync failed",
 * with how many changes are waiting to go up. Nothing shows while online.
 */
export function OfflineNote() {
  const styles = useStyles();
  const colors = useColors();
  const offline = useSyncOffline();
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(() => {
    countWaiting().then(setWaiting, () => {});
  }, []);

  useEffect(() => {
    if (!offline) return;
    load();
    return onLedgerChange(load);
  }, [offline, load]);

  useFocusEffect(
    useCallback(() => {
      if (offline) load();
    }, [offline, load]),
  );

  if (!offline) return null;
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Feather name="cloud-off" size={14} color={colors.muted} />
      <Text style={styles.text}>{waitingText(waiting)}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  text: { flex: 1, fontSize: 13, color: colors.muted },
}));
