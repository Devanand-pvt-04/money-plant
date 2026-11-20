import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { paise, type Paise } from '@money-plant/core';
import { formatAmount } from './format';
import { Sheet } from './sheet';
import { makeStyles, useColors } from './ui';

/** Equal parts an overspend can be spread over (decision 0034). */
export const SPREADS = [2, 3, 4, 5, 6] as const;

/**
 * BUD-5: how an overspend comes off later budgets: as each month's budget
 * allows until it's cleared, or in equal parts over 2 to 6 months.
 */
export function SpreadSheet(props: { visible: boolean; amount: Paise; value: number | null; onPick: (spread: number | null) => void; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const options: { spread: number | null; label: string; note: string }[] = [
    { spread: null, label: 'As needed', note: 'Each month takes what its budget allows until it’s cleared' },
    ...SPREADS.map((n) => ({ spread: n, label: `Over ${n} months`, note: `About ${formatAmount(paise(Math.ceil(props.amount / n)))} a month` })),
  ];
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={`Take ${formatAmount(props.amount)} off`}>
      {options.map((o) => (
        <Pressable
          key={o.label}
          accessibilityRole="radio"
          accessibilityState={{ selected: props.value === o.spread }}
          onPress={() => props.onPick(o.spread)}
          style={({ pressed }) => [styles.option, pressed && styles.pressed]}
        >
          <View style={styles.grow}>
            <Text style={styles.label}>{o.label}</Text>
            <Text style={styles.note}>{o.note}</Text>
          </View>
          {props.value === o.spread && <Feather name="check" size={18} color={colors.primary} />}
        </Pressable>
      ))}
      <Text style={styles.note}>A month’s budget never goes below zero; what it can’t take moves on to the next month.</Text>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 4, gap: 8 },
  pressed: { opacity: 0.85 },
  grow: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, color: colors.text },
  note: { fontSize: 13, color: colors.muted, lineHeight: 19 },
}));
