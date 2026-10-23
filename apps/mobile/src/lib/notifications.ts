import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Show alerts while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const CHANNELS = { budgets: 'Budget alerts', reminders: 'Payment reminders' } as const;
type Channel = keyof typeof CHANNELS;

let channelsReady: Promise<void> | null = null;
function ensureChannels(): Promise<void> {
  channelsReady ??= (async () => {
    if (Platform.OS !== 'android') return;
    for (const [id, name] of Object.entries(CHANNELS)) {
      await Notifications.setNotificationChannelAsync(id, { name, importance: Notifications.AndroidImportance.DEFAULT });
    }
  })();
  return channelsReady;
}

/** Asks for permission to notify (Android 13 and later need it). Returns whether alerts can be shown. */
export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Shows a local notification now. Does nothing without permission. */
export async function notify(input: { channel: Channel; title: string; body: string; data?: Record<string, string> }): Promise<void> {
  await ensureChannels();
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: input.title, body: input.body, data: input.data ?? {} },
    trigger: Platform.OS === 'android' ? { channelId: input.channel } : null,
  });
}

/**
 * Schedules a local notification for a moment in the future, replacing any
 * earlier one with the same id. Does nothing without permission or for a past date.
 */
export async function notifyAt(input: {
  id: string;
  channel: Channel;
  at: Date;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  await ensureChannels();
  if (input.at.getTime() <= Date.now()) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await Notifications.scheduleNotificationAsync({
    identifier: input.id,
    content: { title: input.title, body: input.body, data: input.data ?? {} },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: input.at, channelId: input.channel },
  });
}

/** Cancels every scheduled notification whose id starts with `prefix`. */
export async function cancelScheduled(prefix: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(prefix))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}
