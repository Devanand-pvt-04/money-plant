// The phone's secure storage (Android Keystore, iOS Keychain). A separate file
// so the web build (secure-store.web.ts) can swap it: expo-secure-store has no
// browser version.
export { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItem, getItemAsync, setItem, setItemAsync } from 'expo-secure-store';
