"use no memo";
// The widget library calls these as plain functions, so the React Compiler must leave them alone.
import { FlexWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { formatAmount, formatMonth, formatSummary } from '@/components/format';
import type { Palette } from '@/components/ui';
import { dueLabel, dueSoon } from '@/lib/week';
import type { ComingUpWidgetData, MonthWidgetData, QuickAddWidgetData } from './data';
import { widgetUri } from './links';

/**
 * The widgets' drawings (decision 0036): the charcoal money card of Home in
 * the app's hero colours, built from react-native-android-widget's primitives
 * (no React Native views; Android draws these as RemoteViews). Sizes are dp.
 */

type Color = `#${string}` | `rgba(${number}, ${number}, ${number}, ${number})`;
const c = (value: string) => value as Color;

const PAD = 16;

const ICONS = {
  // The Money Plant leaf.
  leaf: '<path d="M5 19c0-8 6-14 15-15-1 9-7 15-15 15z"/><path d="M5 19l7-7"/>',
  // Feather icons, as in the app.
  spent: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  got: '<line x1="17" y1="7" x2="7" y2="17"/><polyline points="17 17 7 17 7 7"/>',
  scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  review: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
};

function icon(name: keyof typeof ICONS, color: string, strokeWidth = 2): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

const open = (path: string) => ({ clickAction: 'OPEN_URI', clickActionData: { uri: widgetUri(path) } }) as const;
const openApp = { clickAction: 'OPEN_APP' } as const;

function Card({ colors, children, path, label }: { colors: Palette; children: React.ReactNode; path?: string; label: string }) {
  return (
    <FlexWidget
      {...(path ? open(path) : openApp)}
      accessibilityLabel={label}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: c(colors.hero),
        borderRadius: 24,
        padding: PAD,
      }}
    >
      {children}
    </FlexWidget>
  );
}

function Header({ colors, title, right, rightColor }: { colors: Palette; title: string; right?: string; rightColor?: string }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
      <SvgWidget svg={icon('leaf', colors.heroAccent)} style={{ height: 16, width: 16, marginRight: 8 }} />
      <FlexWidget style={{ flex: 1 }}>
        <TextWidget text={title} maxLines={1} truncate="END" style={{ fontSize: 13, color: c(colors.heroMuted) }} />
      </FlexWidget>
      {right ? <TextWidget text={right} maxLines={1} style={{ fontSize: 13, color: c(rightColor ?? colors.heroMuted), marginLeft: 8 }} /> : null}
    </FlexWidget>
  );
}

/** Shown when nobody is signed in on this phone, or the database can't be read. */
export function SetupWidget({ colors, name }: { colors: Palette; name: string }) {
  return (
    <Card colors={colors} label={`Money Plant ${name}. Open Money Plant`}>
      <Header colors={colors} title={name} />
      <FlexWidget style={{ flex: 1, justifyContent: 'center' }}>
        <TextWidget text="Open Money Plant" style={{ fontSize: 16, fontWeight: '500', color: c(colors.heroText) }} />
        <TextWidget text="to see your money here" style={{ fontSize: 13, color: c(colors.heroMuted), marginTop: 2 }} />
      </FlexWidget>
    </Card>
  );
}

const PILL: Record<MonthWidgetData['status'], string> = { ok: 'On track', pace: 'Spending fast', over: 'Over budget' };

/** This month (4×2): left to spend against the month's budget, with the pace marker. Opens Budgets. */
export function MonthWidget({ colors, data, amounts, width }: { colors: Palette; data: MonthWidgetData; amounts: boolean; width: number }) {
  const monthName = formatMonth(data.month).split(' ')[0];
  const budgeted = data.limit !== null && data.limit > 0;
  const statusColor = data.status === 'over' ? colors.heroDanger : data.status === 'pace' ? colors.heroWarning : colors.heroAccent;
  const used = budgeted ? data.spent / data.limit! : 0;
  const left = budgeted ? data.limit! - data.spent : 0;
  const days = `${data.daysLeft} ${data.daysLeft === 1 ? 'day' : 'days'} left`;

  let title: string;
  let value: string;
  let of: string | null = null;
  let footer: string;
  if (budgeted && amounts) {
    title = `Left to spend in ${monthName}`;
    value = formatSummary(left);
    of = `of ${formatSummary(data.limit!)}`;
    footer = `Spent ${formatSummary(data.spent)} · In ${formatSummary(data.income)}`;
  } else if (budgeted) {
    title = `${monthName} budget`;
    value = `${Math.round(used * 100)}%`;
    of = 'used';
    footer = days;
  } else if (amounts) {
    title = `Spent in ${monthName}`;
    value = formatSummary(data.spent);
    footer = `In ${formatSummary(data.income)} · ${days}`;
  } else {
    title = `${monthName} spending`;
    value = 'Amounts hidden';
    footer = days;
  }

  const barWidth = Math.max(40, Math.round(width - PAD * 2));
  const fill = Math.round(barWidth * Math.min(Math.max(used, 0), 1));
  const marker = Math.min(barWidth - 2, Math.round(barWidth * Math.min(Math.max(data.elapsed, 0), 1)));

  return (
    <Card colors={colors} path="/budgets" label={`${title}: ${value}${of ? ` ${of}` : ''}. ${budgeted ? PILL[data.status] : ''}`}>
      <Header colors={colors} title={title} right={budgeted ? PILL[data.status] : amounts ? days : undefined} rightColor={statusColor} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8, width: 'match_parent' }}>
        <TextWidget
          text={value}
          maxLines={1}
          style={{ fontSize: 30, fontWeight: '700', color: c(left < 0 && amounts ? colors.heroDanger : colors.heroText) }}
        />
        {of ? <TextWidget text={of} maxLines={1} style={{ fontSize: 14, color: c(colors.heroMuted), marginLeft: 8, marginBottom: 5 }} /> : null}
      </FlexWidget>
      {budgeted ? (
        <OverlapWidget style={{ width: barWidth, height: 14, marginTop: 10 }}>
          <FlexWidget style={{ width: barWidth, height: 8, marginTop: 3, borderRadius: 4, backgroundColor: c(colors.heroTrack), flexDirection: 'row' }}>
            {fill > 0 ? <FlexWidget style={{ width: fill, height: 8, borderRadius: 4, backgroundColor: c(statusColor) }} /> : null}
          </FlexWidget>
          <FlexWidget style={{ width: 2, height: 14, marginLeft: marker, backgroundColor: c(colors.heroText) }} />
        </OverlapWidget>
      ) : null}
      <FlexWidget style={{ flex: 1 }} />
      <TextWidget text={footer} maxLines={1} truncate="END" style={{ fontSize: 13, color: c(colors.heroMuted) }} />
    </Card>
  );
}

