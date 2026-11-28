// Expo's default Metro setup, plus the web build (decision 0039): expo-sqlite's
// browser version loads SQLite as a .wasm file. The phone builds never import one.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
