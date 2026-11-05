import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router/js-tabs';
import { colors } from '@/components/ui';
import { countPending } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

/** The active tab's icon sits on a sage pill (decision 0015). */
function icon(name: ComponentProps<typeof Feather>['name']) {
  return ({ focused }: { focused: boolean }) => (
    <View style={[pill, focused && { backgroundColor: colors.primarySurface }]}>
      <Feather name={name} color={focused ? colors.primary : colors.muted} size={20} />
    </View>
  );
}

const pill = { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' } as const;

/** NAV-1: the five places a user goes every day. Everything else opens on top of them. */
export default function TabsLayout() {
  const { data: pending } = useLedger(countPending, 0, 'tab badge');
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { height: 64 + insets.bottom, paddingTop: 6, backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIconStyle: { width: 56, height: 30 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTitleAlign: 'left',
        headerTitleStyle: { fontSize: 22, fontWeight: '700', color: colors.text },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: icon('home') }} />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          headerShown: false,
          tabBarIcon: icon('list'),
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: colors.onInk, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: icon('pie-chart') }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts', headerShown: false, tabBarIcon: icon('credit-card') }} />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarIcon: icon('users') }} />
    </Tabs>
  );
}
