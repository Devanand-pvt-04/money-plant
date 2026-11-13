import { useState, type ComponentProps } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { CADENCE_LABELS, formatMoney, paise } from '@money-plant/core';
import type { PatternMatch, Rule } from '@money-plant/categoriser';
import type { RecurringPayment } from '@money-plant/matcher';
import { AccountPicker } from './account-picker';
import { formatAmount, formatDate, formatDateTime } from './format';
import { OptionRow } from './option-row';
import { Sheet } from './sheet';
import { Button, figures, radius, useColors, makeStyles } from './ui';
import { acceptPattern, declinePattern } from '@/lib/entries';
import { adoptBankBalance, setCurrentBalance, type AccountBalance } from '@/lib/ledger';
import { acceptCardCredit, beforePayment, recordUnrecorded, type CardInCredit } from '@/lib/cards';
import { setRecurringStatus } from '@/lib/recurring';
import { ignoreSender, linkSender, type CaptureQuestions } from '@/lib/senders';

export interface Proposal {
  rule: Rule & { match: PatternMatch };
  text: string;
  category: string;
}

export interface ReviewQuestions {
  gaps: AccountBalance[];
  inCredit: CardInCredit[];
  proposals: Proposal[];
  suggested: RecurringPayment[];
  questions: CaptureQuestions;
}

export function questionCount(q: ReviewQuestions): number {
  return q.gaps.length + q.inCredit.length + q.proposals.length + q.suggested.length + q.questions.senders.length;
}

type FeatherName = ComponentProps<typeof Feather>['name'];

/** Which question's sheet is open. */
type Open =
  | { kind: 'gap'; account: string }
  | { kind: 'credit'; account: string }
  | { kind: 'sender'; sender: string }
  | { kind: 'pattern'; rule: string }
  | { kind: 'recurring'; id: string };

/**
 * Decision 0028: everything in Review that needs an answer other than "looks
 * right", as one-line rows in a tinted panel. Each opens a sheet with its
 * choices; the user always chooses (decision 0024).
 */
