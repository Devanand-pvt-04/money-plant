import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Feather from '@expo/vector-icons/Feather';
import { dateKey, type DateKey } from '@money-plant/core';
import { formatDay, formatTime } from './format';
import { colors, radius } from './ui';

/** A date key at noon, so a time zone shift never moves it to another day. */
const fromKey = (key: DateKey) => new Date(`${key}T12:00:00`);

/**
 * The phone's own date picker, then its time picker when `withTime` is set.
 * Dismissing the time picker keeps the new date with the old time.
 * Android only for now; iOS gets its inline picker with the iOS milestone.
 */
function openPicker(value: Date, withTime: boolean, onChange: (next: Date) => void, limits: { min?: Date; max?: Date }) {
  if (Platform.OS !== 'android') return;
  DateTimePickerAndroid.open({
    value,
    mode: 'date',
    minimumDate: limits.min,
    maximumDate: limits.max,
    onChange: (event, date) => {
      if (event.type !== 'set' || !date) return;
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), value.getHours(), value.getMinutes());
      if (!withTime) return onChange(day);
      DateTimePickerAndroid.open({
        value: day,
        mode: 'time',
        onChange: (timeEvent, time) => {
          if (timeEvent.type !== 'set' || !time) return onChange(day);
          onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes()));
        },
      });
    },
  });
}

/** Opens the date then time pickers for a timestamp; future times are refused. */
export function pickDateTime(iso: string, onChange: (iso: string) => void) {
  openPicker(new Date(iso), true, (d) => onChange(new Date(Math.min(d.getTime(), Date.now())).toISOString()), { max: new Date() });
}

/** "Today, 9:05 am". */
export function formatWhen(iso: string): string {
  return `${formatDay(iso)}, ${formatTime(iso)}`;
}

function Row(props: { label: string; value: string; placeholder?: boolean; onPress: () => void; onClear?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${props.value}`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, props.style]}
    >
      <Feather name="calendar" size={18} color={colors.muted} />
      <View style={styles.text}>
        <Text style={styles.label}>{props.label}</Text>
        <Text style={[styles.value, props.placeholder && styles.placeholder]}>{props.value}</Text>
      </View>
      {props.onClear && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${props.label.toLowerCase()}`} hitSlop={8} onPress={props.onClear} style={styles.clear}>
          <Feather name="x" size={18} color={colors.muted} />
        </Pressable>
      )}
    </Pressable>
  );
}

/** NAV-2: a date and time, as an ISO timestamp. Defaults to now. Future times are refused. */
export function DateTimeField(props: { label?: string; value: string; onChange: (iso: string) => void; style?: StyleProp<ViewStyle> }) {
  const { label = 'When', value, onChange } = props;
  return (
    <Row
      label={label}
      value={formatWhen(value)}
      style={props.style}
      onPress={() => pickDateTime(value, onChange)}
    />
  );
}

/**
 * NAV-2: a calendar date such as a due date. With `optional`, an empty value
 * shows `placeholder` and can be cleared again.
 */
export function DateField(props: {
  label: string;
  value: DateKey | null;
  onChange: (key: DateKey | null) => void;
  optional?: boolean;
  placeholder?: string;
  /** Earliest and latest allowed dates. */
  min?: DateKey;
  max?: DateKey;
  style?: StyleProp<ViewStyle>;
}) {
  const { label, value, onChange, optional, placeholder = 'Not set' } = props;
  return (
    <Row
      label={label}
      value={value ? formatDay(fromKey(value).toISOString()) : placeholder}
      placeholder={!value}
      style={props.style}
      onClear={optional && value ? () => onChange(null) : undefined}
      onPress={() =>
        openPicker(value ? fromKey(value) : props.min ? fromKey(props.min) : new Date(), false, (d) => onChange(dateKey(d)), {
          min: props.min ? fromKey(props.min) : undefined,
          max: props.max ? fromKey(props.max) : undefined,
        })
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: 8,
  },
  pressed: { backgroundColor: colors.pressed },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 12, color: colors.muted },
  value: { fontSize: 15, fontWeight: '600', color: colors.text },
  placeholder: { color: colors.placeholder, fontWeight: '500' },
  clear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
