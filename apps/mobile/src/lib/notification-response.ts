// The notification the user last tapped. A separate file so the web build
// (notification-response.web.ts) can leave it out: expo-notifications has no
// tapped-notification support in a browser.
export { DEFAULT_ACTION_IDENTIFIER, clearLastNotificationResponse, useLastNotificationResponse } from 'expo-notifications';
