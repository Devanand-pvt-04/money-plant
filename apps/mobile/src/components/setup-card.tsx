import { type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { allowContacts } from '@/lib/contacts';
import { dismissSetup, type SetupState, type SetupStep } from '@/lib/setup';
import { openNotificationAccessSettings } from '../../modules/sms-reader';
import { Card, useColors, makeStyles } from './ui';

const STEPS: Record<SetupStep, { icon: ComponentProps<typeof Feather>['name']; title: string; why: string; go: () => unknown }> = {
  notifications: {
    icon: 'bell',
    title: 'Read UPI app alerts',
    why: 'Adds payee names from Google Pay, PhonePe and bank apps',
    go: openNotificationAccessSettings,
  },
  contacts: {
    icon: 'users',
    title: 'Match payees to contacts',
    why: 'Matched on this phone, never uploaded',
    go: allowContacts,
  },
  investments: {
    icon: 'trending-up',
    title: 'Import your investments',
    why: 'Mutual funds and shares from a CAS PDF',
    go: () => router.push('/cas-import'),
  },
  budget: {
    icon: 'pie-chart',
    title: 'Set a budget',
    why: 'Suggested from what you spent in the last 3 months',
    go: () => router.push('/budgets'),
  },
  invite: {
    icon: 'user-plus',
    title: 'Invite a friend',
    why: 'Share IOUs and settle up in one tap',
    go: () => router.push('/friends'),
  },
};

/** ACC-10: the optional setup steps, on Home until they're done or dismissed. */
export function SetupCard({ state, onChange }: { state: SetupState; onChange: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const left = state.steps.filter((s) => !s.done);
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.grow}>
          <Text style={styles.title}>Finish setting up</Text>
          <Text style={styles.meta}>
            {state.done} of {state.steps.length} done
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide setup steps"
          hitSlop={12}
          onPress={() => void dismissSetup().then(onChange)}
          style={styles.close}
        >
          <Feather name="x" size={18} color={colors.muted} />
        </Pressable>
      </View>
      {left.map((s) => {
        const step = STEPS[s.key];
        return (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            onPress={() => void Promise.resolve(step.go()).then(onChange, onChange)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Feather name={step.icon} size={18} color={colors.primary} />
            <View style={styles.grow}>
              <Text style={styles.name}>{step.title}</Text>
              <Text style={styles.meta}>{step.why}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        );
      })}
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  close: { minWidth: 48, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
}));
