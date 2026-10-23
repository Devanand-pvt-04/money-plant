import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { describePattern, type Rule } from '@money-plant/categoriser';
import { SectionTitle, colors } from '@/components/ui';
import { categoryNames } from '@/lib/categories';
import { listAccountBalances } from '@/lib/ledger';
import { listRules } from '@/lib/rules-store';
import { useLedger } from '@/lib/use-ledger';

function ruleText(rule: Rule, accountName: (id: string) => string | null): string {
  const { match } = rule;
  if (match.kind === 'pattern') return describePattern(match, match.accountId ? accountName(match.accountId) : null);
  const what = match.vpa ? `UPI ID ${match.vpa}` : match.merchant ? `"${match.merchant}"` : `anything containing "${match.keyword}"`;
  return `${match.direction === 'credit' ? 'Money from' : 'Payments to'} ${what}`;
}

async function load() {
  const [rules, names, balances] = await Promise.all([listRules(), categoryNames(), listAccountBalances()]);
  const accounts = new Map(balances.map((b) => [b.account.id, b.account.name]));
  return { rules: rules.filter((r) => r.status !== 'proposed'), names, accountName: (id: string) => accounts.get(id) ?? null };
}

/** CAT-7: every rule and learned pattern, with how often each was right. */
export default function Rules() {
  const { data } = useLedger(load, { rules: [] as Rule[], names: new Map<string, string>(), accountName: () => null as string | null });
  const rules = data.rules.filter((r) => r.match.kind === 'rule');
  const patterns = data.rules.filter((r) => r.match.kind === 'pattern');

  const list = (items: Rule[], empty: string) =>
    items.length === 0 ? (
      <Text style={styles.empty}>{empty}</Text>
    ) : (
      items.map((rule) => (
        <Pressable key={rule.id} onPress={() => router.push(`/rule/${rule.id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.title}>{ruleText(rule, data.accountName)}</Text>
          <Text style={styles.category}>→ {data.names.get(rule.categoryId) ?? 'Deleted category'}</Text>
          <Text style={styles.meta}>
            {rule.status === 'paused' ? 'Paused · ' : ''}
            {rule.autoConfirm ? 'Confirms directly' : 'Suggests in review'} · right {rule.hits} · corrected {rule.misses}
          </Text>
        </Pressable>
      ))
    );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionTitle>Rules</SectionTitle>
      {list(rules, 'No rules yet. When you change a category, the app offers to always do the same for that merchant.')}
      <SectionTitle>Learned patterns</SectionTitle>
      {list(patterns, 'No patterns yet. After about three similar corrections (same time of day and amount), the app suggests one in Review.')}
      <View style={styles.footer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  row: { padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 },
  pressed: { backgroundColor: '#E3F1E8' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  category: { fontSize: 14, color: colors.primary },
  meta: { fontSize: 13, color: colors.muted },
  empty: { fontSize: 14, color: colors.muted },
  footer: { height: 32 },
});
