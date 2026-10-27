import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from '@money-plant/db-schema';
import { LOCAL_MIGRATIONS } from '@money-plant/db-schema';

const DB_NAME = 'money-plant.db';
const KEY_NAME = 'money-plant.db-key';

export type Database = ReturnType<typeof createDrizzle>;

function createDrizzle(sqlite: SQLiteDatabase) {
  return drizzle(sqlite, { schema });
}

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

function migrate(sqlite: SQLiteDatabase) {
  const row = sqlite.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < LOCAL_MIGRATIONS.length; version++) {
    sqlite.withTransactionSync(() => {
      sqlite.execSync(LOCAL_MIGRATIONS[version]!);
      sqlite.execSync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

async function open(): Promise<Database> {
  const key = await getOrCreateKey();
  const sqlite = openDatabaseSync(DB_NAME);
  // Must be the first statement on the connection. Raw hex key, so no key derivation.
  sqlite.execSync(`PRAGMA key = "x'${key}'"`);
  const cipher = sqlite.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!cipher) {
    // Expo Go has no SQLCipher. Refuse to store money data unencrypted outside development.
    if (!__DEV__) throw new Error('SQLCipher is not available; refusing to open the database.');
    console.warn('SQLCipher is not available: the local database is NOT encrypted.');
  }
  migrate(sqlite);
  opened = createDrizzle(sqlite);
  return opened;
}

let opening: Promise<Database> | null = null;
let opened: Database | null = null;

/** The database if it is already open, for code that can't wait, such as a crash handler. */
export function openedDb(): Database | null {
  return opened;
}

/** The app's single encrypted database, opened on first use. */
export function getDb(): Promise<Database> {
  opening ??= open();
  return opening;
}
