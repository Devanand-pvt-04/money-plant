import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { addMonths, type MonthKey, type Paise } from '@money-plant/core';
import { BudgetSheet } from '@/components/budget-sheet';
import { formatDate, formatMonth, formatWholeRupees as rupees } from '@/components/format';
import { CategoryIcon } from '@/components/sheet';
import { ProgressBar, SectionTitle, colors, radius } from '@/components/ui';
import { requestNotificationPermission } from '@/lib/notifications';
import { acceptSuggestion, ignoreSuggestion, lastMonth, monthReview, type MonthReview, type ReviewOverspend, type ReviewSuggestion } from '@/lib/review';
import { useLedger } from '@/lib/use-ledger';

const monthName = (month: MonthKey) => formatMonth(month).split(' ')[0]!;
const budgetHref = (id: string, month: MonthKey) => `/budget/${id}?month=${month}` as const;

/**
 * BUD-4: the month review. What was spent against the total budget, what
 * went over and why, what is still uncategorised, and budget changes to
 * accept, edit or ignore. Numbers only until the AI review (milestone 6).
 */
export default function MonthReviewScreen() {
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState<MonthKey>(params.month ?? lastMonth());
  const { data, reload } = useLedger(() => monthReview(month), null as MonthReview | null);
  const [editing, setEditing] = useState<ReviewSuggestion | null>(null);
  useEffect(() => {
    reload();
  }, [month, reload]);

  const latest = month >= lastMonth();
  return (
    <>
      <Stack.Screen options={{ title: `${monthName(month)} review` }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.months}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={8} onPress={() => setMonth(addMonths(month, -1))} style={styles.arrow}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.month}>{formatMonth(month)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
            disabled={latest}
            onPress={() => setMonth(addMonths(month, 1))}
            style={[styles.arrow, latest && styles.disabled]}
          >
            <Feather name="chevron-right" size={22} color={colors.text} />
          </Pressable>
        </View>
        {data && data.month === month && <Body review={data} onEdit={setEditing} onIgnored={reload} />}
      </ScrollView>
      <BudgetSheet
        visible={editing !== null}
        title={`Budget for ${editing?.category.name ?? ''}`}
        note="Applies to every month. You can change one month from the category."
        value={editing?.suggested ?? null}
        onSave={async (limit) => {
          const target = editing!;
          setEditing(null);
          if (limit === null) return;
          await acceptSuggestion(target.categoryId, limit);
          await requestNotificationPermission();
        }}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function Body({ review, onEdit, onIgnored }: { review: MonthReview; onEdit: (s: ReviewSuggestion) => void; onIgnored: () => void }) {
  const { month } = review;
  const empty = review.spent === 0 && review.income === 0;
  if (empty) return <Text style={styles.meta}>Nothing was recorded in {formatMonth(month)}.</Text>;
  return (
    <>
      <Headline review={review} />

      {review.overspends.length > 0 ? (
        <>
          <SectionTitle>What went over</SectionTitle>
          {review.overspends.map((o) => (
            <OverspendCard key={o.categoryId} overspend={o} month={month} />
          ))}
        </>
      ) : (
        <>
          <SectionTitle>Where it went</SectionTitle>
          {review.budget !== null && <Text style={styles.meta}>Every budget stayed within its limit.</Text>}
          {review.biggest.map(({ category, spent }) => (
            <Pressable
              key={category.id}
              accessibilityRole="button"
              onPress={() => router.push(budgetHref(category.id, month))}
              style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}
            >
              <CategoryIcon categoryKey={category.key} />
              <Text style={[styles.name, styles.grow]} numberOfLines={1}>
                {category.name}
              </Text>
              <Text style={styles.amount}>{rupees(spent)}</Text>
            </Pressable>
          ))}
        </>
      )}

      {review.uncategorised && (
        <>
          <SectionTitle>Not sorted yet</SectionTitle>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(budgetHref(review.uncategorised!.category.id, month))}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.row}>
              <Feather name="help-circle" size={20} color={colors.warning} />
              <Text style={[styles.name, styles.grow]}>
                {review.uncategorised.count} {review.uncategorised.count === 1 ? 'entry' : 'entries'} without a category
              </Text>
              <Text style={styles.amount}>{rupees(review.uncategorised.amount)}</Text>
            </View>
            <Text style={styles.meta}>
              They count as spending outside your budgets. Pick their categories so this review, and your budgets, show where the money went.
            </Text>
          </Pressable>
        </>
      )}

      {review.suggestions.length > 0 && (
        <>
          <SectionTitle>Suggested changes</SectionTitle>
          <Text style={styles.meta}>From your spending in {monthName(addMonths(month, -2))}, {monthName(addMonths(month, -1))} and {monthName(month)}, rounded up to ₹500.</Text>
          {review.suggestions.map((s) => (
            <SuggestionCard key={s.categoryId} suggestion={s} onEdit={() => onEdit(s)} onIgnored={onIgnored} />
          ))}
        </>
      )}

      {review.moved.length > 0 && (
        <Text style={styles.meta}>
          Not counted as spending: {review.moved.map((m) => `${m.category.name} ${rupees(m.amount)}`).join(', ')}.
        </Text>
      )}
    </>
  );
}

