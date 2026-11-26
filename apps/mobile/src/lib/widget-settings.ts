import { kvGet, kvSet } from './kv';

const AMOUNTS_KEY = 'widgets.amounts';

/**
 * Settings → App → Show amounts on widgets (decision 0036). On unless the user
 * turned it off; off shows percentages and names instead of money. Kept in the
 * phone's database, which the widget task reads.
 */
export async function widgetAmountsShown(): Promise<boolean> {
  return (await kvGet(AMOUNTS_KEY)) !== 'off';
}

export async function setWidgetAmountsShown(on: boolean): Promise<void> {
  await kvSet(AMOUNTS_KEY, on ? 'on' : 'off');
}
