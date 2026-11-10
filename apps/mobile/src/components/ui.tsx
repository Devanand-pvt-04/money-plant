import { useEffect, type ReactNode } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BACKGROUND, useScheme, type Scheme } from '@/lib/theme';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

/**
 * Design tokens: "Charcoal and sage" (decision 0015). A soft grey ground with
 * white cards, charcoal ink, and one sage green that marks money coming in or
 * being on track. Each tab's main number sits on a charcoal money card (hero).
 */
const light = {
  background: BACKGROUND.light,
  surface: '#FFFFFF',
  /** Tinted panels: the search field, chips, icon tiles. */
  subtle: '#EBEEEB',
  text: '#1D1F1E',
  /** Body text on tinted panels. */
  secondary: '#3E4441',
  muted: '#5C625F',
  placeholder: '#959C98',
  border: '#E1E4E1',
  divider: '#E9ECE9',
  track: '#DDE2DE',
  /** Main buttons and selected chips, and the text on them. */
  ink: '#1D1F1E',
  onInk: '#F2F4F2',
  /** Money in, on track, the active tab. */
  primary: '#2C7656',
  primarySurface: '#E1EEE7',
  pressed: '#E9ECE9',
  danger: '#B3261E',
  dangerSurface: '#FBE4E1',
  warning: '#A14A05',
  warningSurface: '#FBEEDD',
  /** The charcoal money card and what sits on it, the same in both schemes. */
  hero: '#1D1F1E',
  heroText: '#F2F4F2',
  heroMuted: '#A9B3AD',
  heroAccent: '#8FD1AE',
  heroWarning: '#F0A35E',
  heroDanger: '#F2827A',
  heroTrack: 'rgba(255,255,255,0.14)',
  heroPill: 'rgba(143,209,174,0.16)',
  heroLine: 'rgba(255,255,255,0.12)',
};

const dark: typeof light = {
  background: BACKGROUND.dark,
  surface: '#1D1F1E',
  subtle: '#262A28',
  text: '#EEF1EF',
  secondary: '#C5CCC8',
  muted: '#9CA59F',
  placeholder: '#6B736F',
  border: '#2C302E',
  divider: '#262A28',
  track: '#2C302E',
  ink: '#EEF1EF',
  onInk: '#121413',
  primary: '#8FD1AE',
  primarySurface: '#22382D',
  pressed: '#262A28',
  danger: '#F2827A',
  dangerSurface: '#3A1F1D',
  warning: '#F0A35E',
  warningSurface: '#36291A',
  hero: '#232826',
  heroText: '#F2F4F2',
  heroMuted: '#A9B3AD',
  heroAccent: '#8FD1AE',
  heroWarning: '#F0A35E',
  heroDanger: '#F2827A',
  heroTrack: 'rgba(255,255,255,0.12)',
  heroPill: 'rgba(143,209,174,0.16)',
  heroLine: 'rgba(255,255,255,0.1)',
};

export type Palette = typeof light;
const palettes: Record<Scheme, Palette> = { light, dark };

/** The palette of the scheme on screen; the component draws again when the theme changes. */
export function useColors(): Palette {
  return palettes[useScheme()];
}

/** The palette of one scheme, outside a component. */
export function paletteFor(scheme: Scheme): Palette {
  return palettes[scheme];
}

/**
 * Styles that use the palette: makeStyles((colors) => ({ ... })) at the top of
 * a file gives a hook that returns them for the scheme on screen. Each
 * scheme's sheet is built once, the first time it's needed, so a theme change
 * costs one draw and no new objects after that.
 */
export function makeStyles<S extends Parameters<typeof StyleSheet.create>[0]>(build: (colors: Palette) => S): () => Readonly<S> {
  const sheets: Partial<Record<Scheme, Readonly<S>>> = {};
  return function useThemedStyles() {
    const scheme = useScheme();
    return (sheets[scheme] ??= StyleSheet.create(build(palettes[scheme])));
  };
}

export const radius = { sm: 10, md: 14, lg: 18, pill: 999 };

export function Button(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const colors = useColors();
  const styles = useStyles();
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
  const colors = useColors();
  const styles = useStyles();
  const { label, style, ...rest } = props;
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...rest} />
    </>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.error}>{children}</Text>;
}

/** A selectable pill, for picking one of a few options. */
export function Chip(props: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
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
  const styles = useStyles();
  return <View style={styles.chips}>{children}</View>;
}

/**
 * Share of a budget used, filling to `value` (0 to 1) when it appears and
 * whenever the value changes. Turns amber on pace to overspend and red when
 * over. `marker` draws a tick where an even pace would be. `onHero` is for a
 * bar on the charcoal money card.
 */
export function ProgressBar(props: { value: number; status?: 'ok' | 'pace' | 'over'; marker?: number; color?: string; onHero?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const { value, status = 'ok', marker, onHero } = props;
  const color = onHero
    ? status === 'over' ? colors.heroDanger : status === 'pace' ? colors.heroWarning : (props.color ?? colors.heroAccent)
    : status === 'over' ? colors.danger : status === 'pace' ? colors.warning : (props.color ?? colors.primary);
  const clamp = (n: number) => Math.min(100, Math.max(0, n * 100));
  const pct = (n: number) => `${clamp(n)}%` as const;
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(clamp(value), { duration: 500, easing: Easing.out(Easing.cubic) });
  }, [value, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View style={[styles.track, onHero && styles.heroTrack]}>
      <Animated.View style={[styles.fill, onHero && styles.heroFill, fill, { backgroundColor: color }]} />
      {marker !== undefined && marker > 0 && marker < 1 && <View style={[styles.marker, onHero && styles.heroMarker, { left: pct(marker) }]} />}
    </View>
  );
}

/** The charcoal money card that holds a screen's main number (decision 0015). */
export function MoneyCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.money, style]}>{children}</View>;
}

/** A bordered panel. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A first letter on a tinted tile, standing in for a merchant logo. */
export function Initial({ name, size = 40 }: { name: string; size?: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.initial, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Text style={[styles.initialText, { fontSize: size * 0.36 }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <Text style={styles.section}>{children}</Text>;
}

/** Every amount uses tabular figures, so columns of money line up. */
export const figures = { fontVariant: ['tabular-nums'] } as const;

const useStyles = makeStyles((colors) => ({
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
  heroTrack: { height: 10, borderRadius: 5, backgroundColor: colors.heroTrack },
  heroFill: { height: 10, borderRadius: 5 },
  heroMarker: { height: 18, backgroundColor: colors.heroText },
  money: { padding: 20, borderRadius: 24, backgroundColor: colors.hero, gap: 14 },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 20, marginBottom: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  initial: { backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontWeight: '700', color: colors.secondary },
}));
