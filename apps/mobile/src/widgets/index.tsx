"use no memo";
import { AppState, Platform } from 'react-native';
import { requestWidgetUpdate, type WidgetInfo, type WidgetRepresentation, type WidgetTaskHandler } from 'react-native-android-widget';
import { paletteFor } from '@/components/ui';
import { reportBackground } from '@/lib/errors';
import { onLedgerChange } from '@/lib/events';
import { comingUpWidgetData, monthWidgetData, quickAddWidgetData, widgetContext } from './data';
import { ComingUpWidget, MonthWidget, QuickAddWidget, SetupWidget } from './views';

/**
 * Home screen widgets (HOME-4, decision 0036). Names match the widgets
 * declared for react-native-android-widget's config plugin in app.json.
 */
export const WIDGETS = {
  month: 'ThisMonth',
  quickAdd: 'QuickAdd',
  comingUp: 'ComingUp',
} as const;

const TITLES: Record<string, string> = {
  [WIDGETS.month]: 'This month',
  [WIDGETS.quickAdd]: 'Quick add',
  [WIDGETS.comingUp]: 'Coming up',
};

const light = paletteFor('light');
const dark = paletteFor('dark');

/** The widget in both schemes; Android picks the one matching the phone's theme. */
function both(draw: (colors: typeof light) => React.JSX.Element): WidgetRepresentation {
  return { light: draw(light), dark: draw(dark) };
}

/** Draws one placed widget from the phone's database. Never throws: a failure draws "Open Money Plant". */
async function drawWidget(info: WidgetInfo): Promise<WidgetRepresentation> {
  const name = info.widgetName;
  const setup = () => both((colors) => <SetupWidget colors={colors} name={TITLES[name] ?? 'Money Plant'} />);
  const context = await widgetContext();
  if (!context) return name === WIDGETS.quickAdd ? both((colors) => <QuickAddWidget colors={colors} data={null} />) : setup();
  try {
    switch (name) {
      case WIDGETS.month: {
        const data = await monthWidgetData();
        return both((colors) => <MonthWidget colors={colors} data={data} amounts={context.amounts} width={info.width} />);
      }
      case WIDGETS.quickAdd: {
        const data = await quickAddWidgetData();
        return both((colors) => <QuickAddWidget colors={colors} data={data} />);
      }
      case WIDGETS.comingUp: {
        const data = await comingUpWidgetData();
        return both((colors) => <ComingUpWidget colors={colors} data={data} amounts={context.amounts} height={info.height} />);
      }
      default:
        return setup();
    }
  } catch (e) {
    reportBackground('widgets')(e);
    return setup();
  }
}

/** Android asks for a widget when it is placed, resized and every 30 minutes; this runs as a headless task. */
export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  renderWidget(await drawWidget(widgetInfo));
};

/** Redraws every placed widget. Cheap when none are placed: nothing is read. */
export async function refreshWidgets(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const widgetName of Object.values(WIDGETS)) {
    try {
      await requestWidgetUpdate({ widgetName, renderWidget: drawWidget });
    } catch (e) {
      reportBackground('widgets')(e);
    }
  }
}

const SETTLE_MS = 2000;

/**
 * While the app is open: redraw after ledger changes (a capture, a review
 * action, a sync), at most once every 2 s, and when the app leaves the screen.
 */
export function startWidgetUpdates(): () => void {
  if (Platform.OS !== 'android') return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refreshWidgets();
    }, SETTLE_MS);
  };
  const offLedger = onLedgerChange(soon);
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'background') return;
    if (timer) clearTimeout(timer);
    timer = null;
    void refreshWidgets();
  });
  void refreshWidgets();
  return () => {
    if (timer) clearTimeout(timer);
    offLedger();
    appState.remove();
  };
}
