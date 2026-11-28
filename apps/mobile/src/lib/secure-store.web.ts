import type * as Native from 'expo-secure-store';

// Web build (decision 0039): a browser has no keychain, so these small values
// (theme, restart note, lock timer) live in the site's own localStorage, which
// no other site can read. The database key isn't kept here: the web database
// isn't encrypted (db-connection.web.ts).

export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: typeof Native.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 0 as never;

const PREFIX = 'money-plant.';

export const getItem: typeof Native.getItem = (key) => {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
};

export const setItem: typeof Native.setItem = (key, value) => {
  localStorage.setItem(PREFIX + key, value);
};

export const getItemAsync: typeof Native.getItemAsync = async (key) => getItem(key);

export const setItemAsync: typeof Native.setItemAsync = async (key, value) => setItem(key, value);

export const deleteItemAsync: typeof Native.deleteItemAsync = async (key) => {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage blocked: nothing was kept.
  }
};
