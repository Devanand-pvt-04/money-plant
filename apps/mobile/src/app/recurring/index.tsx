import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CADENCE_LABELS } from '@money-plant/core';
import type { RecurringPayment } from '@money-plant/matcher';
import { formatAmount } from '@/components/format';
import { Button, Card, SectionTitle, colors } from '@/components/ui';
import { Suggestion, UpcomingRow } from '@/components/recurring-rows';
import { recurringOverview, type UpcomingPayment } from '@/lib/recurring';
import { useLedger } from '@/lib/use-ledger';

/** REC-1 to REC-3: every autopay, EMI and subscription, soonest first, with suggestions to confirm. */
export default function RecurringList() {
  const { data } = useLedger(recurringOverview, { upcoming: [] as UpcomingPayment[], proposed: [] as RecurringPayment[], paused: [] as RecurringPayment[] });
  const empty = data.upcoming.length === 0 && data.proposed.length === 0 && data.paused.length === 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>
        Reminders go out 3 days and 1 day before each payment. When the bank SMS for a payment arrives, it is marked paid.
      </Text>

      {data.proposed.length > 0 && (
        <>
          <SectionTitle>Suggested from your history</SectionTitle>
          {data.proposed.map((item) => (
            <Suggestion key={item.id} item={item} />
          ))}
        </>
      )}

      {data.upcoming.length > 0 && (
        <>
          <SectionTitle>Coming up</SectionTitle>
          <Card>
            {data.upcoming.map((u, i) => (
              <UpcomingRow key={u.item.id} upcoming={u} first={i === 0} />
            ))}
          </Card>
        </>
      )}

      {data.paused.length > 0 && (
        <>
          <SectionTitle>Paused</SectionTitle>
          <Card>
            {data.paused.map((item, i) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => router.push(`/recurring/${item.id}`)}
                style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
              >
                <View style={styles.grow}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{CADENCE_LABELS[item.cadence]} · no reminders</Text>
                </View>
                <Text style={styles.amountMuted}>{formatAmount(item.amount)}</Text>
              </Pressable>
            ))}
          </Card>
        </>
      )}

      {empty && <Text style={styles.meta}>Nothing yet. Add your rent, EMIs and subscriptions, or wait for the app to spot them in your bank SMS.</Text>}
      <View style={styles.add}>
        <Button title="Add a recurring payment" variant="secondary" onPress={() => router.push('/recurring/new')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  intro: { fontSize: 14, color: colors.secondary, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  amountMuted: { fontSize: 15, fontWeight: '600', color: colors.muted, fontVariant: ['tabular-nums'] },
  add: { marginTop: 16 },
});
