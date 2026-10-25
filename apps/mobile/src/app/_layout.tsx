import { useEffect, useRef } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/components/ui';
import { watchSharedIous } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { followSystemScheme, scheme } from '@/lib/theme';

const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
const navigationTheme = {
  ...base,
  colors: {
    ...base.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.warning,
  },
};

export default function RootLayout() {
  const { session, loading } = useSession();
  const insets = useSafeAreaInsets();
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);

  useEffect(() => {
    // The window behind the app, so screen transitions never flash white in dark mode.
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
    return followSystemScheme();
  }, []);

  const userId = session?.user.id;
  useEffect(() => (userId ? watchSharedIous(userId) : undefined), [userId]);

  // A tapped reminder or budget alert opens the screen it is about.
  useEffect(() => {
    if (loading || !session || !lastResponse) return;
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { identifier, content } = lastResponse.notification.request;
    const url = content.data?.url;
    if (typeof url !== 'string' || handledResponse.current === identifier) return;
    handledResponse.current = identifier;
    router.push(url as never);
  }, [lastResponse, loading, session]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const signedIn = session !== null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            // Android draws edge to edge, so keep each screen's last button above the system navigation bar.
            contentStyle: { backgroundColor: colors.background, paddingBottom: insets.bottom },
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '600' },
          }}
        >
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home', contentStyle: { backgroundColor: colors.background } }} />
            <Stack.Screen name="quick-add" options={{ headerShown: false, presentation: 'modal', contentStyle: { backgroundColor: colors.background } }} />
            <Stack.Screen name="add-account" options={{ title: 'Add account', presentation: 'modal' }} />
            <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
            <Stack.Screen name="account/balance" options={{ title: 'Set balance', presentation: 'modal' }} />
            <Stack.Screen name="deposit" options={{ title: 'Deposit terms', presentation: 'modal' }} />
            <Stack.Screen name="cas-import" options={{ title: 'Import mutual funds', presentation: 'modal' }} />
            <Stack.Screen name="transaction/[id]" options={{ title: '' }} />
            <Stack.Screen name="transaction/edit" options={{ title: 'Edit entry', presentation: 'modal' }} />
            <Stack.Screen name="review" options={{ title: 'Review' }} />
            <Stack.Screen name="categories" options={{ title: 'Categories' }} />
            <Stack.Screen name="category/[id]" options={{ title: 'Category' }} />
            <Stack.Screen name="rules" options={{ title: 'Rules and patterns' }} />
            <Stack.Screen name="rule/[id]" options={{ title: 'Rule' }} />
            <Stack.Screen name="budget/[id]" options={{ title: 'Budget' }} />
            <Stack.Screen name="month-review" options={{ title: 'Month review' }} />
            <Stack.Screen name="account-types" options={{ title: 'Account types' }} />
            <Stack.Screen name="capture" options={{ title: 'Bank SMS' }} />
            <Stack.Screen name="pay" options={{ headerShown: false, presentation: 'modal', contentStyle: { backgroundColor: colors.background } }} />
            <Stack.Screen name="recurring/index" options={{ title: 'Recurring payments' }} />
            <Stack.Screen name="recurring/[id]" options={{ title: 'Recurring payment' }} />
            <Stack.Screen name="person/[id]" options={{ title: 'Person' }} />
            <Stack.Screen name="iou/new" options={{ title: 'Record a loan', presentation: 'modal' }} />
            <Stack.Screen name="iou/[id]" options={{ title: 'IOU' }} />
            <Stack.Screen name="expense" options={{ title: 'Add expense', presentation: 'modal' }} />
            <Stack.Screen name="group/[id]" options={{ title: 'Group' }} />
            <Stack.Screen name="group/edit" options={{ title: 'Group', presentation: 'modal' }} />
            <Stack.Screen name="profile" options={{ title: 'Your name and UPI ID', presentation: 'modal' }} />
            <Stack.Screen name="settings" options={{ title: 'Profile and settings' }} />
            <Stack.Screen name="data" options={{ title: 'Your data' }} />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
