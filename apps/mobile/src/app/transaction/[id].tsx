import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { formatRupees, paise } from '@money-plant/core';
import { describePattern, type Rule } from '@money-plant/categoriser';
import { REVIEW_REASON_LABELS, USER_SET_FIELDS, type LedgerSource, type UserSetField } from '@money-plant/matcher';
import { Button, colors } from '@/components/ui';
import { formatDateTime } from '@/components/format';
import { transactionTitle } from '@/components/transaction-item';
import { useCategoryChange } from '@/components/use-category-change';
import { whyLabel } from '@/components/why';
import { confirmEntry } from '@/lib/entries';
import { deleteTransaction, getTransaction, splitTransfer, type TransactionRow } from '@/lib/ledger';
import { getRule } from '@/lib/rules-store';
import { useLedger } from '@/lib/use-ledger';

const KIND_LABELS = { expense: 'Money out', income: 'Money in', transfer: 'Transfer', adjustment: 'Adjustment' } as const;

const FIELD_LABELS: Record<UserSetField, string> = {
  category: 'category',
  counterparty: 'payee',
  amount: 'amount',
  account: 'account',
  occurredAt: 'date',
  note: 'note',
  kind: 'type',
};

/** LED-2: an entry with its postings, sources and confidence. CAT-6: why it has its category. */
export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: row } = useLedger(() => getTransaction(id), null as TransactionRow | null);
  const [rule, setRule] = useState<Rule | null>(null);
  const { picker, change } = useCategoryChange();
  const ruleId = row?.tx.categoryRuleId ?? null;

  useEffect(() => {
    if (ruleId) getRule(ruleId).then(setRule);
    else setRule(null);
  }, [ruleId]);

  if (!row) return null;
  const { tx } = row;
  const flow = tx.kind === 'income' ? 'income' : 'expense';
  const userSet = USER_SET_FIELDS.filter((f) => tx.userSetFields.includes(f)).map((f) => FIELD_LABELS[f]);
  const ruleText =
    rule?.match.kind === 'pattern'
      ? describePattern(rule.match, row.legs[0]?.accountName ?? null)
      : rule?.match.kind === 'rule'
        ? (rule.match.merchant ?? rule.match.vpa ?? rule.match.keyword ?? '')
        : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: KIND_LABELS[tx.kind] }} />
      {picker}
      <Text style={styles.title}>{transactionTitle(row)}</Text>
      <Text style={styles.meta}>
        {formatDateTime(tx.occurredAt)} · {tx.status === 'pending' ? 'to review' : 'confirmed'} · confidence{' '}
        {Math.round(tx.confidence * 100)}%
      </Text>
      {tx.reviewReason && <Text style={styles.reason}>{REVIEW_REASON_LABELS[tx.reviewReason]}</Text>}

      {row.category && (
        <>
          <Text style={styles.section}>Category</Text>
          <View style={styles.card}>
            <Text style={styles.lineText}>{row.category.name}</Text>
            <Text style={styles.meta}>
              {whyLabel(tx, row.aiConfidence)}
              {ruleText ? `: ${ruleText}` : ''}
            </Text>
            <Button title="Change category" variant="secondary" onPress={() => change(tx.id, flow, tx.counterparty)} />
          </View>
        </>
      )}

      {tx.note && (
        <>
          <Text style={styles.section}>Note</Text>
          <Text style={styles.lineText}>{tx.note}</Text>
        </>
      )}
      {userSet.length > 0 && <Text style={styles.meta}>You set the {userSet.join(', ')}; automation won't change it.</Text>}

      <Text style={styles.section}>Postings</Text>
      <View style={styles.card}>
        {tx.postings.map((p) => (
          <View key={p.id} style={styles.line}>
            <Text style={styles.lineText}>{row.accountNames[p.accountId]}</Text>
            <Text style={styles.amount}>{formatRupees(p.amount)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Sources</Text>
      {tx.sources.map((s) => (
        <SourceCard key={s.id} source={s} />
      ))}

      <View style={styles.actions}>
        {tx.status === 'pending' && <Button title="Confirm" onPress={() => confirmEntry(tx.id)} />}
        <Button title="Edit entry" variant="secondary" onPress={() => router.push(`/transaction/edit?id=${tx.id}`)} />
        {tx.kind === 'transfer' && (
          <Button
            title="Not a transfer: split it"
            variant="secondary"
            onPress={() => splitTransfer(tx.id).then(() => router.back(), (e) => Alert.alert("Couldn't split", String(e?.message ?? e)))}
          />
        )}
        <Button
          title="Remove entry"
          variant="secondary"
          onPress={() =>
            Alert.alert('Remove this entry?', 'It disappears from balances on all your devices. The message will not be imported again.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(tx.id).then(() => router.back()) },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}

function SourceCard({ source }: { source: LedgerSource }) {
  const fields = source.parsedFields as { template?: string; reference?: string | null; accountLast?: string | null; amount?: number; counterparty?: string | null };
  return (
    <View style={styles.card}>
      <Text style={styles.lineText}>
        {source.kind === 'sms' ? 'SMS' : source.kind === 'notification' ? 'App notification' : source.kind} from {source.sender ?? 'unknown'}
      </Text>
      <Text style={styles.meta}>
        {formatDateTime(source.receivedAt)} · read by {fields.template ?? 'app'} · {Math.round(source.confidence * 100)}%
        {fields.reference ? ` · ref ${fields.reference}` : ''}
      </Text>
      {/* LED-8: what the message said, even after the user edited the entry. */}
      <Text style={styles.meta}>
        Read as {typeof fields.amount === 'number' ? formatRupees(paise(fields.amount)) : '?'}
        {fields.counterparty ? ` · ${fields.counterparty}` : ''}
      </Text>
      {source.rawText && (
        <Text selectable style={styles.raw}>
          {source.rawText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.muted },
  reason: { fontSize: 14, color: colors.warning },
  section: { fontSize: 14, color: colors.muted, marginTop: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  lineText: { fontSize: 15, color: colors.text, flex: 1 },
  amount: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  raw: { fontSize: 13, color: colors.text, marginTop: 4 },
  actions: { marginTop: 24, gap: 12 },
});
