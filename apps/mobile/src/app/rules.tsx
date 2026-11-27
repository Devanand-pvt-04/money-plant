import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { formatMoney, type CurrencyCode } from '@money-plant/core';
import { patternParts, type PatternMatch, type Rule, type RuleMatch } from '@money-plant/categoriser';
import { MoneyCard, figures, makeStyles, radius, useColors } from '@/components/ui';
import { flatten, listCategories } from '@/lib/categories';
import { homeCurrency } from '@/lib/home-currency';
import { listAccountBalances } from '@/lib/ledger';
import { listRules } from '@/lib/rules-store';
import { useLedger } from '@/lib/use-ledger';

type FeatherName = ComponentProps<typeof Feather>['name'];
type Tab = 'rule' | 'pattern';

interface Item {
  rule: Rule;
  title: string;
  /** The category, shown under a rule's payee. */
  subtitle: string | null;
  chips: { icon?: FeatherName; label: string }[];
  /** Sort key inside a group. */
  order: string;
}

interface Group {
  name: string;
  items: Item[];
}

interface Data {
  rules: Rule[];
  groups: Record<Tab, Group[]>;
}

/** "kpclean" → "Kpclean", "abhinandan kada" → "Abhinandan Kada": rules store merchant names lowercased. */
const titleCase = (text: string) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function ruleItem(rule: Rule & { match: RuleMatch }, category: string, currency: CurrencyCode): Omit<Item, 'order'> {
  const { match } = rule;
  const money = (n: number) => formatMoney(n, currency).replace(/\.00$/, '');
  const title = match.merchant ? titleCase(match.merchant) : match.vpa ? match.vpa : `Names with "${match.keyword}"`;
  const chips: Item['chips'] = [];
  if (match.vpa && match.merchant) chips.push({ icon: 'at-sign', label: match.vpa });
  if (match.keyword && (match.merchant || match.vpa)) chips.push({ icon: 'search', label: `Contains "${match.keyword}"` });
  if (match.minAmount !== undefined && match.maxAmount !== undefined) chips.push({ label: `${money(match.minAmount)} to ${money(match.maxAmount)}` });
  else if (match.minAmount !== undefined) chips.push({ label: `${money(match.minAmount)} or more` });
  else if (match.maxAmount !== undefined) chips.push({ label: `Up to ${money(match.maxAmount)}` });
  else chips.push({ label: 'Any amount' });
  chips.push({ label: match.direction === 'credit' ? 'Money in' : match.direction === 'debit' ? 'Money out' : 'In or out' });
  return { rule, title, subtitle: category, chips };
}

function patternItem(rule: Rule & { match: PatternMatch }, category: string, account: { name: string; currency: CurrencyCode } | null): Omit<Item, 'order'> {
  const parts = patternParts(rule.match, account);
  const chips: Item['chips'] = [
    { icon: 'clock', label: parts.time },
    { icon: 'calendar', label: parts.days },
    { label: parts.amount },
  ];
  if (parts.payee) chips.push({ label: parts.payee });
  if (parts.account) chips.push({ label: parts.account });
  return { rule, title: category, subtitle: null, chips };
}

async function load(): Promise<Data> {
  const [all, tree, balances] = await Promise.all([listRules(), listCategories(), listAccountBalances()]);
  const categories = new Map(flatten(tree).map((c) => [c.id, c]));
  const accounts = new Map(balances.map((b) => [b.account.id, { name: b.account.name, currency: b.account.currency }]));
  const currency = homeCurrency();
  const rules = all.filter((r) => r.status === 'active' || r.status === 'paused');
  const groups: Record<Tab, Map<string, Group>> = { rule: new Map(), pattern: new Map() };
  for (const rule of rules) {
    const category = categories.get(rule.categoryId);
    const parent = category?.parentId ? categories.get(category.parentId) : undefined;
    const groupName = parent?.name ?? category?.name ?? 'Deleted category';
    const name = category?.name ?? 'Deleted category';
    const item: Item =
      rule.match.kind === 'pattern'
        ? { ...patternItem(rule as Rule & { match: PatternMatch }, name, rule.match.accountId ? (accounts.get(rule.match.accountId) ?? null) : null), order: String(rule.match.startMinute).padStart(4, '0') }
        : { ...ruleItem(rule as Rule & { match: RuleMatch }, name, currency), order: '' };
    if (item.order === '') item.order = item.title.toLowerCase();
    const tab = groups[rule.match.kind];
    const group = tab.get(groupName) ?? { name: groupName, items: [] };
    group.items.push(item);
    tab.set(groupName, group);
  }
  const sorted = (map: Map<string, Group>) =>
    [...map.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.order.localeCompare(b.order)) }));
  return { rules, groups: { rule: sorted(groups.rule), pattern: sorted(groups.pattern) } };
}

const EMPTY: Record<Tab, string> = {
  rule: 'No rules yet. When you change the category of a payment, the app offers to always do the same for that payee.',
  pattern: 'No patterns yet. When you sort about three similar payments the same way (same time of day, amount and account), the app suggests one in Review.',
};

