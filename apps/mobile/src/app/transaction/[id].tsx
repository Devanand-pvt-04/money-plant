import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatMoney, formatRupees, paise } from '@money-plant/core';
import { describePattern, type Rule } from '@money-plant/categoriser';
import { REVIEW_REASON_LABELS, USER_SET_FIELDS, foreignAmount, isEstimated, type LedgerSource, type UserSetField } from '@money-plant/matcher';
import { AccountPicker } from '@/components/account-picker';
import { EditFieldSheet, ownLeg, type EditField } from '@/components/edit-field-sheet';
import { CategoryIcon, Sheet } from '@/components/sheet';
import { Button, Card, Initial, MoneyCard, colors, figures, radius } from '@/components/ui';
import { formatAmount, formatDateTime, formatDay, formatTime } from '@/components/format';
import { displayAmount, transactionTitle } from '@/components/transaction-item';
import { useCategoryChange } from '@/components/use-category-change';
import { whyLabel } from '@/components/why';
import { confirmEntry, editEntry } from '@/lib/entries';
import { repaymentOptions } from '@/lib/ious';
import { deleteTransaction, getTransaction, splitTransfer, type TransactionRow } from '@/lib/ledger';
import { getRule } from '@/lib/rules-store';
import { useLedger } from '@/lib/use-ledger';

const KIND_LABELS = { expense: 'Money out', income: 'Money in', transfer: 'Transfer', adjustment: 'Adjustment', iou: 'Loan or repayment' } as const;

const FIELD_LABELS: Record<UserSetField, string> = {
  category: 'category',
  counterparty: 'payee',
  amount: 'amount',
  account: 'account',
  occurredAt: 'date',
  note: 'note',
  kind: 'type',
};

const SOURCE_BADGES: Record<string, string> = {
  sms: 'Bank SMS',
  shortcut: 'Bank SMS',
  notification: 'UPI app',
  app_payment: 'Paid in app',
  statement: 'Statement',
  manual: 'Added by you',
};

/**
 * LED-2, LED-8, CAT-6 (decision 0015): an entry on a money card, then one line
 * per field (each opens a sheet for just that field), the things to do with
 * it, and a short history of where it came from and who changed what.
 */
