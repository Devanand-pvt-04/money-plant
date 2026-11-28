import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

/**
 * The web build's database (decision 0039): expo-sqlite's browser version
 * (SQLite in WebAssembly) in the site's private file storage. SQLCipher has no
 * browser version, so it isn't encrypted; the site's storage is readable only
 * by this site, and a browser has no keychain to keep a key apart from it.
 *
 * Opened asynchronously: the rest of the app (and Drizzle) makes synchronous
 * calls, which wait on the database worker and fail if the worker hasn't
 * started yet. The page must be served with the COOP and COEP headers
 * (public/_headers) for those calls to work at all.
 */
export async function openConnection(name: string): Promise<SQLiteDatabase> {
  // Ask the browser not to clear the site's storage when space runs low, so
  // changes not yet synced aren't lost. Safari may still say no.
  void navigator.storage?.persist?.().catch(() => false);
  return openDatabaseAsync(name);
}
