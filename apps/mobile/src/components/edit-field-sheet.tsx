import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatRupees, paise, parseRupees } from '@money-plant/core';
import type { TransactionRow } from '@/lib/ledger';
import { editEntry, recentNotes } from '@/lib/entries';
import { DateTimeField } from './date-fields';
import { Sheet } from './sheet';
import { transactionTitle, displayAmount } from './transaction-item';
import { ErrorText, colors, figures, radius } from './ui';

export type EditField = 'payee' | 'note' | 'amount' | 'when';

const TITLES: Record<EditField, string> = { payee: 'Payee', note: 'Note', amount: 'Amount', when: 'Date and time' };

/** The posting on the user's own account that an edit of amount or account changes. */
export const ownLeg = (row: TransactionRow) => row.legs.find((leg) => row.tx.kind !== 'transfer' || leg.amount < 0) ?? row.legs[0];

/**
 * LED-8 (decision 0015): one field of an entry at a time, in a sheet with Save
 * at the top, so the keyboard never covers it. A changed field stays as the
 * user set it.
 */
export function EditFieldSheet({ row, field, onClose }: { row: TransactionRow; field: EditField | null; onClose: () => void }) {
  const [text, setText] = useState('');
  const [when, setWhen] = useState(row.tx.occurredAt);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!field) return;
    setError(null);
    setSaving(false);
    setWhen(row.tx.occurredAt);
    const own = ownLeg(row);
    setText(
      field === 'payee'
        ? (row.tx.counterparty ?? '')
        : field === 'note'
          ? (row.tx.note ?? '')
          : field === 'amount' && own
            ? formatRupees(paise(Math.abs(own.amount)), { symbol: false }).replace(/,/g, '')
            : '',
    );
    if (field === 'note') recentNotes().then(setNotes, () => setNotes([]));
    // Opening the sheet starts from the entry as it is then; a reload while typing doesn't reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  async function save() {
    if (!field) return;
    setError(null);
    try {
      if (field === 'amount') {
        const amount = parseRupees(text);
        if (amount === null || amount <= 0) return setError('Enter the amount as a number above zero');
        setSaving(true);
        await editEntry(row.tx.id, { amount });
      } else {
        setSaving(true);
        if (field === 'payee') await editEntry(row.tx.id, { counterparty: text });
        else if (field === 'note') await editEntry(row.tx.id, { note: text });
        else await editEntry(row.tx.id, { occurredAt: when });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const amount = displayAmount(row);
  const own = ownLeg(row);
  return (
    <Sheet visible={field !== null} onClose={onClose}>
      <View style={styles.summary}>
        <Text style={styles.payee} numberOfLines={1}>
          {transactionTitle(row)}
        </Text>
        <Text style={[styles.amount, { color: amount.color }]}>{amount.text}</Text>
        {own && <Text style={styles.meta}>{(own.amount < 0 ? 'Spent from ' : 'Into ') + own.accountName}</Text>}
      </View>
      <View style={styles.head}>
        <Text style={styles.title}>{field ? TITLES[field] : ''}</Text>
        <Pressable accessibilityRole="button" onPress={save} disabled={saving} style={({ pressed }) => [styles.save, pressed && styles.pressed]}>
          {saving ? <ActivityIndicator color={colors.onInk} size="small" /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>
      {field === 'when' ? (
        <DateTimeField value={when} onChange={setWhen} />
      ) : (
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          accessibilityLabel={field ? TITLES[field] : undefined}
          placeholder={field === 'note' ? 'What was it for?' : field === 'payee' ? 'Who was paid' : '0'}
          placeholderTextColor={colors.placeholder}
          keyboardType={field === 'amount' ? 'decimal-pad' : 'default'}
          multiline={field === 'note'}
          maxLength={field === 'note' ? 500 : 120}
          returnKeyType={field === 'note' ? 'default' : 'done'}
          onSubmitEditing={field === 'note' ? undefined : save}
          style={[styles.input, field === 'amount' && styles.amountInput]}
        />
      )}
      {field === 'note' && notes.length > 0 && (
        <View style={styles.chips}>
          {notes
            .filter((n) => n !== text.trim())
            .map((n) => (
              <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Use note ${n}`} onPress={() => setText(n)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {n}
                </Text>
              </Pressable>
            ))}
        </View>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center', gap: 2, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  payee: { fontSize: 15, fontWeight: '600', color: colors.text },
  amount: { fontSize: 24, fontWeight: '700', ...figures },
  meta: { fontSize: 12, color: colors.muted },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  save: { minWidth: 72, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 14, fontWeight: '700', color: colors.onInk },
  pressed: { opacity: 0.75 },
  input: {
    minHeight: 52,
    maxHeight: 140,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  amountInput: { fontSize: 24, fontWeight: '700', ...figures },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { maxWidth: '100%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.subtle },
  chipText: { fontSize: 13, color: colors.text },
});