export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: row } = useLedger(() => getTransaction(id), null as TransactionRow | null, 'entry');
  const [rule, setRule] = useState<Rule | null>(null);
  const [editing, setEditing] = useState<EditField | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [more, setMore] = useState(false);
  const [details, setDetails] = useState(false);
  const { picker, change } = useCategoryChange();
  // A refund keeps the entry it gives money back for in categoryRuleId (LED-5).
  const refundOf = row?.tx.categoryReason === 'refund' ? row.tx.categoryRuleId : null;
  const ruleId = refundOf ? null : (row?.tx.categoryRuleId ?? null);

  useEffect(() => {
    if (ruleId) getRule(ruleId).then(setRule);
    else setRule(null);
  }, [ruleId]);

  // IOU-4: offer "Paid me back" when someone has an open loan this entry could settle.
  const [repayable, setRepayable] = useState(false);
  const plain = row !== null && (row.tx.kind === 'expense' || row.tx.kind === 'income') && row.tx.postings.length === 2;
  useEffect(() => {
    if (!plain) return setRepayable(false);
    let live = true;
    repaymentOptions(id).then(
      (r) => live && setRepayable(r.options.length > 0),
      () => live && setRepayable(false),
    );
    return () => {
      live = false;
    };
  }, [id, plain]);

  if (!row) return null;
  const { tx } = row;
  // A refund is money in that sits on a spending category.
  const flow = tx.kind === 'income' && !refundOf ? 'income' : 'expense';
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
  const accounts = [...row.legs].sort((a, b) => a.amount - b.amount).map((leg) => leg.accountName).join(' → ') || 'Paid by someone else';
  // SPL-1: a split has legs for people besides the category; its category is changed in the split editor.
  const split = tx.postings.length > 2 && tx.kind === 'expense';
  const twoLegs = tx.postings.length === 2;
  const own = ownLeg(row);
  const foreign = foreignAmount(tx);
  const firstSource = [...tx.sources].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0];
  const badge = firstSource ? (SOURCE_BADGES[firstSource.kind] ?? 'Added') : null;
  const canSplit = tx.kind === 'expense' && row.legs.length === 1 && row.legs[0]!.amount < 0;
  const canLend = (tx.kind === 'expense' || tx.kind === 'income') && !split && row.legs.length === 1 && twoLegs;
  const canRecur = tx.kind === 'expense' && row.legs.length === 1;
  const editCategory = () => (split ? router.push(`/expense?from=${tx.id}`) : change(tx.id, flow, tx.counterparty));

  function remove() {
    setMore(false);
    Alert.alert('Remove this entry?', 'It disappears from balances on all your devices. The message will not be imported again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteTransaction(tx.id).then(() => router.back()) },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="More" hitSlop={8} onPress={() => setMore(true)} style={styles.moreButton}>
              <Feather name="more-vertical" size={20} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      {picker}

      <Pressable accessibilityRole="button" accessibilityLabel="Change the payee" disabled={isTransfer} onPress={() => setEditing('payee')}>
        <MoneyCard style={styles.hero}>
          <View style={styles.heroTop}>
            {isTransfer ? (
              <View style={styles.transferIcon}>
                <Feather name="repeat" size={20} color={colors.heroText} />
              </View>
            ) : row.category ? (
              <CategoryIcon category={row.category.look} size={44} />
            ) : (
              <Initial name={transactionTitle(row)} size={44} />
            )}
            <View style={styles.grow}>
              <Text style={styles.heroTitle} numberOfLines={2}>
                {transactionTitle(row)}
              </Text>
              <Text style={styles.heroMuted} numberOfLines={1}>
                {isTransfer ? accounts : own ? `${own.amount < 0 ? 'From' : 'Into'} ${own.accountName}` : accounts}
              </Text>
            </View>
            {badge && <Text style={styles.badge}>{badge}</Text>}
          </View>
          <Text style={[styles.heroAmount, amount.color === colors.primary && { color: colors.heroAccent }]}>{amount.text}</Text>
          <Text style={styles.heroMuted}>
            {KIND_LABELS[tx.kind]} · {formatDay(tx.occurredAt)}, {formatTime(tx.occurredAt)}
          </Text>
        </MoneyCard>
      </Pressable>

      {tx.status === 'pending' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{tx.reviewReason ? REVIEW_REASON_LABELS[tx.reviewReason] : 'Waiting for review'}</Text>
          <Button title="Confirm" onPress={() => confirmEntry(tx.id)} />
        </View>
      )}

      <Card>
        {!isTransfer && (
          <Line
            label="Category"
            value={row.category?.name ?? 'Pick a category'}
            warn={!row.category}
            note={row.category && why ? `${why}${ruleText ? `: ${ruleText}` : ''}` : undefined}
            onPress={editCategory}
            first
          />
        )}
        {refundOf && <Line label="Refund of" value="The earlier payment" icon="chevron-right" onPress={() => router.push(`/transaction/${refundOf}`)} />}
        {!isTransfer && <Line label="Payee" value={tx.counterparty?.trim() || transactionTitle(row)} onPress={() => setEditing('payee')} />}
        <Line
          label={isTransfer ? 'From account' : 'Account'}
          value={isTransfer ? accounts : (own?.accountName ?? accounts)}
          first={isTransfer}
          onPress={twoLegs ? () => setPickingAccount(true) : undefined}
        />
        <Line label="When" value={`${formatDay(tx.occurredAt)} · ${formatTime(tx.occurredAt)}`} onPress={() => setEditing('when')} />
        <Line label="Note" value={tx.note ?? 'Add a note'} muted={!tx.note} onPress={() => setEditing('note')} />
        {twoLegs && <Line label="Amount" value={formatAmount(Math.abs(own?.amount ?? 0), own?.currency)} onPress={() => setEditing('amount')} />}
        {foreign && (
          // CAP-10: the bank sent a foreign amount; the rupee figure is the day's rate until the statement arrives.
          <Line
            label={isEstimated(tx) ? 'Paid abroad, estimated rate' : 'Paid abroad'}
            value={formatAmount(foreign.amount, foreign.currency)}
          />
        )}
      </Card>

      {(canSplit || split || canRecur || canLend) && (
        <View style={styles.actions}>
          {(canSplit || split) && <Action icon="users" title={split ? 'Change split' : 'Split'} onPress={() => router.push(`/expense?from=${tx.id}`)} />}
          {canRecur && <Action icon="repeat" title="Recurring" onPress={() => router.push(`/recurring/new?from=${tx.id}`)} />}
          {canLend && <Action icon="corner-up-right" title={row.legs[0]!.amount < 0 ? 'I lent it' : 'I borrowed it'} onPress={() => router.push(`/iou/new?from=${tx.id}`)} />}
          {canLend && repayable && (
            <Action icon="corner-down-left" title={row.legs[0]!.amount > 0 ? 'Paid me back' : 'I paid back'} onPress={() => router.push(`/iou/repay?from=${tx.id}`)} />
          )}
        </View>
      )}

      <Text style={styles.section}>HISTORY</Text>
      <View style={styles.timeline}>
        {[...tx.sources]
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
          .map((s) => (
            <SourceStep key={s.id} source={s} />
          ))}
        {why && !isTransfer && <Step icon="tag" title={`Category: ${why.charAt(0).toLowerCase()}${why.slice(1)}`} detail={ruleText || undefined} />}
        {userSet.length > 0 && <Step icon="edit-3" title={`You set the ${userSet.join(', ')}`} detail="Automation won't change what you set" last />}
      </View>

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.detailsToggle}>
        <Text style={styles.detailsText}>{details ? 'Hide' : 'Show'} postings · confidence {Math.round(tx.confidence * 100)}%</Text>
        <Feather name={details ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </Pressable>
      {details && (
        <Card style={styles.postings}>
          {tx.postings.map((p) => (
            <View key={p.id} style={styles.posting}>
              <Text style={styles.postingText}>{row.accountNames[p.accountId]}</Text>
              <Text style={styles.postingAmount}>{formatMoney(p.amount, p.currency ?? 'INR')}</Text>
            </View>
          ))}
        </Card>
      )}

      <EditFieldSheet row={row} field={editing} onClose={() => setEditing(null)} />
      <AccountPicker
        visible={pickingAccount}
        title={isTransfer ? 'From account' : 'Account'}
        onPick={(picked) => {
          setPickingAccount(false);
          editEntry(tx.id, { accountId: picked.account.id }).catch((e) => Alert.alert("Couldn't change the account", String(e?.message ?? e)));
        }}
        onClose={() => setPickingAccount(false)}
      />
      <Sheet visible={more} onClose={() => setMore(false)}>
        {isTransfer && (
          <MenuItem
            icon="git-branch"
            title="Not a transfer: split it"
            onPress={() => {
              setMore(false);
              splitTransfer(tx.id).then(() => router.back(), (e) => Alert.alert("Couldn't split", String(e?.message ?? e)));
            }}
          />
        )}
        <MenuItem icon="trash-2" title="Remove entry" danger onPress={remove} />
      </Sheet>
    </ScrollView>
  );
}

