import type { ComponentProps, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { radius, useColors, makeStyles } from './ui';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * One choice in a sheet: an icon, what it does and one line on what happens
 * (decision 0028). Replaces stacks of full-width buttons with long titles.
 */
export function OptionRow(props: {
  icon: FeatherName;
  title: string;
  meta?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  const colors = useColors();
  const styles = useStyles();
  const danger = props.tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed, props.disabled && styles.disabled]}
    >
      <View style={[styles.icon, danger && styles.iconDanger]}>
        <Feather name={props.icon} size={18} color={danger ? colors.danger : colors.text} />
      </View>
      <View style={styles.grow}>
        <Text style={[styles.title, danger && styles.titleDanger]}>{props.title}</Text>
        {props.meta ? <Text style={styles.meta}>{props.meta}</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * A row in a list card that opens something: icon tile, title, one line and a
 * chevron or a trailing badge (decision 0028).
 */
export function LinkRow(props: {
  icon?: FeatherName;
  /** Letters on the tile instead of an icon, for a sender. */
  letters?: string;
  title: string;
  meta?: string;
  /** In place of the chevron, such as a "Pick account" badge. */
  trailing?: ReactNode;
  tone?: 'warning';
  first?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const warning = props.tone === 'warning';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.link, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <View style={[styles.tile, warning && styles.tileWarning]}>
        {props.icon ? (
          <Feather name={props.icon} size={17} color={warning ? colors.warning : colors.text} />
        ) : (
          <Text style={styles.letters}>{props.letters}</Text>
        )}
      </View>
      <View style={styles.grow}>
        <Text style={styles.linkTitle} numberOfLines={1}>
          {props.title}
        </Text>
        {props.meta ? (
          <Text style={styles.meta} numberOfLines={2}>
            {props.meta}
          </Text>
        ) : null}
      </View>
      {props.trailing ?? <Feather name="chevron-right" size={18} color={colors.muted} />}
    </Pressable>
  );
}

/** A small amber badge, for something that needs an answer. */
export function Badge({ label }: { label: string }) {
  const styles = useStyles();
  return <Text style={styles.badge}>{label}</Text>;
}

const useStyles = makeStyles((colors) => ({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.pressed },
  disabled: { opacity: 0.4 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  iconDanger: { backgroundColor: colors.dangerSurface },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  titleDanger: { color: colors.danger },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  tile: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  tileWarning: { backgroundColor: colors.warningSurface },
  letters: { fontSize: 12, fontWeight: '700', color: colors.secondary },
  linkTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  badge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning,
    backgroundColor: colors.warningSurface,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
}));
