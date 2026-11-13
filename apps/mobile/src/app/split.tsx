import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { currencyInfo, dateKey, dateOf, formatMoney, paise, parseMoney, type CurrencyCode, type DateKey, type Paise } from '@money-plant/core';
import { splitBill, type LedgerTransaction, type SplitMethod, type SplitRow } from '@money-plant/matcher';
import { DateField } from '@/components/date-fields';
import { formatAmount, formatDate } from '@/components/format';
import { FormScroll, KeyboardGap } from '@/components/keyboard';
import { PeopleSheet } from '@/components/people-sheet';
import { Button, Card, Chip, Chips, ErrorText, Field, Initial, SectionTitle, figures, radius, useColors, makeStyles } from '@/components/ui';
import { homeCurrency } from '@/lib/home-currency';
import { getTransaction } from '@/lib/ledger';
import { listPeople, type Person } from '@/lib/people';
import { createSplit, entriesFitting, listItems } from '@/lib/shared';

const METHODS: { method: SplitMethod; label: string; hint: string }[] = [
  { method: 'equally', label: 'Equally', hint: 'Tick who is in. Any odd paise stay with you.' },
  { method: 'amounts', label: 'Amounts', hint: 'Type what each person owes. Your part is what is left.' },
  { method: 'percent', label: 'Percent', hint: 'Give each person a percent, adding up to 100%.' },
  { method: 'shares', label: 'Shares', hint: 'Give each person a number of shares, like 2 for a couple and 1 for everyone else.' },
  { method: 'adjust', label: 'Adjust', hint: 'Split equally, then add or take off an amount for someone who had more or less.' },
];

const ME = 'me';