type FeatherName = React.ComponentProps<typeof Feather>['name'];

function Line(props: { label: string; value: string; note?: string; muted?: boolean; warn?: boolean; first?: boolean; icon?: FeatherName; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole={props.onPress ? 'button' : undefined}
      accessibilityLabel={props.onPress ? `${props.label}: ${props.value}. Change` : undefined}
      disabled={!props.onPress}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <Text style={styles.lineLabel}>{props.label}</Text>
      <View style={styles.grow}>
        <Text style={[styles.rowValue, props.muted && styles.mutedValue, props.warn && styles.warnValue]}>{props.value}</Text>
        {props.note && <Text style={styles.small}>{props.note}</Text>}
      </View>
      {props.onPress && <Feather name={props.icon ?? 'edit-2'} size={15} color={colors.muted} />}
    </Pressable>
  );
}

function Action({ icon, title, onPress }: { icon: FeatherName; title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Feather name={icon} size={16} color={colors.text} />
      <Text style={styles.actionText} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

function MenuItem({ icon, title, danger, onPress }: { icon: FeatherName; title: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
      <Feather name={icon} size={20} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.menuText, danger && { color: colors.danger }]}>{title}</Text>
    </Pressable>
  );
}

function Step({ icon, title, detail, last, children }: { icon: FeatherName; title: string; detail?: string; last?: boolean; children?: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={styles.stepDot}>
          <Feather name={icon} size={12} color={colors.primary} />
        </View>
        {!last && <View style={styles.stepLine} />}
      </View>
      <View style={[styles.grow, styles.stepBody]}>
        <Text style={styles.stepTitle}>{title}</Text>
        {detail && <Text style={styles.small}>{detail}</Text>}
        {children}
      </View>
    </View>
  );
}

