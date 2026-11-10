import { useEffect, useRef, useState } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppLock } from '@/components/app-lock';
import { ErrorScreen } from '@/components/error-screen';
import { UpdateBanner } from '@/components/update-banner';
import { Button, colors } from '@/components/ui';
import { useConsent } from '@/lib/consent';
import { flushErrors, reportError, watchErrors } from '@/lib/errors';
import { applyHideInRecents } from '@/lib/privacy';
import { watchSharedIous } from '@/lib/realtime';
import { startedAt, startedFromRestart } from '@/lib/restart-log';
import { useSession } from '@/lib/session';
import { followSystemScheme, scheme } from '@/lib/theme';
import { restartApp } from '@/lib/updates';

watchErrors();

/** A crash anywhere below shows a way back instead of a blank screen. */
export const ErrorBoundary = ErrorScreen;

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

/** How long the first screen may wait before it says what it's waiting for. */
const SLOW_START_MS = 8_000;

/**
 * True once the app has waited too long on one startup step. The step is
 * logged once (as a non-fatal error with how long it took), so a start that
 * hangs shows up in the error log even when nothing crashed.
 */
function useSlowStart(step: 'session' | 'consent' | null): boolean {
  const [slow, setSlow] = useState(false);
  const started = useRef(Date.now());
  const slowStep = useRef<string | null>(null);
  useEffect(() => {
    if (!step) {
      if (slowStep.current) {
        reportError(new Error(`Slow start: waited on ${slowStep.current}, ready after ${Math.round((Date.now() - started.current) / 1000)} s`), 'startup');
        slowStep.current = null;
      }
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => {
      slowStep.current = step;
      setSlow(true);
    }, SLOW_START_MS);
    return () => clearTimeout(timer);
  }, [step]);
  return slow;
}

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
  const consented = useConsent(userId);
  const waitingFor = loading ? 'session' : session && consented === null ? 'consent' : null;
  const slow = useSlowStart(waitingFor);
  const signedIn = session !== null;
  const ready = signedIn && consented === true;
  useEffect(() => (userId ? watchSharedIous(userId) : undefined), [userId]);
  // Balances stay out of the recent apps view once there is a ledger to hide.
  useEffect(() => {
    void (userId ? applyHideInRecents() : applyHideInRecents(false));
  }, [userId]);
  // A start that followed the app's own restart (theme, update, Try again) is
  // logged with how long it took to open, so a run of restarts or a slow
  // return from one shows up in the error log.
  const restartLogged = useRef(false);
  useEffect(() => {
    const restart = startedFromRestart();
    if (!ready || !restart || restartLogged.current) return;
    restartLogged.current = true;
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    reportError(new Error(`Restart: ${restart.reason}, ${restart.count} in a row, open after ${seconds} s`), 'restart');
  }, [ready]);
  // Errors saved while offline or signed out go up once there is a session.
  useEffect(() => {
    if (userId) void flushErrors();
  }, [userId]);

  // A tapped reminder or budget alert opens the screen it is about.
  useEffect(() => {
    if (loading || !session || !consented || !lastResponse) return;
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { identifier, content } = lastResponse.notification.request;
    const url = content.data?.url;
    if (typeof url !== 'string' || handledResponse.current === identifier) return;
    handledResponse.current = identifier;
    // Android keeps the last tapped notification across launches; clearing it stops every cold start reopening that screen.
    Notifications.clearLastNotificationResponse();
    router.push(url as never);
  }, [lastResponse, loading, session, consented]);

  if (waitingFor) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
        {slow && (
          <>
            <Text style={{ fontSize: 15, color: colors.text, textAlign: 'center', lineHeight: 21 }}>
              {waitingFor === 'session'
                ? 'Still checking your sign-in. After a while away this needs the internet, so a slow connection holds it up.'
                : 'Still opening your data on this phone.'}
            </Text>
            <Button title="Try again" variant="secondary" onPress={() => void restartApp()} />
          </>
        )}
      </View>
    );
  }

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
          <Stack.Protected guard={ready}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home', contentStyle: { backgroundColor: colors.background } }} />
            <Stack.Screen name="quick-add" options={{ headerShown: false, presentation: 'modal', contentStyle: { backgroundColor: colors.background } }} />
            <Stack.Screen name="add-account" options={{ title: 'Add account', presentation: 'modal' }} />
            <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
            <Stack.Screen name="money/[group]" options={{ title: '' }} />
            <Stack.Screen name="account/balance" options={{ title: 'Set balance', presentation: 'modal' }} />
            <Stack.Screen name="deposit" options={{ title: 'Deposit terms', presentation: 'modal' }} />
            <Stack.Screen name="cas-import" options={{ title: 'Import investments', presentation: 'modal' }} />
            <Stack.Screen name="holding-cost" options={{ title: 'What you paid', presentation: 'modal' }} />
            <Stack.Screen name="statement-import" options={{ title: 'Import a statement', presentation: 'modal' }} />
            <Stack.Screen name="transaction/[id]" options={{ title: '' }} />
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
            <Stack.Screen name="iou/repay" options={{ title: 'Repayment', presentation: 'modal' }} />
            <Stack.Screen name="expense" options={{ title: 'Add expense', presentation: 'modal' }} />
            <Stack.Screen name="group/[id]" options={{ title: 'Group' }} />
            <Stack.Screen name="group/edit" options={{ title: 'Group', presentation: 'modal' }} />
            <Stack.Screen name="friends" options={{ title: 'Friends' }} />
            <Stack.Screen name="profile" options={{ title: 'Your name and UPI ID', presentation: 'modal' }} />
            <Stack.Screen name="settings" options={{ title: 'Profile and settings' }} />
            <Stack.Screen name="data" options={{ title: 'Your data' }} />
            <Stack.Screen name="speed" options={{ title: 'Speed log' }} />
            <Stack.Screen name="health" options={{ title: 'Health' }} />
          </Stack.Protected>
          <Stack.Protected guard={signedIn && !ready}>
            <Stack.Screen name="consent" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
        {ready && <UpdateBanner />}
        <AppLock active={ready} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
