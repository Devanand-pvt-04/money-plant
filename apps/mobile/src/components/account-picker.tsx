import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ACCOUNT_TYPE_LABELS, LIABILITY_TYPES, paise, parseRupees, type AccountType } from '@money-plant/core';
import { createAccount } from '@/lib/accounts';
import { listAccountBalances, type AccountBalance } from '@/lib/ledger';
import { syncNow } from '@/lib/sync';
import { formatAmount } from './format';
import { Sheet } from './sheet';
import { Button, colors, radius } from './ui';

/** The types offered when adding an account from a picker; the full list stays on the Add account screen. */
const QUICK_TYPES: readonly AccountType[] = ['bank', 'cash', 'wallet', 'credit_card'];

export function accountIcon(type: AccountType): React.ComponentProps<typeof Feather>['name'] {
  if (type === 'cash') return 'dollar-sign';
  if (type === 'wallet') return 'smartphone';
  if (type === 'credit_card') return 'credit-card';
  if (type === 'bank') return 'briefcase';
  return 'layers';
}

/** "ICICI Savings ••798". */
export function accountLabel(account: { name: string; last4: string | null }): string {
  return account.last4 && !account.name.includes(account.last4) ? `${account.name} ••${account.last4}` : account.name;
}

/**
 * NAV-2: pick one of the user's accounts, with balances, or add one without
 * leaving the screen. `exclude` hides an account, such as a transfer's other side.
 */
export function AccountPicker(props: {
  visible: boolean;
  title?: string;
  exclude?: readonly string[];
  onPick: (account: AccountBalance) => void;
  onClose: () => void;
}) {
  const { visible, title = 'Account', exclude = [], onPick, onClose } = props;
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (visible) listAccountBalances().then((all) => setAccounts(all.filter((b) => b.account.type !== 'loan')));
    else setCreating(false);
  }, [visible]);

  const shown = accounts.filter((b) => !exclude.includes(b.account.id));

  return (
    <Sheet visible={visible} onClose={onClose} title={creating ? 'New account' : title}>
      {creating ? (
        <NewAccount
          onCancel={() => setCreating(false)}
          onCreated={async (id) => {
            const all = await listAccountBalances();
            const made = all.find((b) => b.account.id === id);
            if (made) onPick(made);
          }}
        />
      ) : (
        <>
          <FlatList
            data={shown}
            keyExtractor={(b) => b.account.id}
            style={styles.list}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => onPick(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View style={styles.icon}>
                  <Feather name={accountIcon(item.account.type)} size={16} color={colors.secondary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{accountLabel(item.account)}</Text>
                  <Text style={styles.meta}>{item.typeLabel}</Text>
                </View>
                <Text style={[styles.balance, item.balance < 0 && styles.owed]}>{formatAmount(item.balance)}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.meta}>No accounts yet.</Text>}
          />
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={({ pressed }) => [styles.create, pressed && styles.pressed]}>
            <Feather name="plus" size={18} color={colors.primary} />
            <Text style={styles.createText}>New account</Text>
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

function NewAccount(props: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState<AccountType>('bank');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [saving, setSaving] = useState(false);
  const liability = LIABILITY_TYPES.has(type);

  async function save() {
    const amount = parseRupees(balance.trim() === '' ? '0' : balance);
    if (amount === null) return Alert.alert('Check the balance', 'Enter it as a number, for example 12,500.50');
    setSaving(true);
    try {
      const id = await createAccount({
        type,
        name: name.trim(),
        institution: null,
        last4: null,
        openingBalance: liability ? paise(-Math.abs(amount)) : amount,
      });
      syncNow().catch(() => {});
      props.onCreated(id);
    } catch (e) {
      setSaving(false);
      Alert.alert("Couldn't add", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.types}>
        {QUICK_TYPES.map((t) => (
          <Pressable
            key={t}
            accessibilityRole="radio"
            accessibilityState={{ selected: t === type }}
            onPress={() => setType(t)}
            style={[styles.type, t === type && styles.typeOn]}
          >
            <Feather name={accountIcon(t)} size={16} color={t === type ? colors.text : colors.muted} />
            <Text style={[styles.typeText, t === type && styles.typeTextOn]}>{ACCOUNT_TYPE_LABELS[t]}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name, like SBI savings"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        maxLength={80}
        autoFocus
      />
      <TextInput
        value={balance}
        onChangeText={setBalance}
        placeholder={liability ? 'Amount you owe now (₹)' : 'Balance now (₹), optional'}
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        keyboardType="decimal-pad"
      />
      <View style={styles.actions}>
        <Button title="Add account" onPress={save} disabled={!name.trim()} loading={saving} />
        <Button title="Back" variant="secondary" onPress={props.onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  balance: { fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  owed: { color: colors.danger },
  create: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
  },
  createText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  form: { gap: 10 },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  type: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeOn: { borderColor: colors.ink, backgroundColor: colors.subtle },
  typeText: { fontSize: 14, color: colors.muted },
  typeTextOn: { color: colors.text, fontWeight: '600' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  actions: { gap: 10, marginTop: 6 },
});
