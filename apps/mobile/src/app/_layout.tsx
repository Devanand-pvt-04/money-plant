import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/components/ui';
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

  useEffect(() => {
    // The window behind the app, so screen transitions never flash white in dark mode.
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
    return followSystemScheme();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const signedIn = session !== null;
  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '600' },
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
          <Stack.Screen name="quick-add" options={{ headerShown: false, presentation: 'modal' }} />
          <Stack.Screen name="add-account" options={{ title: 'Add account', presentation: 'modal' }} />
          <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
          <Stack.Screen name="account/balance" options={{ title: 'Set balance', presentation: 'modal' }} />
          <Stack.Screen name="transaction/[id]" options={{ title: '' }} />
          <Stack.Screen name="transaction/edit" options={{ title: 'Edit entry', presentation: 'modal' }} />
          <Stack.Screen name="review" options={{ title: 'Review' }} />
          <Stack.Screen name="categories" options={{ title: 'Categories' }} />
          <Stack.Screen name="category/[id]" options={{ title: 'Category' }} />
          <Stack.Screen name="rules" options={{ title: 'Rules and patterns' }} />
          <Stack.Screen name="rule/[id]" options={{ title: 'Rule' }} />
          <Stack.Screen name="budget/[id]" options={{ title: 'Budget' }} />
          <Stack.Screen name="account-types" options={{ title: 'Account types' }} />
          <Stack.Screen name="capture" options={{ title: 'Bank SMS' }} />
          <Stack.Screen name="upi-test" options={{ title: 'UPI hand-off test' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
