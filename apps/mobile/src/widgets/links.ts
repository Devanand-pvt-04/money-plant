/**
 * Links from home screen widgets (decision 0036). A widget opens
 * `moneyplant://widget?open=<path>`; app/+native-intent.tsx sends the app to
 * Home and keeps the path here, and the root layout opens it once the app is
 * ready (signed in, consented, database open), the way a tapped notification
 * does. Back from that screen then lands on Home instead of closing the app.
 */

const SCHEME = 'moneyplant';

/** The only places a widget link may open, so other apps can't use it to reach any screen. */
const ALLOWED: readonly RegExp[] = [
  /^\/budgets$/,
  /^\/quick-add(\?mode=credit)?$/,
  /^\/pay$/,
  /^\/review$/,
  /^\/recurring$/,
  /^\/recurring\/[A-Za-z0-9-]+$/,
  /^\/account\/[A-Za-z0-9-]+$/,
];

export function isWidgetTarget(path: string): boolean {
  return ALLOWED.some((pattern) => pattern.test(path));
}

/** The link a widget opens for an in-app path. */
export function widgetUri(path: string): string {
  return `${SCHEME}://widget?open=${encodeURIComponent(path)}`;
}

/** The in-app path in a widget link, or null when the link isn't one (or names a path off the list). */
export function widgetTargetOf(url: string): string | null {
  const match = /^(?:moneyplant:\/\/|\/)?widget\/?\?(?:.*&)?open=([^&#]*)/.exec(url);
  if (!match) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  return isWidgetTarget(path) ? path : null;
}

let pending: string | null = null;
const listeners = new Set<() => void>();

/** Keeps a widget's target until the app is ready to open it. */
export function setPendingWidgetTarget(path: string): void {
  pending = path;
  for (const listener of listeners) listener();
}

/** The waiting target, cleared as it is taken. */
export function takePendingWidgetTarget(): string | null {
  const path = pending;
  pending = null;
  return path;
}

export function onWidgetTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
