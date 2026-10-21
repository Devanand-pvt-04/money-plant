import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface InboxMessage {
  id: string;
  /** Sender address as the phone stores it, e.g. "VM-HDFCBK-S". */
  sender: string;
  body: string;
  /** When the phone received it, in milliseconds since the epoch. */
  receivedAt: number;
  /** The service centre's timestamp. Identical on both capture paths, so it goes into the fingerprint. */
  sentAt: number;
}

/** What the native receiver and notification listener hand to the "MoneyPlantCapture" task. */
export type CaptureTaskData =
  | { kind: 'sms'; sender: string; body: string; receivedAt: number; sentAt: number }
  | { kind: 'notification'; packageName: string; title: string; text: string; receivedAt: number };

interface SmsReaderNative {
  hasSmsPermission(): boolean;
  readInbox(sinceMillis: number, senderTokens: string[], limit: number): Promise<InboxMessage[]>;
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;
}

// Android only. The module is missing on iOS, in Expo Go and on the web.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<SmsReaderNative>('SmsReader') : null;

export const isSmsReaderAvailable = native !== null;

export function hasSmsPermission(): boolean {
  return native?.hasSmsPermission() ?? false;
}

/** Bank-like SMS received after `sinceMillis`, oldest first. Filtering by sender happens natively. */
export function readInbox(sinceMillis: number, senderTokens: readonly string[], limit = 5000): Promise<InboxMessage[]> {
  if (!native) return Promise.resolve([]);
  return native.readInbox(sinceMillis, [...senderTokens], limit);
}

export function isNotificationAccessGranted(): boolean {
  return native?.isNotificationAccessGranted() ?? false;
}

export function openNotificationAccessSettings(): void {
  native?.openNotificationAccessSettings();
}

export const CAPTURE_TASK_KEY = 'MoneyPlantCapture';
