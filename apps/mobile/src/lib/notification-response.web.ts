import type { NotificationResponse } from 'expo-notifications';

// Web build (decision 0039): browsers give the app no tapped local notification.
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

export function useLastNotificationResponse(): NotificationResponse | null | undefined {
  return null;
}

export function clearLastNotificationResponse(): void {}
