import { type ComponentProps, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { Avatar, useMe } from '@/components/avatar';
import { Card, SectionTitle, colors, radius } from '@/components/ui';
import { lockAvailable, lockEnabled, setLockEnabled, unlock } from '@/lib/lock';
import { displayName } from '@/lib/me';
import { hideInRecents, setHideInRecents } from '@/lib/privacy';
import { signOut } from '@/lib/session';
import { setThemePreference, themePreference, type ThemePreference } from '@/lib/theme';

const THEMES: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'Phone' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/** NAV-1: profile and settings, opened from the avatar on Home. */
export default function Settings() {
  const me = useMe();
  const theme = themePreference();
  const lock = useLockSetting();
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    hideInRecents().then(setHidden).catch(() => setHidden(true));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={({ pressed }) => [styles.profile, pressed && styles.pressed]}>
        <Avatar me={me} size={52} />
        <View style={styles.grow}>
          <Text style={styles.profileName} numberOfLines={1}>
            {me ? displayName(me) : ' '}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[me?.vpa, me?.email].filter(Boolean).join(' · ') || 'Add your name and UPI ID'}
          </Text>
        </View>
        <Text style={styles.edit}>Edit</Text>
      </Pressable>

      <SectionTitle>App</SectionTitle>
      <Card>
        <View style={styles.row}>
          <Feather name="moon" size={18} color={colors.muted} />
          <Text style={[styles.name, styles.grow]}>Appearance</Text>
          <View style={styles.segment}>
            {THEMES.map((t) => (
              <Pressable
                key={t.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: theme === t.key }}
                onPress={() => theme !== t.key && setThemePreference(t.key)}
                style={[styles.segmentItem, theme === t.key && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, theme === t.key && styles.segmentTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={[styles.row, styles.divided]}>
          <Feather name="lock" size={18} color={colors.muted} />
          <View style={styles.grow}>
            <Text style={styles.name}>App lock</Text>
            <Text style={styles.meta}>
              {lock.available === false ? 'Set a screen lock on your phone to use this.' : 'Fingerprint or screen lock when the app opens'}
            </Text>
          </View>
          <Switch value={lock.on === true && lock.available === true} disabled={lock.on === null || !lock.available} onValueChange={lock.toggle} />
        </View>
        <View style={[styles.row, styles.divided]}>
          <Feather name="eye-off" size={18} color={colors.muted} />
          <View style={styles.grow}>
            <Text style={styles.name}>Hide in recent apps</Text>
            <Text style={styles.meta}>Also blocks screenshots. Turn off to take one.</Text>
          </View>
          <Switch
            value={hidden === true}
            disabled={hidden === null}
            onValueChange={(next) => {
              setHidden(next);
              void setHideInRecents(next);
            }}
          />
        </View>
      </Card>

      <SectionTitle>How entries are filled</SectionTitle>
      <Card>
        <Link icon="message-square" title="Bank SMS" href="/capture" first />
        <Link icon="sliders" title="Rules and patterns" href="/rules" />
        <Link icon="layers" title="Account types" href="/account-types" />
      </Card>

      <SectionTitle>Your data</SectionTitle>
      <Card>
        <Link icon="download" title="Export, clear or delete" href="/data" first />
        <Link icon="activity" title="Speed log" href="/speed" />
      </Card>

      <Pressable accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

/** ACC-2: changing the lock either way asks to unlock first, so someone holding the phone can't turn it off. */
function useLockSetting() {
  const [on, setOn] = useState<boolean | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    lockEnabled().then(setOn).catch(() => setOn(true));
    lockAvailable().then(setAvailable);
  }, []);

  async function toggle(next: boolean) {
    if ((await unlock(next ? 'Turn on app lock' : 'Turn off app lock')) !== 'unlocked') return;
    await setLockEnabled(next);
    setOn(next);
  }

  return { on, available, toggle };
}

function Link(props: { icon: ComponentProps<typeof Feather>['name']; title: string; href: Href; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(props.href)}
      style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <Feather name={props.icon} size={18} color={colors.muted} />
      <Text style={[styles.name, styles.grow]}>{props.title}</Text>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, backgroundColor: colors.subtle },
  profileName: { fontSize: 18, fontWeight: '700', color: colors.text },
  edit: { fontSize: 14, fontWeight: '600', color: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.pill, padding: 2 },
  segmentItem: { minHeight: 32, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  signOut: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  signOutText: { fontSize: 15, fontWeight: '600', color: colors.danger },
});