/** "12.5" as hundredths of a percent (1250); null when it isn't a percent with at most two decimals. */
function parsePercent(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** "-50" or "+50" as signed minor units. */
function parseSigned(text: string, currency: CurrencyCode): number | null {
  const t = text.trim();
  if (!t || t === '-' || t === '+') return null;
  const negative = t.startsWith('-');
  const v = parseMoney(t.replace(/^[+-]/, ''), currency);
  return v === null ? null : negative ? -v : v;
}

const percentText = (hundredths: number) => `${(hundredths / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

/**
 * Split a bill (decision 0027): the total and what it was for, who's in, and
 * how. Everyone has a row, the user too, and the bar at the bottom always
 * says whether it adds up. `?from=<entry id>` splits one of the user's
 * entries; `?person=<id>` starts with that person in.
 */
export default function SplitBill() {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ from?: string; person?: string }>();
  const [people, setPeople] = useState<Person[]>([]);
  const [recent, setRecent] = useState<Map<string, string>>(new Map());
  const [picked, setPicked] = useState<string[]>(params.person ? [params.person] : []);
  const [picking, setPicking] = useState(false);
  const [fromTx, setFromTx] = useState<{ tx: LedgerTransaction; total: Paise; currency: CurrencyCode; account: string } | null>(null);
  const [totalText, setTotalText] = useState('');
  const [reason, setReason] = useState('');
  const [occurredOn, setOccurredOn] = useState<DateKey>(() => dateKey(new Date()));
  const [method, setMethod] = useState<SplitMethod>('equally');
  const [out, setOut] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<SplitMethod, Record<string, string>>>({ equally: {}, amounts: {}, percent: {}, shares: {}, adjust: {} });
  const [candidates, setCandidates] = useState<LedgerTransaction[]>([]);
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadPeople = useCallback(() => listPeople().then(setPeople), []);

  useEffect(() => {
    (async () => {
      await reloadPeople();
      const latest = new Map<string, string>();
      for (const v of await listItems()) if (v.personId && (latest.get(v.personId) ?? '') < v.occurredOn) latest.set(v.personId, v.occurredOn);
      setRecent(latest);
      if (params.from) {
        const row = await getTransaction(params.from);
        const own = row?.legs[0];
        if (row && own) {
          setFromTx({ tx: row.tx, total: paise(Math.abs(own.amount)), currency: own.currency, account: own.accountName });
          setOccurredOn(dateOf(row.tx.occurredAt));
          if (row.tx.note) setReason(row.tx.note);
        }
      }
      // Nobody in yet: start with picking people.
      if (!params.person) setPicking(true);
    })();
  }, [params.from, params.person, reloadPeople]);

  const currency = fromTx?.currency ?? homeCurrency();
  const symbol = currencyInfo(currency).symbol.trim();
  const typedTotal = parseMoney(totalText, currency);
  const total = fromTx ? fromTx.total : typedTotal === null ? 0 : typedTotal;
  const keys = [ME, ...picked];
  const nameOf = (key: string) => (key === ME ? 'You' : (people.find((p) => p.account.id === key)?.account.name ?? 'Someone'));
  const valueOf = (key: string) => values[method][key] ?? '';
  const setValue = (key: string, text: string) => setValues((now) => ({ ...now, [method]: { ...now[method], [key]: text } }));

  const rows: SplitRow[] = keys.map((key) => {
    const text = valueOf(key);
    switch (method) {
      case 'equally':
        return { in: !out.has(key), value: null };
      case 'adjust':
        return { in: !out.has(key), value: text ? parseSigned(text, currency) : 0 };
      case 'amounts':
        return { in: true, value: parseMoney(text, currency) };
      case 'percent':
        return { in: true, value: parsePercent(text) };
      case 'shares':
        return { in: true, value: text === '' ? 1 : Number(text) };
    }
  });
  const result = splitBill(total, method, rows, 0);
  const others = result.parts.slice(1).reduce((a, b) => a + b, 0);
  const othersIn = result.parts.slice(1).filter((p) => p > 0).length;

  function choose(next: SplitMethod) {
    setMethod(next);
    // Percent starts as an even split, so it already adds up.
    if (next === 'percent' && Object.keys(values.percent).length === 0 && keys.length > 0) {
      const each = Math.floor(10_000 / keys.length);
      const start = Object.fromEntries(keys.map((k, i) => [k, ((i === 0 ? 10_000 - each * (keys.length - 1) : each) / 100).toString()]));
      setValues((now) => ({ ...now, percent: start }));
    }
  }

  // The user's entries that could be the bill, when it isn't split from one.
  useEffect(() => {
    if (fromTx || total <= 0) return setCandidates([]);
    let live = true;
    entriesFitting({ kind: 'share', flow: 'to_them', amount: paise(total), occurredOn, personId: null }).then((found) => live && setCandidates(found.slice(0, 4)));
    return () => {
      live = false;
    };
  }, [fromTx, total, occurredOn]);

  const status = useMemo((): { ok: boolean; text: string } => {
    const money = (n: number) => formatAmount(Math.abs(n), currency);
    switch (result.problem) {
      case null:
        return othersIn === 0 ? { ok: false, text: 'Nobody else owes a part yet' } : { ok: true, text: `Adds up to ${money(total)}` };
      case 'no_total':
        return { ok: false, text: 'Enter the bill total' };
      case 'none_in':
        return { ok: false, text: "Pick who's in" };
      case 'short':
        return { ok: false, text: `${money(result.left)} left to split` };
      case 'over':
        return { ok: false, text: `${money(result.left || others - total)} more than the bill` };
      case 'percent':
        return { ok: false, text: result.left > 0 ? `${percentText(result.left)} left to give` : `${percentText(-result.left)} over 100%` };
      case 'negative':
        return { ok: false, text: "Someone's part is below zero" };
    }
  }, [result.problem, result.left, othersIn, total, others, currency]);

  async function save() {
    setError(null);
    if (picked.length === 0) return setError('Pick who you split it with');
    if (!status.ok) return setError(status.text);
    setSaving(true);
    try {
      const shares = picked.map((id, i) => ({ personId: id, amount: result.parts[i + 1]! })).filter((s) => s.amount > 0);
      const ids = await createSplit({ shares, occurredOn, reason: reason.trim() || null }, fromTx ? fromTx.tx.id : linkTo);
      router.replace(`/item/${ids[0]}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  function control(key: string, i: number) {
    const part = result.parts[i] ?? 0;
    if (method === 'equally' || (method === 'adjust' && out.has(key))) {
      const on = !out.has(key);
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={`${nameOf(key)} is in`}
          hitSlop={10}
          onPress={() => setOut((now) => (now.has(key) ? new Set([...now].filter((k) => k !== key)) : new Set([...now, key])))}
          style={[styles.tick, on && styles.tickOn]}
        >
          {on && <Feather name="check" size={14} color={colors.onInk} />}
        </Pressable>
      );
    }
    if (method === 'shares') {
      const units = rows[i]!.value ?? 0;
      const set = (n: number) => setValue(key, String(Math.max(0, Math.min(99, n))));
      return (
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel="One share less" onPress={() => set(units - 1)} style={styles.step}>
            <Feather name="minus" size={16} color={colors.muted} />
          </Pressable>
          <Text style={styles.units}>{units}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="One share more" onPress={() => set(units + 1)} style={styles.step}>
            <Feather name="plus" size={16} color={colors.primary} />
          </Pressable>
        </View>
      );
    }
    if (method === 'amounts' && key === ME) return <Text style={[styles.rest, part < 0 && { color: colors.danger }]}>{formatAmount(part, currency)}</Text>;
    return (
      <View style={styles.inputWrap}>
        {method !== 'percent' && <Text style={styles.unit}>{symbol}</Text>}
        <TextInput
          value={valueOf(key)}
          onChangeText={(t) => setValue(key, t)}
          keyboardType={method === 'adjust' ? 'numbers-and-punctuation' : 'decimal-pad'}
          placeholder={method === 'adjust' ? '+0' : '0'}
          placeholderTextColor={colors.placeholder}
          style={styles.input}
          maxLength={12}
          selectTextOnFocus
        />
        {method === 'percent' && <Text style={styles.unit}>%</Text>}
      </View>
    );
  }

  function sub(key: string, i: number): string | null {
    const part = result.parts[i] ?? 0;
    if (method === 'amounts') return key === ME ? 'Your part, what is left' : null;
    if (method === 'equally' && out.has(key)) return 'Not in this one';
    if (key === ME && method === 'equally') return part > 0 ? `${formatAmount(part, currency)}, stays as your spending` : null;
    return total > 0 ? formatAmount(part, currency) : null;
  }

  const shown = picked.slice(0, 4);

  return (
    <View style={styles.screen}>
      <FormScroll contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.meta}>{fromTx ? 'You paid' : 'Bill total'}</Text>
          {fromTx ? (
            <Text style={styles.heroAmount}>{formatAmount(fromTx.total, fromTx.currency)}</Text>
          ) : (
            <View style={styles.totalRow}>
              <Text style={styles.heroSymbol}>{symbol}</Text>
              <TextInput
                value={totalText}
                onChangeText={setTotalText}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.placeholder}
                style={styles.heroInput}
                maxLength={14}
                accessibilityLabel="Bill total"
              />
            </View>
          )}
          {fromTx && (
            <Text style={styles.meta}>
              {[fromTx.tx.counterparty, fromTx.account, formatDate(fromTx.tx.occurredAt)].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        <Field label="What for" value={reason} onChangeText={setReason} placeholder="Dinner at Anna’s" maxLength={120} />
        {!fromTx && <DateField label="When" value={occurredOn} onChange={(key) => key && setOccurredOn(key)} style={styles.date} />}

        <SectionTitle>Who's in</SectionTitle>
        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [styles.who, pressed && styles.pressed]}>
          {picked.length === 0 ? (
            <>
              <View style={styles.addIcon}>
                <Feather name="user-plus" size={18} color={colors.primary} />
              </View>
              <Text style={styles.addText}>Add people</Text>
            </>
          ) : (
            <>
              <View style={styles.avatars}>
                {shown.map((id, i) => (
                  <View key={id} style={[styles.avatar, i > 0 && styles.overlap]}>
                    <Initial name={nameOf(id)} size={34} />
                  </View>
                ))}
              </View>
              <Text style={styles.whoText} numberOfLines={1}>
                You and {picked.length === 1 ? nameOf(picked[0]!) : `${picked.length} others`}
              </Text>
              <Text style={styles.edit}>Change</Text>
            </>
          )}
        </Pressable>

        {picked.length > 0 && (
          <>
            <SectionTitle>How to split</SectionTitle>
            <Chips>
              {METHODS.map((m) => (
                <Chip key={m.method} label={m.label} selected={method === m.method} onPress={() => choose(m.method)} />
              ))}
            </Chips>
            <Text style={styles.hint}>{METHODS.find((m) => m.method === method)!.hint}</Text>
            <Card style={styles.rows}>
              {keys.map((key, i) => (
                <View key={key} style={[styles.row, i > 0 && styles.divided]}>
                  <Initial name={key === ME ? 'You' : nameOf(key)} size={36} />
                  <View style={styles.grow}>
                    <Text style={[styles.name, method === 'equally' && out.has(key) && styles.faded]} numberOfLines={1}>
                      {nameOf(key)}
                    </Text>
                    {sub(key, i) && <Text style={styles.rowMeta}>{sub(key, i)}</Text>}
                  </View>
                  {control(key, i)}
                </View>
              ))}
            </Card>
          </>
        )}

        {!fromTx && candidates.length > 0 && (
          <>
            <SectionTitle>You paid with</SectionTitle>
            <Chips>
              {candidates.map((tx) => (
                <Chip
                  key={tx.id}
                  label={`${tx.counterparty ?? 'Payment'}, ${formatDate(tx.occurredAt)}`}
                  selected={linkTo === tx.id}
                  onPress={() => setLinkTo(linkTo === tx.id ? null : tx.id)}
                />
              ))}
              <Chip label="Link later" selected={linkTo === null} onPress={() => setLinkTo(null)} />
            </Chips>
            <Text style={styles.hint}>Pick the entry if the bill is already in your ledger, so it isn't counted twice.</Text>
          </>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </FormScroll>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.statusRow}>
          <View style={styles.status}>
            <Feather name={status.ok ? 'check-circle' : 'alert-circle'} size={15} color={status.ok ? colors.primary : colors.warning} />
            <Text style={[styles.statusText, { color: status.ok ? colors.primary : colors.warning }]} numberOfLines={1}>
              {status.text}
            </Text>
          </View>
          {others > 0 && (
            <Text style={styles.owed} numberOfLines={1}>
              Others owe you <Text style={styles.owedAmount}>{formatAmount(others, currency)}</Text>
            </Text>
          )}
        </View>
        <Button title="Save split" onPress={save} loading={saving} disabled={!status.ok || picked.length === 0} />
      </View>
      <KeyboardGap />

      <PeopleSheet
        visible={picking}
        onClose={() => setPicking(false)}
        people={people}
        recent={recent}
        selected={picked}
        onToggle={(id) => setPicked((now) => (now.includes(id) ? now.filter((p) => p !== id) : [...now, id]))}
        onCreated={(id) => reloadPeople().then(() => setPicked((now) => [...now, id]))}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: 20, paddingBottom: 32 },
  hero: { alignItems: 'center', gap: 4, paddingTop: 16, paddingBottom: 4 },
  heroAmount: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: -1, ...figures },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroSymbol: { fontSize: 32, fontWeight: '700', color: colors.muted },
  heroInput: { fontSize: 36, fontWeight: '700', color: colors.text, letterSpacing: -1, minWidth: 80, textAlign: 'center', paddingVertical: 0, ...figures },
  meta: { fontSize: 13, color: colors.muted },
  date: { marginTop: 16 },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  addIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  avatars: { flexDirection: 'row' },
  avatar: { borderRadius: 12, borderWidth: 2, borderColor: colors.surface },
  overlap: { marginLeft: -10 },
  whoText: { flex: 1, fontSize: 15, color: colors.text },
  edit: { fontSize: 14, fontWeight: '600', color: colors.primary },
  hint: { fontSize: 12, color: colors.muted, marginTop: 8, marginBottom: 10, lineHeight: 17 },
  rows: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  faded: { color: colors.muted },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2, ...figures },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, backgroundColor: colors.subtle },
  step: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  units: { minWidth: 24, textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text, ...figures },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 96,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
  },
  unit: { fontSize: 14, color: colors.muted },
  input: { flex: 1, minHeight: 38, fontSize: 15, color: colors.text, textAlign: 'right', paddingVertical: 0, ...figures },
  rest: { fontSize: 15, fontWeight: '600', color: colors.text, ...figures },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  statusText: { fontSize: 13, fontWeight: '600' },
  owed: { fontSize: 13, color: colors.muted, flexShrink: 0 },
  owedAmount: { fontWeight: '700', color: colors.text, ...figures },
}));
