import { setSecureWindow } from '../../modules/sms-reader';
import { kvGet, kvSet } from './kv';

const HIDE_KEY = 'privacy.hide-recents';

/** On unless the user turned it off: the recent apps view shows a blank card instead of balances. */
export async function hideInRecents(): Promise<boolean> {
  return (await kvGet(HIDE_KEY)) !== 'off';
}

export async function setHideInRecents(on: boolean): Promise<void> {
  await kvSet(HIDE_KEY, on ? 'on' : 'off');
  await applyHideInRecents(on);
}

/** Android can only hide the app in recent apps by also blocking screenshots, so turning this off allows them again. */
export async function applyHideInRecents(on?: boolean): Promise<void> {
  await setSecureWindow(on ?? (await hideInRecents())).catch(() => {});
}
