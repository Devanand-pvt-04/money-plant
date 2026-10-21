import { FlatList, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors } from '@/components/ui';
import { TransactionItem } from '@/components/transaction-item';
import { listTransactions, type TransactionRow } from '@/lib/ledger';
import { useLedger } from '@/lib/use-ledger';

export default function Transactions() {
  const { account } = useLocalSearchParams<{ account?: string }>();
  const { data } = useLedger(() => listTransactions({ accountId: account }), [] as TransactionRow[]);
  return (
    <FlatList
      data={data}
      keyExtractor={(row) => row.tx.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No entries yet.</Text>}
      renderItem={({ item }) => <TransactionItem row={item} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  empty: { textAlign: 'center', color: colors.muted, fontSize: 16, marginTop: 48 },
});
