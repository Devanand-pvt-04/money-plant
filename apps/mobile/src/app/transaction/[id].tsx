import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatRupees, paise } from '@money-plant/core';
import { describePattern, type Rule } from '@money-plant/categoriser';
import { REVIEW_REASON_LABELS, USER_SET_FIELDS, type LedgerSource, type UserSetField } from '@money-plant/matcher';
import { Button, Card, Initial, colors, radius } from '@/components/ui';
import { formatDateTime, formatDay, formatTime } from '@/components/format';
import { displayAmount, transactionTitle } from '@/components/transaction-item';
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

  const amount = displayAmount(row);
  const isTransfer = tx.kind === 'transfer';
  const why = whyLabel(tx, row.aiConfidence);
  const accounts = [...row.legs].sort((a, b) => a.amount - b.amount).map((leg) => leg.accountName).join(' → ');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {picker}
      <View style={styles.hero}>
        <Initial name={transactionTitle(row)} size={56} />
        <Text style={styles.title}>{transactionTitle(row)}</Text>
        <Text style={[styles.heroAmount, { color: isTransfer ? colors.text : amount.color }]}>{amount.text}</Text>
        <Text style={styles.meta}>
          {KIND_LABELS[tx.kind]} · {formatDay(tx.occurredAt)}, {formatTime(tx.occurredAt)}
        </Text>
      </View>

      {tx.status === 'pending' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{tx.reviewReason ? REVIEW_REASON_LABELS[tx.reviewReason] : 'Waiting for review'}</Text>
          <Button title="Confirm" onPress={() => confirmEntry(tx.id)} />
        </View>
      )}

      <Card>
        {row.category && (
          <Row
            label="Category"
            value={row.category.name}
            note={why ? `Why: ${why.charAt(0).toLowerCase()}${why.slice(1)}${ruleText ? `, ${ruleText}` : ''}` : undefined}
            onPress={() => change(tx.id, flow, tx.counterparty)}
            first
          />
        )}
        <Row label={isTransfer ? 'Accounts' : 'Account'} value={accounts} first={!row.category} onPress={() => router.push(`/transaction/edit?id=${tx.id}`)} />
        <Row label="Note" value={tx.note ?? 'Add a note'} muted={!tx.note} onPress={() => router.push(`/transaction/edit?id=${tx.id}`)} />
      </Card>
      {userSet.length > 0 && <Text style={styles.small}>You set the {userSet.join(', ')}; automation won't change it.</Text>}

      {tx.sources.map((s) => (
        <SourceCard key={s.id} source={s} />
      ))}

      <Text style={styles.section}>Postings · confidence {Math.round(tx.confidence * 100)}%</Text>
      <Card style={styles.postings}>
        {tx.postings.map((p) => (
          <View key={p.id} style={styles.line}>
            <Text style={styles.lineText}>{row.accountNames[p.accountId]}</Text>
            <Text style={styles.lineAmount}>{formatRupees(p.amount)}</Text>
          </View>
        ))}
      </Card>

      <View style={styles.actions}>
        <Button title="Edit entry" variant="secondary" onPress={() => router.push(`/transaction/edit?id=${tx.id}`)} />
        {tx.kind === 'expense' && row.legs.length === 1 && (
          <Button title="Track as a recurring payment" variant="secondary" onPress={() => router.push(`/recurring/new?from=${tx.id}`)} />
        )}
        {isTransfer && (
          <Button
            title="Not a transfer: split it"
            variant="secondary"
            onPress={() => splitTransfer(tx.id).then(() => router.back(), (e) => Alert.alert("Couldn't split", String(e?.message ?? e)))}
          />
        )}
        <Pressable
          accessibilityRole="button"
          style={styles.remove}
          onPress={() =>
            Alert.alert('Remove this entry?', 'It disappears from balances on all your devices. The message will not be imported again.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(tx.id).then(() => router.back()) },
            ])
          }
        >
          <Text style={styles.removeText}>Remove entry</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Row(props: { label: string; value: string; note?: string; muted?: boolean; first?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={styles.small}>{props.label}</Text>
        <Text style={[styles.rowValue, props.muted && styles.mutedValue]}>{props.value}</Text>
        {props.note && <Text style={styles.small}>{props.note}</Text>}
      </View>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

function SourceCard({ source }: { source: LedgerSource }) {
  const fields = source.parsedFields as { template?: string; reference?: string | null; accountLast?: string | null; amount?: number; counterparty?: string | null };
  const what = source.kind === 'sms' ? 'an SMS' : source.kind === 'notification' ? 'an app notification' : source.kind === 'manual' ? 'your quick add' : `a ${source.kind}`;
  return (
    <View style={styles.source}>
      <Feather name={source.kind === 'manual' ? 'edit-3' : 'message-circle'} size={18} color={colors.secondary} style={styles.sourceIcon} />
      <View style={styles.grow}>
        <Text style={styles.sourceTitle}>
          From {what}
          {source.sender ? ` by ${source.sender}` : ''}
        </Text>
        <Text style={styles.small}>
          {formatDateTime(source.receivedAt)}
          {source.kind !== 'manual' ? ` · read by ${fields.template ?? 'app'} · ${Math.round(source.confidence * 100)}%` : ''}
          {fields.reference ? ` · ref ${fields.reference}` : ''}
        </Text>
        {/* LED-8: what the message said, even after the user edited the entry. */}
        {source.kind !== 'manual' && (
          <Text style={styles.small}>
            Read as {typeof fields.amount === 'number' ? formatRupees(paise(fields.amount)) : '?'}
            {fields.counterparty ? ` · ${fields.counterparty}` : ''}
          </Text>
        )}
        {source.rawText && (
          <Text selectable style={styles.raw}>
            {source.rawText}
          </Text>
        )}
        {source.kind === 'sms' && <Text style={styles.small}>The SMS text stays on this phone.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  hero: { alignItems: 'center', gap: 4, paddingBottom: 12 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 10, textAlign: 'center' },
  heroAmount: { fontSize: 40, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 13, color: colors.muted },
  small: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  banner: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 12 },
  bannerText: { fontSize: 14, fontWeight: '500', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  rowValue: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 2 },
  mutedValue: { fontWeight: '400', color: colors.muted },
  source: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.subtle },
  sourceIcon: { marginTop: 1 },
  sourceTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  raw: { fontSize: 13, color: colors.text, marginTop: 6, lineHeight: 19 },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 8 },
  postings: { padding: 16, gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineText: { fontSize: 14, color: colors.text, flex: 1 },
  lineAmount: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  actions: { marginTop: 12, gap: 10 },
  remove: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  removeText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
