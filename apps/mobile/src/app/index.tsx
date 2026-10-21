import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { ACCOUNT_TYPE_LABELS, formatRupees, paise } from '@money-plant/core';
import type { LocalAccount } from '@money-plant/db-schema';
import { Button, ErrorText, colors } from '@/components/ui';
import { deleteAccount, listAccounts } from '@/lib/accounts';
import { signOut } from '@/lib/session';
import { syncNow } from '@/lib/sync';

export default function Accounts() {
  const [items, setItems] = useState<LocalAccount[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await listAccounts());
    setSyncing(true);
    try {
      await syncNow();
      setError(null);
    } catch (e) {
      setError(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
      setItems(await listAccounts());
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function confirmDelete(account: LocalAccount) {
    Alert.alert('Delete account?', `${account.name} will be removed from all your devices.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteAccount(account.id);
          refresh();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={signOut} hitSlop={12}>
              <Text style={styles.headerAction}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} />}
        contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No accounts yet. Add your bank accounts, cards and cash to get started.</Text>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => confirmDelete(item)} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {ACCOUNT_TYPE_LABELS[item.type]}
                {item.institution ? ` · ${item.institution}` : ''}
                {item.last4 ? ` · ••${item.last4}` : ''}
              </Text>
            </View>
            <Text style={styles.amount}>{formatRupees(paise(item.openingBalancePaise))}</Text>
          </Pressable>
        )}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.footer}>
        <Button title="Add account" onPress={() => router.push('/add-account')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  list: { gap: 8 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 16, paddingHorizontal: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  footer: { paddingTop: 12 },
  headerAction: { color: colors.primary, fontSize: 16 },
});