const EXPLAIN: Record<Tab, string> = {
  rule: 'Same payee, same category, every time. A rule always wins over a pattern.',
  pattern: 'Learned when you sort 3 similar payments the same way. When your habit shifts a little, Review offers to widen the pattern.',
};

/** CAT-7: every rule and learned pattern, grouped by category, with how often each was kept or changed (decision 0037). */
export default function Rules() {
  const styles = useStyles();
  const { data } = useLedger(load, { rules: [], groups: { rule: [], pattern: [] } } as Data);
  const [picked, setPicked] = useState<Tab | null>(null);
  const counts = { rule: data.rules.filter((r) => r.match.kind === 'rule').length, pattern: data.rules.filter((r) => r.match.kind === 'pattern').length };
  const tab: Tab = picked ?? (counts.rule === 0 && counts.pattern > 0 ? 'pattern' : 'rule');
  const kept = data.rules.reduce((sum, r) => sum + r.hits, 0);
  const changed = data.rules.reduce((sum, r) => sum + r.misses, 0);
  const groups = data.groups[tab];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <MoneyCard>
        <Text style={styles.heroLabel}>Sorted for you so far</Text>
        <View style={styles.stats}>
          <Stat value={kept + changed} label="entries" />
          <Stat value={kept} label="kept as is" tone="good" />
          <Stat value={changed} label="you changed" tone="warn" />
        </View>
      </MoneyCard>

      <View style={styles.tabs} accessibilityRole="tablist">
        {(['rule', 'pattern'] as const).map((t) => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            onPress={() => setPicked(t)}
            style={[styles.tab, tab === t && styles.tabSelected]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextSelected]}>
              {t === 'rule' ? 'Rules' : 'Patterns'} · {counts[t]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.explain}>{EXPLAIN[tab]}</Text>

      {groups.length === 0 && <Text style={styles.explain}>{EMPTY[tab]}</Text>}
      {groups.map((group) => (
        <View key={group.name} style={styles.group}>
          <Text style={styles.groupName}>{group.name}</Text>
          {group.items.map((item) => (
            <RuleCard key={item.rule.id} item={item} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'good' | 'warn' }) {
  const styles = useStyles();
  const colors = useColors();
  const color = tone === 'good' ? colors.heroAccent : tone === 'warn' && value > 0 ? colors.heroWarning : colors.heroText;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
    </View>
  );
}

function RuleCard({ item }: { item: Item }) {
  const styles = useStyles();
  const colors = useColors();
  const { rule } = item;
  const paused = rule.status === 'paused';
  const total = rule.hits + rule.misses;
  const mode = paused ? 'Paused' : rule.autoConfirm ? 'Files by itself' : 'Asks first';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/rule/${rule.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, paused && styles.paused]}
    >
      <View style={styles.head}>
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          {item.subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          )}
        </View>
        <Text style={[styles.mode, !paused && !rule.autoConfirm && styles.modeAsk]}>{mode}</Text>
        <Feather name="chevron-right" size={18} color={colors.muted} />
      </View>
      <View style={styles.chips}>
        {item.chips.map((chip) => (
          <View key={chip.label} style={styles.chip}>
            {chip.icon && <Feather name={chip.icon} size={12} color={colors.secondary} />}
            <Text style={styles.chipText} numberOfLines={1}>
              {chip.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.foot}>
        <View style={styles.bar}>
          {total > 0 && <View style={{ flex: rule.hits, backgroundColor: colors.primary }} />}
          {total > 0 && <View style={{ flex: rule.misses, backgroundColor: colors.warning }} />}
        </View>
        <Text style={styles.stat2}>{total === 0 ? 'Not used yet' : `${rule.hits} kept · ${rule.misses} changed`}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 16, paddingBottom: 48, gap: 12 },
  heroLabel: { fontSize: 13, fontWeight: '500', color: colors.heroMuted },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 26, fontWeight: '700', ...figures },
  tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabSelected: { backgroundColor: colors.primarySurface },
  tabText: { fontSize: 14, fontWeight: '500', color: colors.muted },
  tabTextSelected: { color: colors.primary },
  explain: { fontSize: 13, lineHeight: 19, color: colors.muted, paddingHorizontal: 2 },
  group: { gap: 8, marginTop: 4 },
  groupName: { fontSize: 14, fontWeight: '500', color: colors.muted, marginHorizontal: 4 },
  card: { padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 10 },
  pressed: { backgroundColor: colors.pressed },
  paused: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  subtitle: { fontSize: 13, color: colors.primary, marginTop: 1 },
  mode: { fontSize: 12, color: colors.muted },
  modeAsk: { color: colors.warning },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.subtle, maxWidth: '100%' },
  chipText: { fontSize: 13, color: colors.secondary, flexShrink: 1 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.track, flexDirection: 'row', overflow: 'hidden' },
  stat2: { fontSize: 12, color: colors.muted, ...figures },
}));
