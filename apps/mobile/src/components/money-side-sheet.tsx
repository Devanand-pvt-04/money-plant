import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { AccountType } from '@money-plant/core';
import type { LedgerTransaction } from '@money-plant/matcher';
import { accountIcon, accountLabel } from './account-picker';
import { formatAmount, formatDate } from './format';
import { Sheet } from './sheet';
import { radius, useColors, makeStyles } from './ui';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';

/** Money with a person moves through these; funds, deposits and stocks never (decision 0030). */
const MONEY_TYPES: readonly AccountType[] = ['bank', 'credit_card', 'wallet', 'cash'];

export type MoneySide = { type: 'entry'; id: string } | { type: 'account'; id: string } | { type: 'later' };

/**
 * Where a loan or repayment's money went (decision 0030): "It'll come by SMS"
 * first, then entries already in the ledger that fit, then the user's banks,
 * cards, wallets and cash.
 */
export function MoneySideSheet(props: {
  visible: boolean;
  title: string;
  /** "Into one of your accounts" or "From one of your accounts". */
  subtitle: string;
  candidates: readonly LedgerTransaction[];
  /** The amount being recorded; candidates are entries of this amount. */
  amountLabel: string;
  selected: MoneySide;
  onPick: (side: MoneySide, account: AccountBalance | null) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useStyles();
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);

  useEffect(() => {
    if (props.visible) listAccountBalances().then((all) => setAccounts(all.filter((b) => MONEY_TYPES.includes(b.account.type))));
  }, [props.visible]);

  const tick = <Feather name="check" size={18} color={colors.primary} />;
  const isOn = (side: MoneySide) => side.type === props.selected.type && (side.type === 'later' || (props.selected.type !== 'later' && side.id === props.selected.id));

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.subtitle}>{props.subtitle}</Text>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: isOn({ type: 'later' }) }}
          onPress={() => props.onPick({ type: 'later' }, null)}
          style={({ pressed }) => [styles.sms, isOn({ type: 'later' }) && styles.smsOn, pressed && styles.pressed]}
        >
          <View style={[styles.icon, styles.smsIcon]}>
            <Feather name="message-square" size={17} color={colors.primary} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.name}>It'll come by SMS</Text>
            <Text style={styles.meta}>Linked when the bank message arrives, never counted twice</Text>
          </View>
          {isOn({ type: 'later' }) && tick}
        </Pressable>

        {props.candidates.length > 0 && (
          <>
            <Text style={styles.section}>Already in your ledger</Text>
            <View style={styles.card}>
              {props.candidates.map((tx, i) => {
                const side: MoneySide = { type: 'entry', id: tx.id };
                return (
                  <Pressable
                    key={tx.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isOn(side) }}
                    onPress={() => props.onPick(side, null)}
                    style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                  >
                    <View style={styles.grow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {tx.counterparty ?? 'Payment'}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {formatDate(tx.occurredAt)}
                      </Text>
                    </View>
                    <Text style={styles.amount}>{props.amountLabel}</Text>
                    {isOn(side) && tick}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {accounts.length > 0 && (
          <>
            <Text style={styles.section}>{props.candidates.length > 0 ? 'Or add it to' : 'Add it to'}</Text>
            <View style={styles.card}>
              {accounts.map((b, i) => {
                const side: MoneySide = { type: 'account', id: b.account.id };
                return (
                  <Pressable
                    key={b.account.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isOn(side) }}
                    onPress={() => props.onPick(side, b)}
                    style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                  >
                    <View style={styles.icon}>
                      <Feather name={accountIcon(b.account.type)} size={16} color={colors.secondary} />
                    </View>
                    <View style={styles.grow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {accountLabel(b.account)}
                      </Text>
                      <Text style={styles.meta}>{b.typeLabel}</Text>
                    </View>
                    {isOn(side) ? tick : <Text style={styles.balance}>{formatAmount(b.balance, b.account.currency)}</Text>}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
        <Text style={styles.hint}>Adding it to an account puts the payment in your ledger now. Funds, deposits and stocks aren't listed: money with a person doesn't move through them.</Text>
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingBottom: 8 },
  subtitle: { fontSize: 13, color: colors.muted, marginHorizontal: 4, marginTop: -6, marginBottom: 12 },
  sms: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  smsOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  smsIcon: { backgroundColor: colors.background },
  section: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 16, marginBottom: 6, marginHorizontal: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  balance: { fontSize: 13, color: colors.muted, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 12, marginHorizontal: 4 },
}));
