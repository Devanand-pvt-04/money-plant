import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router/js-tabs';
import { colors } from '@/components/ui';
import { countPending } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

function icon(name: ComponentProps<typeof Feather>['name']) {
  return ({ color, size }: { color: ColorValue; size: number }) => <Feather name={name} color={color as string} size={size - 2} />;
}

/** The four places a user goes every day. Everything else opens on top of them. */
export default function TabsLayout() {
  const { data: pending } = useLedger(countPending, 0);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
          tabBarIcon: icon('list'),
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: colors.onInk, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="budgets" options={{ title: 'Budgets', tabBarIcon: icon('pie-chart') }} />
      <Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: icon('credit-card') }} />
    </Tabs>
  );
}
