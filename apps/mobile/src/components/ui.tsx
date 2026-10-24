import { useEffect, type ReactNode } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheme } from '@/lib/theme';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

/**
 * Design tokens. Minimal: a plain ground, near-black (or near-white) ink, and
 * one green that only marks money coming in or being on track.
 */
const light = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  /** Tinted panels: the month card, search field, icon tiles. */
  subtle: '#F3F6F4',
  text: '#111412',
  /** Body text on tinted panels. */
  secondary: '#3E4440',
  muted: '#5C625E',
  placeholder: '#9AA19C',
  border: '#E6E8E5',
  divider: '#EEF0ED',
  track: '#DCE3DE',
  /** Main buttons and selected chips, and the text on them. */
  ink: '#111412',
  onInk: '#FFFFFF',
  /** Money in, on track, the active tab. */
  primary: '#0B7A55',
  primarySurface: '#DDEFE6',
  pressed: '#EEF2EF',
  danger: '#B3261E',
  warning: '#B45309',
  warningSurface: '#FDF1E3',
};

const dark: typeof light = {
  background: '#0F1211',
  surface: '#161A18',
  subtle: '#1C211F',
  text: '#ECEFED',
  secondary: '#C2C8C4',
  muted: '#9AA39E',
  placeholder: '#6B736F',
  border: '#2A302D',
  divider: '#222826',
  track: '#2A302D',
  ink: '#ECEFED',
  onInk: '#0F1211',
  primary: '#3DBE8B',
  primarySurface: '#16382A',
  pressed: '#1F2522',
  danger: '#F2827A',
  warning: '#F0A35E',
  warningSurface: '#3A2A17',
};

export const colors = scheme === 'dark' ? dark : light;

export const radius = { sm: 10, md: 14, lg: 18, pill: 999 };

export function Button(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const { title, onPress, disabled, loading, variant = 'primary' } = props;
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onInk : colors.ink} />
      ) : (
        <Text style={[styles.buttonText, !primary && styles.buttonTextSecondary]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...rest} />
    </>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

/** A selectable pill, for picking one of a few options. */
export function Chip(props: { label: string; selected: boolean; onPress: () => void }) {
  const { label, selected, onPress } = props;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

/**
 * Share of a budget used. Turns amber on pace to overspend and red when over.
 * `marker` draws a tick where an even pace would be.
 */
/** A bar that fills to `value` (0 to 1) when it appears and whenever the value changes. */
export function ProgressBar(props: { value: number; status?: 'ok' | 'pace' | 'over'; marker?: number; color?: string }) {
  const { value, status = 'ok', marker } = props;
  const color = status === 'over' ? colors.danger : status === 'pace' ? colors.warning : (props.color ?? colors.primary);
  const clamp = (n: number) => Math.min(100, Math.max(0, n * 100));
  const pct = (n: number) => `${clamp(n)}%` as const;
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(clamp(value), { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [value, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fill, { backgroundColor: color }]} />
      {marker !== undefined && marker > 0 && marker < 1 && <View style={[styles.marker, { left: pct(marker) }]} />}
    </View>
  );
}

/** A bordered panel. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A first letter on a tinted tile, standing in for a merchant logo. */
export function Initial({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[styles.initial, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Text style={[styles.initialText, { fontSize: size * 0.36 }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: colors.ink },
  buttonSecondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  buttonText: { color: colors.onInk, fontSize: 15, fontWeight: '600' },
  buttonTextSecondary: { color: colors.ink },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, marginTop: 16 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { color: colors.danger, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.ink, backgroundColor: colors.ink },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '500' },
  chipTextSelected: { color: colors.onInk, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.track },
  fill: { height: 8, borderRadius: 4 },
  marker: { position: 'absolute', top: -4, width: 2, height: 16, marginLeft: -1, borderRadius: 1, backgroundColor: colors.ink },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 20, marginBottom: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  initial: { backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontWeight: '700', color: colors.secondary },
});
