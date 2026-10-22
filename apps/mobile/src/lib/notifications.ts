import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Show alerts while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const CHANNELS = { budgets: 'Budget alerts' } as const;
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