function Headline({ review }: { review: MonthReview }) {
  const kept = review.income - review.spent;
  const status = review.budget === null ? 'ok' : review.inBudgets > review.budget ? 'over' : 'ok';
  return (
    <View style={styles.hero}>
      <Text style={styles.meta}>{review.budget === null ? 'You spent' : 'Spent in your budgets'}</Text>
      <View style={styles.big}>
        <Text style={[styles.bigAmount, status === 'over' && { color: colors.danger }]}>{rupees(review.budget === null ? review.spent : review.inBudgets)}</Text>
        {review.budget !== null && <Text style={styles.meta}>of {rupees(review.budget)}</Text>}
      </View>
      {review.budget !== null && <ProgressBar value={review.inBudgets / review.budget} status={status} />}
      {review.budget !== null && (
        <Text style={styles.heroNote}>
          {review.inBudgets > review.budget
            ? `${rupees(review.inBudgets - review.budget)} over your total budget.`
            : `${rupees(review.budget - review.inBudgets)} under your total budget.`}
          {review.outside > 0 ? ` Another ${rupees(review.outside)} went outside your budgets.` : ''}
        </Text>
      )}
      <View style={styles.stats}>
        <Stat label="Money in" amount={review.income} />
        <Stat label="Spent" amount={review.spent} />
        <Stat label={kept >= 0 ? 'Kept' : 'Spent more than came in'} amount={Math.abs(kept) as Paise} tone={kept >= 0 ? 'good' : 'bad'} />
      </View>
    </View>
  );
}

function Stat({ label, amount, tone }: { label: string; amount: Paise; tone?: 'good' | 'bad' }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.statAmount, tone === 'good' && { color: colors.primary }, tone === 'bad' && { color: colors.danger }]}>{rupees(amount)}</Text>
    </View>
  );
}

function OverspendCard({ overspend: o, month }: { overspend: ReviewOverspend; month: MonthKey }) {
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" onPress={() => router.push(budgetHref(o.categoryId, month))} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <CategoryIcon categoryKey={o.category.key} />
        <View style={styles.grow}>
          <Text style={styles.name} numberOfLines={1}>
            {o.category.name}
          </Text>
          <Text style={styles.meta}>
            {rupees(o.spent)} of {rupees(o.limit)}
            {o.average > 0 ? ` · usually ${rupees(o.average)}` : ''}
          </Text>
        </View>
        <Text style={styles.over}>{rupees(o.over)} over</Text>
      </Pressable>
      {o.payees.map((p) => (
        <View key={p.merchant} style={styles.line}>
          <Text style={styles.lineText} numberOfLines={1}>
            {p.merchant} · {p.count}×
          </Text>
          <Text style={styles.lineAmount}>{rupees(p.amount)}</Text>
        </View>
      ))}
      {o.largest.length > 0 && <Text style={styles.subhead}>Largest entries</Text>}
      {o.largest.map((item) => (
        <Pressable
          key={item.transactionId}
          accessibilityRole="button"
          onPress={() => router.push(`/transaction/${item.transactionId}`)}
          style={({ pressed }) => [styles.line, pressed && styles.pressed]}
        >
          <Text style={styles.lineText} numberOfLines={1}>
            {item.counterparty ?? 'Unknown'} · {formatDate(item.occurredAt)}
          </Text>
          <Text style={styles.lineAmount}>{rupees(item.amount)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function reason(s: ReviewSuggestion): string {
  if (s.kind === 'raise') return 'Over budget in at least 2 of the last 3 months.';
  if (s.kind === 'lower') return `Under ${rupees(Math.round(s.current! * 0.75))} in each of the last 3 months.`;
  return 'No budget yet, and it is one of your larger categories.';
}

function SuggestionCard({ suggestion: s, onEdit, onIgnored }: { suggestion: ReviewSuggestion; onEdit: () => void; onIgnored: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <CategoryIcon categoryKey={s.category.key} />
        <View style={styles.grow}>
          <Text style={styles.name} numberOfLines={1}>
            {s.category.name}
          </Text>
          <Text style={styles.meta}>{reason(s)}</Text>
        </View>
        <Text style={styles.amount}>
          {s.current !== null && <Text style={styles.of}>{rupees(s.current)} → </Text>}
          {rupees(s.suggested)}
        </Text>
      </View>
      <View style={styles.choices}>
        <Choice
          label={busy ? 'Saving…' : s.current === null ? 'Set budget' : 'Accept'}
          primary
          onPress={async () => {
            setBusy(true);
            await acceptSuggestion(s.categoryId, s.suggested);
            await requestNotificationPermission();
          }}
        />
        <Choice label="Edit" onPress={onEdit} />
        <Choice label="Ignore" onPress={() => void ignoreSuggestion(s).then(onIgnored)} />
      </View>
    </View>
  );
}

function Choice({ label, primary, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.choice, primary && styles.choicePrimary, pressed && styles.pressed]}>
      <Text style={[styles.choiceText, primary && styles.choiceTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  months: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  month: { fontSize: 16, fontWeight: '600', color: colors.text, minWidth: 140, textAlign: 'center' },
  hero: { padding: 16, borderRadius: 20, backgroundColor: colors.subtle, gap: 10 },
  heroNote: { fontSize: 14, color: colors.text, lineHeight: 20 },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  bigAmount: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', gap: 10, marginTop: 4 },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statLabel: { fontSize: 12, color: colors.muted },
  statAmount: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  card: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8 },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  amount: { fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  of: { color: colors.muted, fontWeight: '400' },
  over: { fontSize: 14, fontWeight: '700', color: colors.warning, fontVariant: ['tabular-nums'] },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingLeft: 46, minHeight: 28, alignItems: 'center' },
  lineText: { fontSize: 13, color: colors.secondary, flex: 1 },
  lineAmount: { fontSize: 13, color: colors.secondary, fontVariant: ['tabular-nums'] },
  subhead: { fontSize: 12, fontWeight: '600', color: colors.muted, paddingLeft: 46, marginTop: 2 },
  choices: { flexDirection: 'row', gap: 8, paddingLeft: 46 },
  choice: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  choicePrimary: { backgroundColor: colors.ink, borderColor: colors.ink },
  choiceText: { fontSize: 13, fontWeight: '600', color: colors.text },
  choiceTextPrimary: { color: colors.onInk },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
});
