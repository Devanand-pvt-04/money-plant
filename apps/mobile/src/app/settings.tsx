import { type ComponentProps, useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { Avatar, useMe } from '@/components/avatar';
import { Card, SectionTitle, radius, useColors, makeStyles } from '@/components/ui';
import { aiEnabled, setAiEnabled } from '@/lib/ai-settings';
import { lockAvailable, lockEnabled, setLockEnabled, unlock } from '@/lib/lock';
import { displayName } from '@/lib/me';
import { hideInRecents, setHideInRecents } from '@/lib/privacy';
import { signOut } from '@/lib/session';
import { fetchLatestUpdate, restartToUpdate, runningVersion, updatesOn, type UpdateCheck } from '@/lib/updates';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/lib/theme';
import { setRoundSummaries, useRoundSummaries } from '@/lib/rounding';

const THEMES: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'Phone' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/** NAV-1: profile and settings, opened from the avatar on Home. */
export default function Settings() {
  const colors = useColors();
  const styles = useStyles();
  const me = useMe();
  const theme = useThemePreference();
  const rounded = useRoundSummaries();
  const lock = useLockSetting();
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  useEffect(() => {
    hideInRecents().then(setHidden).catch(() => setHidden(true));
    aiEnabled().then(setAi).catch(() => setAi(true));
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
          <Feather name="hash" size={18} color={colors.muted} />
          <View style={styles.grow}>
            <Text style={styles.name}>Round off totals</Text>
            <Text style={styles.meta}>Totals, balances and charts in whole rupees. Entries and splits keep their paise.</Text>
          </View>
          <Switch value={rounded} onValueChange={setRoundSummaries} />
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
        <View style={styles.row}>
          <Feather name="cpu" size={18} color={colors.muted} />
          <View style={styles.grow}>
            <Text style={styles.name}>AI suggestions</Text>
            <Text style={styles.meta}>Categories for unknown shops, from a model on Deva's PC</Text>
          </View>
          <Switch
            value={ai === true}
            disabled={ai === null}
            onValueChange={(next) => {
              setAi(next);
              void setAiEnabled(next);
            }}
          />
        </View>
        <Link icon="message-square" title="Bank SMS" href="/capture" />
        <Link icon="sliders" title="Rules and patterns" href="/rules" />
        <Link icon="layers" title="Account types" href="/account-types" />
      </Card>

      <SectionTitle>Friends</SectionTitle>
      <Card>
        <Link icon="user-plus" title="Invite friends" href="/friends" first />
      </Card>

      <SectionTitle>Your data</SectionTitle>
      <Card>
        <Link icon="download" title="Export, clear or delete" href="/data" first />
        <Link icon="heart" title="Health" href="/health" />
        <Link icon="activity" title="Speed log" href="/speed" />
      </Card>

      <SectionTitle>Version</SectionTitle>
      <Card>
        <UpdateRow />
      </Card>

      <Pressable accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const CHECK_TEXT: Record<UpdateCheck | 'checking', string> = {
  checking: 'Checking…',
  ready: 'Downloaded. Tap to restart on it',
  latest: 'This is the latest version',
  off: 'Updates are off in this build',
  failed: "Couldn't check. Are you online?",
};

/** What version is running, and a check for a newer update on tap. */
function UpdateRow() {
  const colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<UpdateCheck | 'checking' | null>(null);
  async function check() {
    if (state === 'ready') return void restartToUpdate().catch(() => setState('failed'));
    setState('checking');
    setState(await fetchLatestUpdate(true));
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={check}
      disabled={!updatesOn || state === 'checking'}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Feather name="refresh-cw" size={18} color={colors.muted} />
      <View style={styles.grow}>
        <Text style={styles.name}>{state === 'ready' ? 'Restart to update' : 'Check for updates'}</Text>
        <Text style={styles.meta}>{state ? CHECK_TEXT[state] : runningVersion()}</Text>
      </View>
    </Pressable>
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
  const colors = useColors();
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
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
}));
