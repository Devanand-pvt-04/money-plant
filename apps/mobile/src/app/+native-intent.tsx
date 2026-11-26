import { setPendingWidgetTarget, widgetTargetOf } from '@/widgets/links';

/**
 * Links from home screen widgets (decision 0036). On a cold start the app opens
 * on Home and the root layout pushes the widget's screen on top once the app is
 * ready, so the link never lands on a route behind the sign-in and consent
 * guards and Back returns to Home. With the app already open it stays where it
 * is and the screen opens on top. A widget link off the allowed list opens
 * nothing; other links pass through as before.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (!/^(?:moneyplant:\/\/|\/)?widget\b/.test(path)) return path;
    const target = widgetTargetOf(path);
    if (target) setPendingWidgetTarget(target);
    return initial ? '/' : null;
  } catch {
    return initial ? '/' : null;
  }
}