function Action({ colors, glyph, label, path, count }: { colors: Palette; glyph: keyof typeof ICONS; label: string; path: string; count?: number }) {
  const waiting = (count ?? 0) > 0;
  return (
    <FlexWidget
      {...open(path)}
      accessibilityLabel={waiting ? `${label}, ${count} waiting` : label}
      style={{ flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'match_parent' }}
    >
      <OverlapWidget style={{ width: 48, height: 44 }}>
        <FlexWidget
          style={{
            width: 40,
            height: 40,
            marginLeft: 4,
            marginTop: 4,
            borderRadius: 20,
            backgroundColor: c(waiting ? colors.heroWarning : colors.heroPill),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SvgWidget svg={icon(glyph, waiting ? colors.hero : colors.heroAccent)} style={{ width: 20, height: 20 }} />
        </FlexWidget>
        {waiting ? (
          <FlexWidget
            style={{
              marginLeft: 28,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 5,
              backgroundColor: c(colors.heroText),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <TextWidget text={count! > 99 ? '99+' : String(count)} style={{ fontSize: 11, fontWeight: '700', color: c(colors.hero) }} />
          </FlexWidget>
        ) : null}
      </OverlapWidget>
      <TextWidget text={label} maxLines={1} style={{ fontSize: 12, color: c(colors.heroMuted), marginTop: 2 }} />
    </FlexWidget>
  );
}

/** Quick add (4×1): Spent, Got, Scan & pay, Review. Never shows amounts. */
export function QuickAddWidget({ colors, data }: { colors: Palette; data: QuickAddWidgetData | null }) {
  return (
    <FlexWidget
      {...openApp}
      accessibilityLabel="Money Plant quick add"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: c(colors.hero),
        borderRadius: 24,
        paddingHorizontal: 8,
      }}
    >
      <Action colors={colors} glyph="spent" label="Spent" path="/quick-add" />
      <Action colors={colors} glyph="got" label="Got" path="/quick-add?mode=credit" />
      <Action colors={colors} glyph="scan" label="Scan & pay" path="/pay" />
      <Action colors={colors} glyph="review" label="Review" path="/review" count={data?.pending} />
    </FlexWidget>
  );
}

/** Coming up (4×2): what Home's "Coming up" shows, as rows. A row opens its payment or card; the rest opens Recurring. */
export function ComingUpWidget({ colors, data, amounts, height }: { colors: Palette; data: ComingUpWidgetData; amounts: boolean; height: number }) {
  const now = new Date();
  // Header 20 dp, then rows of 26 dp in what's left of the card.
  const rows = Math.max(1, Math.min(6, Math.floor((height - PAD * 2 - 20) / 26)));
  const shown = data.items.slice(0, rows);
  const more = data.items.length - shown.length;
  return (
    <Card colors={colors} path="/recurring" label={`Coming up: ${data.items.length === 0 ? 'nothing due this week' : `${data.items.length} due this week`}`}>
      <Header colors={colors} title="Coming up" right={more > 0 ? `+${more} more` : undefined} />
      {shown.length === 0 ? (
        <FlexWidget style={{ flex: 1, justifyContent: 'center' }}>
          <TextWidget text="Nothing due this week." style={{ fontSize: 14, color: c(colors.heroMuted) }} />
        </FlexWidget>
      ) : (
        shown.map((item) => {
          const soon = dueSoon(item, now);
          return (
            <FlexWidget
              key={item.href}
              {...open(item.href)}
              accessibilityLabel={`${item.title}, ${dueLabel(item, now)}${amounts ? `, ${formatAmount(item.amount, item.currency)}` : ''}`}
              style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: 26 }}
            >
              <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, marginRight: 10, backgroundColor: c(soon ? colors.heroWarning : colors.heroAccent) }} />
              <FlexWidget style={{ flex: 1 }}>
                <TextWidget text={item.title} maxLines={1} truncate="END" style={{ fontSize: 14, color: c(colors.heroText) }} />
              </FlexWidget>
              <TextWidget text={dueLabel(item, now)} maxLines={1} style={{ fontSize: 12, marginLeft: 8, color: c(soon ? colors.heroWarning : colors.heroMuted) }} />
              {amounts ? (
                <TextWidget
                  text={formatAmount(item.amount, item.currency)}
                  maxLines={1}
                  style={{ fontSize: 14, fontWeight: '500', marginLeft: 10, color: c(item.incoming ? colors.heroAccent : colors.heroText) }}
                />
              ) : null}
            </FlexWidget>
          );
        })
      )}
    </Card>
  );
}