export function QuestionsPanel({ data, onError }: { data: ReviewQuestions; onError: (message: string) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [open, setOpen] = useState<Open | null>(null);
  const [picking, setPicking] = useState<{ sender: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    work()
      .then(close)
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  if (questionCount(data) === 0) return null;

  const rows: { key: string; icon: FeatherName; title: string; meta: string; action: string; open: Open }[] = [
    ...data.gaps.flatMap(({ account, reconciliation }) => {
      if (!reconciliation) return [];
      const { latest } = reconciliation;
      const card = account.type === 'credit_card';
      const short = latest.gap < 0;
      return [
        {
          key: `gap:${account.id}`,
          icon: 'alert-circle' as const,
          title: `${account.name} is ${formatMoney(Math.abs(latest.gap), account.currency)} ${short ? (card ? 'behind' : 'short') : 'over'}`,
          meta: `${card ? "The card's" : "The bank's"} balance doesn't match since ${formatDate(reconciliation.windowStart ?? latest.anchor.observedAt)}`,
          action: 'Fix',
          open: { kind: 'gap' as const, account: account.id },
        },
      ];
    }),
    ...data.inCredit.map(({ balance }) => ({
      key: `credit:${balance.account.id}`,
      icon: 'credit-card' as const,
      title: `${balance.account.name} shows ${formatMoney(balance.balance, balance.account.currency)} in credit`,
      meta: 'Probably card spending the app didn’t see',
      action: 'Fix',
      open: { kind: 'credit' as const, account: balance.account.id },
    })),
    ...data.questions.senders.map((s) => ({
      key: `sender:${s.sender}`,
      icon: 'message-square' as const,
      title: `New sender ${s.name}`,
      meta: `${s.waiting} ${s.waiting === 1 ? 'message waits' : 'messages wait'} for their account`,
      action: 'Pick',
      open: { kind: 'sender' as const, sender: s.sender },
    })),
    ...data.proposals.map((p) => ({
      key: `pattern:${p.rule.id}`,
      icon: 'zap' as const,
      title: `New pattern: ${p.category}`,
      meta: p.text,
      action: 'See',
      open: { kind: 'pattern' as const, rule: p.rule.id },
    })),
    ...data.suggested.map((item) => ({
      key: `recurring:${item.id}`,
      icon: 'repeat' as const,
      title: `${item.name}, ${CADENCE_LABELS[item.cadence].toLowerCase()}?`,
      meta: `${formatAmount(item.amount, item.currency)} on a steady schedule`,
      action: 'See',
      open: { kind: 'recurring' as const, id: item.id },
    })),
  ];

  const gap = open?.kind === 'gap' ? data.gaps.find((g) => g.account.id === open.account) : undefined;
  const credit = open?.kind === 'credit' ? data.inCredit.find((c) => c.balance.account.id === open.account) : undefined;
  const sender = open?.kind === 'sender' ? data.questions.senders.find((s) => s.sender === open.sender) : undefined;
  const pattern = open?.kind === 'pattern' ? data.proposals.find((p) => p.rule.id === open.rule) : undefined;
  const recurring = open?.kind === 'recurring' ? data.suggested.find((r) => r.id === open.id) : undefined;

  return (
    <View style={styles.panel}>
      {rows.map((row, i) => (
        <Pressable
          key={row.key}
          accessibilityRole="button"
          onPress={() => setOpen(row.open)}
          style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
        >
          <Feather name={row.icon} size={20} color={colors.warning} />
          <View style={styles.grow}>
            <Text style={styles.title} numberOfLines={1}>
              {row.title}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              {row.meta}
            </Text>
          </View>
          <Text style={styles.action}>{row.action}</Text>
        </Pressable>
      ))}

      <Sheet visible={!!gap} onClose={close} title={gap ? rows.find((r) => r.key === `gap:${gap.account.id}`)?.title : undefined}>
        {gap?.reconciliation && <GapChoices balance={gap} busy={busy} run={run} close={close} />}
      </Sheet>

      <Sheet visible={!!credit} onClose={close} title={credit ? `${credit.balance.account.name} is in credit` : undefined}>
        {credit && <CreditChoices credit={credit} busy={busy} run={run} close={close} />}
      </Sheet>

      <Sheet visible={!!sender} onClose={close} title={sender ? `Messages from ${sender.name}` : undefined}>
        {sender && (
          <>
            <Text style={styles.body}>
              {sender.waiting} {sender.waiting === 1 ? "message doesn't" : "messages don't"} say which of your accounts {sender.waiting === 1 ? 'it is' : 'they are'} for.
              Nothing is added until you pick one.
            </Text>
            <OptionRow
              icon="link"
              title="Pick the account"
              meta="Every message from this sender goes there"
              disabled={busy}
              onPress={() => {
                close();
                setPicking({ sender: sender.sender, name: sender.name });
              }}
            />
            <OptionRow icon="slash" title="Ignore this sender" meta="Its messages won't become entries" disabled={busy} onPress={() => run(() => ignoreSender(sender.sender))} />
          </>
        )}
      </Sheet>

      <Sheet visible={!!pattern} onClose={close} title={pattern ? `New pattern: ${pattern.category}` : undefined}>
        {pattern && <PatternChoices proposal={pattern} close={close} />}
      </Sheet>

      <Sheet visible={!!recurring} onClose={close} title={recurring?.name}>
        {recurring && (
          <>
            <Text style={styles.body}>
              You paid {formatAmount(recurring.amount, recurring.currency)} {CADENCE_LABELS[recurring.cadence].toLowerCase()} on a steady schedule. Track it to get
              reminders; the next one is around {formatDate(`${recurring.nextDue}T12:00:00`)}.
            </Text>
            <OptionRow icon="bell" title="Track it" meta="Reminders before each payment" onPress={() => run(() => setRecurringStatus(recurring.id, 'active'))} />
            <OptionRow icon="x" title="Not recurring" meta="Don't suggest it again" onPress={() => run(() => setRecurringStatus(recurring.id, 'declined'))} />
          </>
        )}
      </Sheet>

      <AccountPicker
        visible={picking !== null}
        title={picking ? `Messages from ${picking.name} are for` : ''}
        onClose={() => setPicking(null)}
        onPick={(account) => {
          const target = picking!;
          setPicking(null);
          run(() => linkSender(target.sender, account.account.id));
        }}
      />
    </View>
  );
}

/** The bank's figure next to the app's, then the fixes (LED-7, decision 0024). */
function GapChoices({ balance, busy, run, close }: { balance: AccountBalance; busy: boolean; run: (work: () => Promise<unknown>) => void; close: () => void }) {
  const styles = useStyles();
  const { account, reconciliation } = balance;
  const { latest, windowStart } = reconciliation!;
  const card = account.type === 'credit_card';
  const money = (n: number) => formatMoney(n, account.currency);
  const limit = account.creditLimitPaise;
  const go = (href: Parameters<typeof router.push>[0]) => {
    close();
    router.push(href);
  };
  return (
    <>
      <View style={styles.compare}>
        <View style={styles.side}>
          <Text style={styles.meta}>{card ? 'Card says you owe' : 'Bank says'}</Text>
          <Text style={styles.figure}>{money(card ? -latest.anchor.balance : latest.anchor.balance)}</Text>
          <Text style={styles.meta}>{formatDateTime(latest.anchor.observedAt)}</Text>
        </View>
        <View style={[styles.side, styles.sideDivided]}>
          <Text style={styles.meta}>App has</Text>
          <Text style={styles.figure}>{money(card ? -latest.computed : latest.computed)}</Text>
          <Text style={styles.meta}>{windowStart ? `Missing since ${formatDate(windowStart)}` : 'Since the last match'}</Text>
        </View>
      </View>
      <Text style={styles.label}>What happened?</Text>
      {card && latest.gap > 0 && limit !== null && (
        <OptionRow
          icon="trending-up"
          title="My credit limit went up"
          meta={`To ${money(limit + latest.gap)}`}
          disabled={busy}
          onPress={() => go(`/account/limit?id=${account.id}&suggest=${limit + latest.gap}${windowStart ? `&from=${encodeURIComponent(windowStart)}` : ''}`)}
        />
      )}
      <OptionRow
        icon="plus"
        title="I'll add what's missing"
        meta={`Opens quick add on ${account.name}, dated ${formatDate(latest.anchor.observedAt)}`}
        disabled={busy}
        onPress={() => go(`/quick-add?account=${account.id}&at=${encodeURIComponent(latest.anchor.observedAt)}`)}
      />
      <OptionRow
        icon="file-text"
        title="Record one entry for it"
        meta={`${money(Math.abs(latest.gap))} as ${latest.gap < 0 ? (card ? 'unrecorded card spending' : 'unrecorded spending') : 'unrecorded money in'}`}
        disabled={busy}
        onPress={() => run(() => recordUnrecorded(account.id, latest.gap, latest.anchor.observedAt))}
      />
      <OptionRow
        icon="check"
        title={card ? 'Just match the card' : 'Just match the bank'}
        meta="Adjusts the balance, adds no spending"
        disabled={busy}
        onPress={() => run(() => adoptBankBalance(account.id, latest.anchor))}
      />
      <Text style={styles.foot}>You always choose. Nothing changes until you tap one.</Text>
    </>
  );
}

function CreditChoices({ credit, busy, run, close }: { credit: CardInCredit; busy: boolean; run: (work: () => Promise<unknown>) => void; close: () => void }) {
  const styles = useStyles();
  const { balance, paidAt } = credit;
  const { account } = balance;
  const extra = formatMoney(balance.balance, account.currency);
  const at = beforePayment(paidAt);
  return (
    <>
      <Text style={styles.body}>After your last payment the card is {extra} in credit. Usually that means {extra} of card spending the app didn't see.</Text>
      <OptionRow
        icon="plus"
        title="I'll add what's missing"
        meta={`Opens quick add on ${account.name}`}
        disabled={busy}
        onPress={() => {
          close();
          router.push(`/quick-add?account=${account.id}&at=${encodeURIComponent(at)}`);
        }}
      />
      <OptionRow icon="file-text" title="Record one entry for it" meta={`${extra} as unrecorded card spending`} disabled={busy} onPress={() => run(() => recordUnrecorded(account.id, paise(-balance.balance), at))} />
      <OptionRow icon="rotate-ccw" title="Set the balance to zero" meta="Adds no spending" disabled={busy} onPress={() => run(() => setCurrentBalance(account.id, paise(0)))} />
      <OptionRow icon="check" title="The card really is in credit" meta="Keep it as it is" disabled={busy} onPress={() => run(() => acceptCardCredit(balance))} />
    </>
  );
}

/** CAT-8: a pattern learned from the user's corrections. */
function PatternChoices({ proposal, close }: { proposal: Proposal; close: () => void }) {
  const styles = useStyles();
  const [autoConfirm, setAutoConfirm] = useState(false);
  const act = (work: () => Promise<unknown>) =>
    work()
      .then(close)
      .catch((e) => Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e)));
  return (
    <>
      <Text style={styles.body}>
        You categorised several entries like this the same way: {proposal.text}. Use {proposal.category} for these from now on?
      </Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Confirm matches without asking</Text>
        <Switch value={autoConfirm} onValueChange={setAutoConfirm} />
      </View>
      <Button title="Use pattern" onPress={() => act(() => acceptPattern(proposal.rule.id, autoConfirm))} />
      <Button title="No thanks" variant="secondary" onPress={() => act(() => declinePattern(proposal.rule.id))} />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: { borderRadius: radius.lg, backgroundColor: colors.warningSurface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 12 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { opacity: 0.7 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
  action: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  body: { fontSize: 14, color: colors.secondary, lineHeight: 20, marginHorizontal: 4 },
  compare: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  side: { flex: 1, padding: 12 },
  sideDivided: { borderLeftWidth: 1, borderLeftColor: colors.divider },
  figure: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2, ...figures },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginTop: 4, marginHorizontal: 4 },
  foot: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 4 },
  switchLabel: { fontSize: 14, color: colors.text, flex: 1 },
}));
