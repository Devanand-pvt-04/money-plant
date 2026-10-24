import type { ComponentProps } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatRupees } from '@money-plant/core';
import { Button, Card, Chip, Chips, SectionTitle, colors } from '@/components/ui';
import { listAccountBalances, netWorth, type AccountBalance } from '@/lib/ledger';
import { signOut } from '@/lib/session';
import { setThemePreference, themePreference, type ThemePreference } from '@/lib/theme';
import { useLedger } from '@/lib/use-ledger';

const THEMES: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'Same as phone' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/** Accounts, net worth so far, and the settings that shape the ledger. */
export default function Money() {
  const { data: balances } = useLedger(listAccountBalances, [] as AccountBalance[]);
  const theme = themePreference();
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.meta}>Net worth so far</Text>
        <Text style={styles.heroAmount}>{formatRupees(netWorth(balances))}</Text>
      </View>

      <SectionTitle>Accounts</SectionTitle>
      {balances.length === 0 ? (
        <Text style={styles.meta}>No accounts yet. Read your bank SMS, or add accounts, cards and cash by hand.</Text>
      ) : (
        <Card>
          {balances.map((item, i) => (
            <AccountRow key={item.account.id} item={item} first={i === 0} />
          ))}
        </Card>
      )}
      <Button title="Add account" variant="secondary" onPress={() => router.push('/add-account')} />

      <SectionTitle>Appearance</SectionTitle>
      <Chips>
        {THEMES.map((t) => (
          <Chip key={t.key} label={t.label} selected={theme === t.key} onPress={() => setThemePreference(t.key)} />
        ))}
      </Chips>

      <SectionTitle>Settings</SectionTitle>
      <Card>
        <Link icon="repeat" title="Recurring payments" href="/recurring" first />
        <Link icon="tag" title="Categories" href="/categories" />
        <Link icon="sliders" title="Rules and patterns" href="/rules" />
        <Link icon="layers" title="Account types" href="/account-types" />
        <Link icon="message-square" title="Bank SMS" href="/capture" />
        {Platform.OS === 'android' && <Link icon="smartphone" title="UPI hand-off test" href="/upi-test" />}
      </Card>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}

function AccountRow({ item, first }: { item: AccountBalance; first: boolean }) {
  const { account, balance, reconciliation, typeLabel } = item;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/account/${account.id}`)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={styles.name}>{account.name}</Text>
        <Text style={styles.meta}>
          {typeLabel}
          {account.institution ? ` · ${account.institution}` : ''}
          {account.last4 ? ` ··${account.last4}` : ''}
        </Text>
        {reconciliation?.flagged && <Text style={styles.warn}>Off from the bank by {formatRupees(reconciliation.latest.gap)}</Text>}
      </View>
      <Text style={styles.amount}>{formatRupees(balance)}</Text>
    </Pressable>
  );
}

function Link(props: { icon: ComponentProps<typeof Feather>['name']; title: string; href: Href; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(props.href)}
      style={({ pressed }) => [styles.row, !props.first && styles.divided, pressed && styles.pressed]}
    >
      <Feather name={props.icon} size={18} color={colors.muted} />
      <Text style={[styles.name, styles.grow]}>{props.title}</Text>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  hero: { paddingVertical: 8, gap: 4 },
  heroAmount: { fontSize: 30, fontWeight: '700', color: colors.text, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  grow: { flex: 1 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  warn: { fontSize: 13, color: colors.warning, marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
});