/** Where the entry came from. Tapping an SMS shows what it said; its text never leaves the phone. */
function SourceStep({ source }: { source: LedgerSource }) {
  const [open, setOpen] = useState(false);
  const fields = source.parsedFields as { template?: string; reference?: string | null; amount?: number; counterparty?: string | null };
  const title =
    source.kind === 'sms' || source.kind === 'shortcut'
      ? `${source.sender ? `${source.sender} ` : 'Bank '}SMS read`
      : source.kind === 'notification'
        ? `${source.sender ?? 'App'} notification read`
        : source.kind === 'manual'
          ? 'You added it'
          : source.kind === 'statement'
            ? 'From a bank statement'
            : `From ${source.kind.replace(/_/g, ' ')}`;
  const detail = [
    formatDateTime(source.receivedAt),
    source.kind === 'sms' ? 'the text stays on this phone' : null,
    source.kind !== 'manual' ? `${Math.round(source.confidence * 100)}% sure` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const expandable = source.kind !== 'manual';
  return (
    <Pressable accessibilityRole={expandable ? 'button' : undefined} accessibilityState={expandable ? { expanded: open } : undefined} disabled={!expandable} onPress={() => setOpen(!open)}>
      <Step icon={source.kind === 'manual' ? 'plus' : 'message-circle'} title={title} detail={detail}>
        {open && (
          <View style={styles.sourceMore}>
            {/* LED-8: what the message said, even after the user edited the entry. */}
            <Text style={styles.small}>
              Read as {typeof fields.amount === 'number' ? formatRupees(paise(fields.amount)) : '?'}
              {fields.counterparty ? ` · ${fields.counterparty}` : ''}
              {fields.template ? ` · by ${fields.template}` : ''}
              {fields.reference ? ` · ref ${fields.reference}` : ''}
            </Text>
            {source.rawText && (
              <Text selectable style={styles.raw}>
                {source.rawText}
              </Text>
            )}
          </View>
        )}
      </Step>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48, gap: 14 },
  moreButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  hero: { gap: 10 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  transferIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.heroTrack, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 17, fontWeight: '600', color: colors.heroText },
  heroMuted: { fontSize: 13, color: colors.heroMuted, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '600', color: colors.heroAccent, backgroundColor: colors.heroPill, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  heroAmount: { fontSize: 40, fontWeight: '700', letterSpacing: -1, color: colors.heroText, ...figures },
  small: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  banner: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.warningSurface, gap: 12 },
  bannerText: { fontSize: 14, fontWeight: '500', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1, minWidth: 0 },
  lineLabel: { width: 76, fontSize: 13, color: colors.muted },
  rowValue: { fontSize: 15, fontWeight: '500', color: colors.text },
  mutedValue: { fontWeight: '400', color: colors.muted },
  warnValue: { color: colors.warning, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionText: { fontSize: 13, fontWeight: '600', color: colors.text },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.3, marginTop: 4 },
  timeline: { paddingLeft: 2 },
  step: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center', width: 24 },
  stepDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, width: 2, minHeight: 12, backgroundColor: colors.divider, marginVertical: 2 },
  stepBody: { paddingBottom: 14 },
  stepTitle: { fontSize: 14, fontWeight: '500', color: colors.text, marginTop: 2 },
  sourceMore: { marginTop: 6, gap: 6 },
  raw: { fontSize: 13, color: colors.text, lineHeight: 19, padding: 10, borderRadius: radius.sm, backgroundColor: colors.subtle },
  detailsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  detailsText: { fontSize: 13, color: colors.muted },
  postings: { padding: 16, gap: 8 },
  posting: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  postingText: { fontSize: 14, color: colors.text, flex: 1 },
  postingAmount: { fontSize: 14, color: colors.text, ...figures },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 4 },
  menuText: { fontSize: 15, fontWeight: '500', color: colors.text },
});
