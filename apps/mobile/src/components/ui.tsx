import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

/**
 * Design tokens. Minimal and light: a white ground, near-black ink, and one
 * green that only marks money coming in or being on track.
 */
export const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  /** Tinted panels: the month card, search field, icon tiles. */
  subtle: '#F3F6F4',
  text: '#111412',
  muted: '#5C625E',
  border: '#E6E8E5',
  divider: '#EEF0ED',
  /** Main buttons and selected chips. */
  ink: '#111412',
  /** Money in, on track, the active tab. */
  primary: '#0B7A55',
  primarySurface: '#DDEFE6',
  pressed: '#EEF2EF',
  danger: '#B3261E',
  warning: '#B45309',
  warningSurface: '#FDF1E3',
};

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
        <ActivityIndicator color={primary ? '#fff' : colors.ink} />
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
export function ProgressBar(props: { value: number; status?: 'ok' | 'pace' | 'over'; marker?: number }) {
  const { value, status = 'ok', marker } = props;
  const color = status === 'over' ? colors.danger : status === 'pace' ? colors.warning : colors.primary;
  const pct = (n: number) => `${Math.min(100, Math.max(0, n * 100))}%` as const;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: pct(value), backgroundColor: color }]} />
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
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
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
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#DCE3DE' },
  fill: { height: 8, borderRadius: 4 },
  marker: { position: 'absolute', top: -4, width: 2, height: 16, marginLeft: -1, borderRadius: 1, backgroundColor: colors.ink },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 20, marginBottom: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  initial: { backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontWeight: '700', color: '#3E4440' },
});
