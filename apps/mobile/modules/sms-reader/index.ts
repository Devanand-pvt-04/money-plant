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
  | { kind: 'notification'; packageName: string; title: string; text: string; receivedAt: number }
  /** Sent only by 0.11.x builds: another app's money notification, name only. Dropped since decision 0019. */
  | { kind: 'app_candidate'; packageName: string; appName: string; receivedAt: number };

interface SmsReaderNative {
  hasSmsPermission(): boolean;
  readInbox(sinceMillis: number, senderTokens: string[], limit: number): Promise<InboxMessage[]>;
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;
  setSecureWindow?(on: boolean): Promise<void>;
  /** From app 0.11.0 (CAP-11). The app lists are always empty since decision 0019. */
  setCaptureFilters?(ignoredSenders: string[], approvedApps: string[], deniedApps: string[]): void;
}

// Android only. The module is missing on iOS, in Expo Go and on the web.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<SmsReaderNative>('SmsReader') : null;

export const isSmsReaderAvailable = native !== null;

export function hasSmsPermission(): boolean {
  return native?.hasSmsPermission() ?? false;
}

/**
 * Money SMS received after `sinceMillis`, oldest first. Filtering happens
 * natively: from 0.11.0 any business sender (CAP-11), before that the bank
 * names in `senderTokens`.
 */
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

/** Hides the app's screens in the recent apps view, which also blocks screenshots. */
export function setSecureWindow(on: boolean): Promise<void> {
  return native?.setSecureWindow?.(on) ?? Promise.resolve();
}

/** Whether this build reads any business sender (0.11.0 and later). */
export const readsAnySender = typeof native?.setCaptureFilters === 'function';

/** Hands Settings → Capture's ignored senders to the native receiver. */
export function setCaptureFilters(filters: { ignoredSenders: readonly string[]; approvedApps: readonly string[]; deniedApps: readonly string[] }): void {
  native?.setCaptureFilters?.([...filters.ignoredSenders], [...filters.approvedApps], [...filters.deniedApps]);
}

export const CAPTURE_TASK_KEY = 'MoneyPlantCapture';
