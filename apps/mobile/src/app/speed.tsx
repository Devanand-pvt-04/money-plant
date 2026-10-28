import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import { Button, Card, colors } from '@/components/ui';
import { speedLog } from '@/lib/perf';

/** The speed pass: how long each screen's data took to load on this phone since the app started. */
export default function Speed() {
  const [log, setLog] = useState(speedLog);
  useFocusEffect(useCallback(() => setLog(speedLog()), []));

  function share() {
    const lines = [
      `Money Plant ${Updates.runtimeVersion ?? ''} speed log`,
      `Home first load: ${log.firstLoadMs ?? '-'} ms after start`,
      ...log.rows.map((r) => `${r.label}: median ${r.median} ms, slowest ${r.slowest} ms, ${r.count} loads`),
    ];
    void Share.share({ message: lines.join('\n') });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        Use the app as usual for a few minutes, then send this to Claude. It shows how long each screen took to read its data on this phone. Only
        screen names and times, no amounts.
      </Text>
      <Card>
        <View style={styles.row}>
          <Text style={[styles.name, styles.grow]}>Home, first load after start</Text>
          <Text style={styles.value}>{log.firstLoadMs === null ? '-' : `${log.firstLoadMs} ms`}</Text>
        </View>
        {log.rows.map((r) => (
          <View key={r.label} style={[styles.row, styles.divided]}>
            <View style={styles.grow}>
              <Text style={styles.name}>{r.label}</Text>
              <Text style={styles.meta}>
                {r.count} {r.count === 1 ? 'load' : 'loads'} · slowest {r.slowest} ms
              </Text>
            </View>
            <Text style={styles.value}>{r.median} ms</Text>
          </View>
        ))}
      </Card>
      <View style={styles.actions}>
        <Button title="Send the speed log" onPress={share} disabled={log.rows.length === 0} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 12 },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  value: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { marginTop: 8 },
});
