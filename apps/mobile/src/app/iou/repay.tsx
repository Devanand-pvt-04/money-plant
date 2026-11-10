import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import type { IouDirection } from '@money-plant/matcher';
import { formatAmount } from '@/components/format';
import { FormScroll } from '@/components/keyboard';
import { Button, Card, ErrorText, Initial, useColors, makeStyles } from '@/components/ui';
import { repaymentOptions, settleWithEntry, type RepaymentOption } from '@/lib/ious';

/**
 * IOU-4 by hand: a bank entry the app didn't match to a loan, such as a
 * friend paying back from an account in their bank's spelling of their name
 * ("GOBAL NAIR" for Gobal). `?from=<entry id>`, optionally `&person=<id>`.
 */
export default function Repay() {
  const colors = useColors();
  const styles = useStyles();
  const params = useLocalSearchParams<{ from: string; person?: string }>();
  const [data, setData] = useState<{ amount: number; direction: IouDirection; options: RepaymentOption[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(params.person ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repaymentOptions(params.from).then(
      (result) => {
        setData(result);
        setSelected((current) => current ?? (result.options.length === 1 || result.options[0]?.likely ? result.options[0]!.personId : null));
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [params.from]);

  async function save() {
    if (!selected) return setError('Pick who it is');
    setSaving(true);
    setError(null);
    try {
      await settleWithEntry(params.from, selected);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (!data) return <FormScroll contentContainerStyle={styles.container}>{error && <ErrorText>{error}</ErrorText>}</FormScroll>;
  const lent = data.direction === 'lent';

  return (
    <FormScroll contentContainerStyle={styles.container}>
      <Text style={styles.lead}>
        {lent
          ? `Who paid you back this ${formatAmount(data.amount)}? The entry counts toward what they owe, and nothing new is added.`
          : `Who did you pay back with this ${formatAmount(data.amount)}? The entry counts toward what you owe them, and nothing new is added.`}
      </Text>
      {data.options.length === 0 ? (
        <Text style={styles.meta}>
          {lent
            ? `No one owes you ${formatAmount(data.amount)} or more from before this day. If they lent you money, use "I borrowed it" instead.`
            : `You don't owe anyone ${formatAmount(data.amount)} or more from before this day. If you lent them money, use "I lent it" instead.`}
        </Text>
      ) : (
        <Card>
          {data.options.map((o, i) => (
            <Pressable
              key={o.personId}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === o.personId }}
              onPress={() => setSelected(o.personId)}
              style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
            >
              <Initial name={o.name} />
              <View style={styles.grow}>
                <Text style={styles.name} numberOfLines={1}>{o.name}</Text>
                <Text style={styles.meta}>{lent ? `Owes you ${formatAmount(o.outstanding)}` : `You owe ${formatAmount(o.outstanding)}`}</Text>
              </View>
              <Feather name={selected === o.personId ? 'check-circle' : 'circle'} size={20} color={selected === o.personId ? colors.primary : colors.muted} />
            </Pressable>
          ))}
        </Card>
      )}
      <Text style={styles.hint}>The app remembers the name and UPI ID on this entry for them, so their next repayment is matched on its own.</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.actions}>
        <Button title={lent ? 'They paid me back' : 'I paid them back'} onPress={save} loading={saving} disabled={!selected || data.options.length === 0} />
      </View>
    </FormScroll>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 20, paddingBottom: 48, gap: 12 },
  lead: { fontSize: 15, color: colors.text, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  actions: { marginTop: 8 },
}));
