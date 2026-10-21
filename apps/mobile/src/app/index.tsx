import { useCallback, useState } from 'react';
import { AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { ACCOUNT_TYPE_LABELS, formatRupees } from '@money-plant/core';
import { Button, ErrorText, colors } from '@/components/ui';
import { hasImportedInbox, importInbox } from '@/lib/capture';
import { countPending, listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { signOut } from '@/lib/session';
import { syncNow } from '@/lib/sync';
import { useLedger } from '@/lib/use-ledger';
import { hasSmsPermission, isSmsReaderAvailable } from '../../modules/sms-reader';

async function loadHome() {
  const [balances, pending, imported] = await Promise.all([listAccountBalances(), countPending(), hasImportedInbox()]);
  return { balances, pending, imported };
}

export default function Home() {
  const { data, reload } = useLedger(loadHome, { balances: [] as AccountBalance[], pending: 0, imported: true });
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      // Catch up on SMS that arrived while the receiver couldn't run, then sync.
      if (isSmsReaderAvailable && hasSmsPermission() && (await hasImportedInbox())) await importInbox();
      await syncNow();
      setError(null);
    } catch (e) {
      setError(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
      reload();
    }
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => subscription.remove();
    }, [refresh]),
  );

  const smsReady = !isSmsReaderAvailable || (hasSmsPermission() && data.imported);

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
        data={data.balances}
        keyExtractor={(item) => item.account.id}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {!smsReady && (
              <Pressable style={styles.callout} onPress={() => router.push('/capture')}>
                <Text style={styles.calloutTitle}>Read your bank SMS</Text>
                <Text style={styles.calloutText}>
                  Money Plant can fill your ledger from ICICI, HDFC, HSBC and SBI messages. The text stays on this phone.
                </Text>
              </Pressable>
            )}
            {data.pending > 0 && (
              <Pressable style={styles.callout} onPress={() => router.push('/review')}>
                <Text style={styles.calloutTitle}>{data.pending} to review</Text>
                <Text style={styles.calloutText}>Entries the app wasn't sure about. Confirm or fix them.</Text>
              </Pressable>
            )}
            <View style={styles.links}>
              <View style={styles.link}>
                <Button title="Transactions" variant="secondary" onPress={() => router.push('/transactions')} />
              </View>
              <View style={styles.link}>
                <Button title="Bank SMS" variant="secondary" onPress={() => router.push('/capture')} />
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No accounts yet. Read your bank SMS, or add accounts, cards and cash by hand.</Text>
        }
        renderItem={({ item }) => <AccountRow item={item} />}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <View style={styles.footer}>
        <Button title="Add account" onPress={() => router.push('/add-account')} />
      </View>
    </View>
  );
}

function AccountRow({ item }: { item: AccountBalance }) {
  const { account, balance, reconciliation } = item;
  return (
    <Pressable onPress={() => router.push(`/account/${account.id}`)} style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{account.name}</Text>
        <Text style={styles.meta}>
          {ACCOUNT_TYPE_LABELS[account.type]}
          {account.institution ? ` · ${account.institution}` : ''}
          {account.last4 ? ` · ••${account.last4}` : ''}
        </Text>
        {reconciliation?.flagged && (
          <Text style={styles.gap}>Off from the bank by {formatRupees(reconciliation.latest.gap)}</Text>
        )}
      </View>
      <Text style={styles.amount}>{formatRupees(balance)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  list: { gap: 8, paddingBottom: 8 },
  header: { gap: 8, marginBottom: 4 },
  links: { flexDirection: 'row', gap: 8 },
  link: { flex: 1 },
  callout: { padding: 16, borderRadius: 12, backgroundColor: colors.warningSurface },
  calloutTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  calloutText: { fontSize: 14, color: colors.muted, marginTop: 4 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 16, paddingHorizontal: 24, marginTop: 48 },
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
  gap: { fontSize: 13, color: colors.warning, marginTop: 4 },
  amount: { fontSize: 16, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  footer: { paddingTop: 12 },
  headerAction: { color: colors.primary, fontSize: 16 },
});
