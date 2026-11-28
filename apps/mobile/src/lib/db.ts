import type { SQLiteDatabase } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from '@money-plant/db-schema';
import { LOCAL_MIGRATIONS } from '@money-plant/db-schema';
import { openConnection } from './db-connection';

const DB_NAME = 'money-plant.db';

export type Database = ReturnType<typeof createDrizzle>;

function createDrizzle(sqlite: SQLiteDatabase) {
  return drizzle(sqlite, { schema });
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
  const sqlite = await openConnection(DB_NAME);
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
