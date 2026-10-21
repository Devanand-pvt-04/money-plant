import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function RootLayout() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const signedIn = session !== null;
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" options={{ title: 'Money Plant' }} />
          <Stack.Screen name="add-account" options={{ title: 'Add account', presentation: 'modal' }} />
          <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
          <Stack.Screen name="account/balance" options={{ title: 'Set balance', presentation: 'modal' }} />
          <Stack.Screen name="transactions" options={{ title: 'Transactions' }} />
          <Stack.Screen name="transaction/[id]" options={{ title: 'Entry' }} />
          <Stack.Screen name="review" options={{ title: 'Review' }} />
          <Stack.Screen name="capture" options={{ title: 'Bank SMS' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
