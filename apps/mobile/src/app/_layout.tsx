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
          <Stack.Screen name="transaction/edit" options={{ title: 'Edit entry', presentation: 'modal' }} />
          <Stack.Screen name="review" options={{ title: 'Review' }} />
          <Stack.Screen name="categories" options={{ title: 'Categories' }} />
          <Stack.Screen name="category/[id]" options={{ title: 'Category' }} />
          <Stack.Screen name="rules" options={{ title: 'Rules and patterns' }} />
          <Stack.Screen name="rule/[id]" options={{ title: 'Rule' }} />
          <Stack.Screen name="budgets" options={{ title: 'Budgets' }} />
          <Stack.Screen name="budget/[id]" options={{ title: 'Budget' }} />
          <Stack.Screen name="account-types" options={{ title: 'Account types' }} />
          <Stack.Screen name="capture" options={{ title: 'Bank SMS' }} />
          <Stack.Screen name="upi-test" options={{ title: 'UPI hand-off test' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
