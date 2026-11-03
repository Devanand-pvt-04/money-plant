import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { balanceMet, formatRupees, HEALTH_DAYS, HEALTH_TARGETS, paise, type Share as Ratio } from '@money-plant/core';
import { Button, Card, colors, SectionTitle } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { loadHealth, type Health as HealthData } from '@/lib/health';
import { useLedger } from '@/lib/use-ledger';

const percent = (value: number) => `${Math.round(value * 100)}%`;

function minutes(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** HOME-3: the PRD's success metrics, measured on this phone over the last 30 days. */
export default function Health() {
  const { data } = useLedger<HealthData | null>(loadHealth, null, 'health');

  function share() {
    if (!data) return;
    const lines = [
      `Money Plant health, last ${HEALTH_DAYS} days`,
      `Captured automatically: ${ratio(data.captured)} (target ${percent(HEALTH_TARGETS.captured)})`,
      `Categories left unchanged: ${ratio(data.categories)} (target ${percent(HEALTH_TARGETS.categories)})`,
      `Time in Review: ${data.review.averageSeconds === null ? '-' : `${minutes(data.review.averageSeconds)} a day over ${data.review.days} days`} (target under 2 min)`,
      ...data.balances.map((b, i) => `Bank account ${i + 1}: ${balanceMet(b.gap) ? 'matches' : `off by ${formatRupees(paise(Math.abs(b.gap)))}`}`),
    ];
    void Share.share({ message: lines.join('\n') });
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        How Money Plant is doing against its goals on this phone over the last {HEALTH_DAYS} days. Worked out here; nothing is sent anywhere.
      </Text>
      {!data ? (
        <Text style={styles.hint}>Working it out…</Text>
      ) : (
        <>
          <Card>
            <Metric
              first
              title="Captured automatically"
              detail={`${data.captured.hits} of ${data.captured.total} entries came from SMS, statements or imports`}
              value={data.captured.share === null ? '-' : percent(data.captured.share)}
              target={`Target ${percent(HEALTH_TARGETS.captured)}`}
              met={data.captured.met}
            />
            <Metric
              title="Categories left unchanged"
              detail={`${data.categories.hits} of ${data.categories.total} captured entries kept the category the app picked`}
              value={data.categories.share === null ? '-' : percent(data.categories.share)}
              target={`Target ${percent(HEALTH_TARGETS.categories)}`}
              met={data.categories.met}
            />
            <Metric
              title="Time in Review"
              detail={data.review.days === 0 ? 'Counted from today, each time Review is open' : `Average on the ${data.review.days} days Review was open`}
              value={data.review.averageSeconds === null ? '-' : minutes(data.review.averageSeconds)}
              target="Target under 2 min a day"
              met={data.review.met}
            />
          </Card>

          <SectionTitle>Balances against the bank</SectionTitle>
          <Card>
            {data.balances.length === 0 ? (
              <Text style={[styles.hint, styles.pad]}>No bank SMS with a balance yet.</Text>
            ) : (
              data.balances.map((b, i) => (
                <Metric
                  key={b.accountId}
                  first={i === 0}
                  title={b.name}
                  detail={`Bank's balance on ${formatDateTime(b.observedAt)}`}
                  value={balanceMet(b.gap) ? 'Matches' : `${b.gap > 0 ? 'Missing' : 'Extra'} ${formatRupees(paise(Math.abs(b.gap)))}`}
                  target="Target within ₹1"
                  met={balanceMet(b.gap)}
                  onPress={() => router.push(`/account/${b.accountId}`)}
                />
              ))
            )}
          </Card>
          {data.unchecked.length > 0 && <Text style={styles.hint}>Not checked yet, no balance from the bank: {data.unchecked.join(', ')}.</Text>}

          <View style={styles.actions}>
            <Button title="Send these numbers" variant="secondary" onPress={share} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function ratio(value: Ratio): string {
  return value.share === null ? '-' : `${percent(value.share)} (${value.hits} of ${value.total})`;
}

function Metric(props: {
  title: string;
  detail: string;
  value: string;
  target: string;
  met: boolean | null;
  first?: boolean;
  onPress?: () => void;
}) {
  const tone = props.met === null ? colors.muted : props.met ? colors.primary : colors.warning;
  return (
    <Pressable
      accessibilityRole={props.onPress ? 'button' : undefined}
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={styles.name}>{props.title}</Text>
        <Text style={styles.meta}>{props.detail}</Text>
        <Text style={styles.meta}>{props.target}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.value, { color: tone }]}>{props.value}</Text>
        {props.met !== null && <Feather name={props.met ? 'check-circle' : 'alert-circle'} size={16} color={tone} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 12 },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  pad: { padding: 16 },
  pressed: { backgroundColor: colors.pressed },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end', gap: 4 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  value: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  actions: { marginTop: 8 },
});
