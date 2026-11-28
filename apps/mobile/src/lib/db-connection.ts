import * as Crypto from 'expo-crypto';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import * as SecureStore from './secure-store';

const KEY_NAME = 'money-plant.db-key';

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = Crypto.getRandomBytes(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
}

/** The phone's database file, unlocked with SQLCipher. The web build uses db-connection.web.ts. */
export async function openConnection(name: string): Promise<SQLiteDatabase> {
  const key = await getOrCreateKey();
  const sqlite = openDatabaseSync(name);
  // Must be the first statement on the connection. Raw hex key, so no key derivation.
  sqlite.execSync(`PRAGMA key = "x'${key}'"`);
  const cipher = sqlite.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!cipher) {
    // Expo Go has no SQLCipher. Refuse to store money data unencrypted outside development.
    if (!__DEV__) throw new Error('SQLCipher is not available; refusing to open the database.');
    console.warn('SQLCipher is not available: the local database is NOT encrypted.');
  }
  return sqlite;
}
